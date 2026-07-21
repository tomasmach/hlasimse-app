from datetime import timedelta

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from .models import AlertIncident, DeliveryAttempt, OutboxEvent, WorkerHeartbeat

REQUIRED_DELIVERY_WORKERS = {
    "deadline_sweeper",
    "outbox_alerts",
    "outbox_email",
    "push_receipts",
    "safety_reconciliation",
}


ALERT_EVENT_TYPES = {"alert.opened", "alert.resolved", "alert.retry"}
ACTIVE_ALERT_EVENT_TYPES = {"alert.opened", "alert.retry"}
NON_TERMINAL_DELIVERY_STATUSES = {
    DeliveryAttempt.Status.QUEUED,
    DeliveryAttempt.Status.TICKET_RECEIVED,
    DeliveryAttempt.Status.RECEIPT_PROCESSING,
}


def delivery_health(
    *,
    heartbeat_max_age: timedelta = timedelta(minutes=5),
    delivery_attempt_max_age: timedelta = timedelta(minutes=15),
    recent_failure_max_age: timedelta = timedelta(hours=24),
) -> dict:
    now = timezone.now()
    heartbeat_cutoff = now - heartbeat_max_age
    delivery_attempt_cutoff = now - delivery_attempt_max_age
    recent_failure_cutoff = now - recent_failure_max_age
    heartbeats = {
        heartbeat.worker_name: heartbeat
        for heartbeat in WorkerHeartbeat.objects.filter(worker_name__in=REQUIRED_DELIVERY_WORKERS)
    }
    missing_workers = sorted(REQUIRED_DELIVERY_WORKERS - heartbeats.keys())
    stale_workers = sorted(
        name for name, heartbeat in heartbeats.items() if heartbeat.last_seen_at < heartbeat_cutoff
    )
    failing_workers = sorted(
        name for name, heartbeat in heartbeats.items() if heartbeat.details.get("healthy") is False
    )
    open_incident_ids = AlertIncident.objects.filter(status=AlertIncident.Status.OPEN).values("id")
    open_incident_ids_with_recipients = AlertIncident.objects.filter(
        status=AlertIncident.Status.OPEN,
        recipients__user__isnull=False,
    ).values("id")
    actionable_failed_events = OutboxEvent.objects.filter(
        Q(updated_at__gte=recent_failure_cutoff)
        | Q(event_type__in=ALERT_EVENT_TYPES, aggregate_id__in=open_incident_ids),
        status=OutboxEvent.Status.FAILED,
    )
    failed_events = actionable_failed_events.count()
    retrying_invitation_events = (
        OutboxEvent.objects.filter(
            status=OutboxEvent.Status.PENDING,
            event_type="guardian.invited",
        )
        .exclude(last_error="")
        .count()
    )
    failed_invitation_events = actionable_failed_events.filter(
        status=OutboxEvent.Status.FAILED,
        event_type="guardian.invited",
    ).count()
    retrying_verification_events = (
        OutboxEvent.objects.filter(
            status=OutboxEvent.Status.PENDING,
            event_type="user.email_verification",
        )
        .exclude(last_error="")
        .count()
    )
    failed_verification_events = actionable_failed_events.filter(
        status=OutboxEvent.Status.FAILED,
        event_type="user.email_verification",
    ).count()
    supported_event_types = {
        *ALERT_EVENT_TYPES,
        "guardian.invited",
        "user.email_verification",
    }
    unsupported_pending_events = (
        OutboxEvent.objects.filter(
            status__in=[OutboxEvent.Status.PENDING, OutboxEvent.Status.PROCESSING]
        )
        .exclude(event_type__in=supported_event_types)
        .count()
    )
    retrying_alert_events = (
        OutboxEvent.objects.filter(
            status=OutboxEvent.Status.PENDING,
            event_type__in=ALERT_EVENT_TYPES,
        )
        .exclude(last_error="")
        .count()
    )
    stale_delivery_attempts = (
        DeliveryAttempt.objects.filter(
            account_erasure_tombstone=False,
        )
        .filter(
            Q(
                status__in=NON_TERMINAL_DELIVERY_STATUSES,
                updated_at__lt=delivery_attempt_cutoff,
            )
            | Q(
                status=DeliveryAttempt.Status.RETRYABLE_FAILURE,
                next_retry_at__lt=delivery_attempt_cutoff,
            )
            | Q(
                status=DeliveryAttempt.Status.RETRYABLE_FAILURE,
                next_retry_at__isnull=True,
                updated_at__lt=delivery_attempt_cutoff,
            )
        )
        .count()
    )
    missing_delivery_attempts = (
        OutboxEvent.objects.filter(
            aggregate_id__in=open_incident_ids_with_recipients,
            event_type__in=ACTIVE_ALERT_EVENT_TYPES,
            status=OutboxEvent.Status.PROCESSED,
        )
        .filter(delivery_attempts__isnull=True)
        .count()
    )
    dead_letters = (
        DeliveryAttempt.objects.filter(
            account_erasure_tombstone=False,
        )
        .filter(
            Q(updated_at__gte=recent_failure_cutoff)
            | Q(incident__status=AlertIncident.Status.OPEN),
            status=DeliveryAttempt.Status.DEAD_LETTER,
        )
        .count()
    )
    disabled_safety_features = (
        [] if settings.GUARDIAN_LOCATION_DISCLOSURE_ENABLED else ["guardian_location_disclosure"]
    )
    healthy = not any(
        [
            missing_workers,
            stale_workers,
            failing_workers,
            failed_events,
            unsupported_pending_events,
            retrying_invitation_events,
            retrying_verification_events,
            retrying_alert_events,
            stale_delivery_attempts,
            missing_delivery_attempts,
            dead_letters,
            disabled_safety_features,
        ]
    )
    return {
        "healthy": healthy,
        "missing_workers": missing_workers,
        "stale_workers": stale_workers,
        "failing_workers": failing_workers,
        "failed_events": failed_events,
        "unsupported_pending_events": unsupported_pending_events,
        "retrying_invitation_events": retrying_invitation_events,
        "failed_invitation_events": failed_invitation_events,
        "retrying_verification_events": retrying_verification_events,
        "failed_verification_events": failed_verification_events,
        "retrying_alert_events": retrying_alert_events,
        "stale_delivery_attempts": stale_delivery_attempts,
        "missing_delivery_attempts": missing_delivery_attempts,
        "dead_letter_deliveries": dead_letters,
        "disabled_safety_features": disabled_safety_features,
    }
