from datetime import timedelta

from django.utils import timezone

from .models import DeliveryAttempt, OutboxEvent, WorkerHeartbeat

REQUIRED_DELIVERY_WORKERS = {"deadline_sweeper", "outbox", "push_receipts"}


def delivery_health(*, heartbeat_max_age: timedelta = timedelta(minutes=5)) -> dict:
    now = timezone.now()
    heartbeat_cutoff = now - heartbeat_max_age
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
    failed_events = OutboxEvent.objects.filter(status=OutboxEvent.Status.FAILED).count()
    retrying_invitation_events = (
        OutboxEvent.objects.filter(
            status=OutboxEvent.Status.PENDING,
            event_type="guardian.invited",
        )
        .exclude(last_error="")
        .count()
    )
    failed_invitation_events = OutboxEvent.objects.filter(
        status=OutboxEvent.Status.FAILED,
        event_type="guardian.invited",
    ).count()
    unsupported_pending_events = 0
    retrying_alert_events = (
        OutboxEvent.objects.filter(
            status=OutboxEvent.Status.PENDING,
            event_type__in=["alert.opened", "alert.resolved", "alert.retry"],
        )
        .exclude(last_error="")
        .count()
    )
    dead_letters = DeliveryAttempt.objects.filter(status=DeliveryAttempt.Status.DEAD_LETTER).count()
    healthy = not any(
        [
            missing_workers,
            stale_workers,
            failing_workers,
            failed_events,
            unsupported_pending_events,
            retrying_invitation_events,
            retrying_alert_events,
            dead_letters,
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
        "retrying_alert_events": retrying_alert_events,
        "dead_letter_deliveries": dead_letters,
    }
