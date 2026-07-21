import uuid
from datetime import timedelta

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone

from core.health import REQUIRED_DELIVERY_WORKERS, delivery_health
from core.models import (
    AlertIncident,
    AlertRecipient,
    DeliveryAttempt,
    OutboxEvent,
    WorkerHeartbeat,
)

pytestmark = pytest.mark.django_db


def _fresh_worker_heartbeats() -> None:
    for worker_name in REQUIRED_DELIVERY_WORKERS:
        WorkerHeartbeat.objects.create(worker_name=worker_name)


def _incident(profile, *, status=AlertIncident.Status.OPEN) -> AlertIncident:
    return AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
        status=status,
        resolved_at=timezone.now() if status == AlertIncident.Status.RESOLVED else None,
    )


def _alert_event(incident, *, status=OutboxEvent.Status.PROCESSED) -> OutboxEvent:
    return OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"health-alert:{uuid.uuid4()}",
        status=status,
        processed_at=timezone.now() if status == OutboxEvent.Status.PROCESSED else None,
    )


def test_historical_resolved_failures_do_not_keep_delivery_health_red(profile):
    _fresh_worker_heartbeats()
    historical_cutoff = timezone.now() - timedelta(days=3)
    failed_email = OutboxEvent.objects.create(
        event_type="guardian.invited",
        aggregate_type="guardian_invitation",
        aggregate_id=uuid.uuid4(),
        deduplication_key=f"health-email:{uuid.uuid4()}",
        status=OutboxEvent.Status.FAILED,
        last_error="Historical SMTP failure",
    )
    incident = _incident(profile, status=AlertIncident.Status.RESOLVED)
    alert_event = _alert_event(incident)
    dead_letter = DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=alert_event,
        status=DeliveryAttempt.Status.DEAD_LETTER,
    )
    OutboxEvent.objects.filter(pk=failed_email.pk).update(updated_at=historical_cutoff)
    DeliveryAttempt.objects.filter(pk=dead_letter.pk).update(updated_at=historical_cutoff)

    health = delivery_health(recent_failure_max_age=timedelta(hours=24))

    assert health["failed_events"] == 0
    assert health["failed_invitation_events"] == 0
    assert health["dead_letter_deliveries"] == 0
    assert health["healthy"] is True


def test_old_failed_alert_for_open_incident_remains_actionable(profile):
    _fresh_worker_heartbeats()
    incident = _incident(profile)
    failed_event = _alert_event(incident, status=OutboxEvent.Status.FAILED)
    OutboxEvent.objects.filter(pk=failed_event.pk).update(
        updated_at=timezone.now() - timedelta(days=3)
    )

    health = delivery_health(recent_failure_max_age=timedelta(hours=24))

    assert health["failed_events"] == 1
    assert health["healthy"] is False


def test_stale_non_terminal_delivery_attempt_is_unhealthy(profile):
    _fresh_worker_heartbeats()
    incident = _incident(profile)
    alert_event = _alert_event(incident)
    attempt = DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=alert_event,
        status=DeliveryAttempt.Status.TICKET_RECEIVED,
        expo_ticket_id="stale-ticket",
    )
    DeliveryAttempt.objects.filter(pk=attempt.pk).update(
        updated_at=timezone.now() - timedelta(minutes=20)
    )

    health = delivery_health(delivery_attempt_max_age=timedelta(minutes=15))

    assert health["stale_delivery_attempts"] == 1
    assert health["missing_delivery_attempts"] == 0
    assert health["healthy"] is False


def test_scheduled_retry_is_not_stale_before_its_retry_time(profile):
    _fresh_worker_heartbeats()
    incident = _incident(profile)
    alert_event = _alert_event(incident)
    attempt = DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=alert_event,
        status=DeliveryAttempt.Status.RETRYABLE_FAILURE,
        next_retry_at=timezone.now() + timedelta(hours=1),
    )
    DeliveryAttempt.objects.filter(pk=attempt.pk).update(
        updated_at=timezone.now() - timedelta(minutes=20)
    )

    health = delivery_health(delivery_attempt_max_age=timedelta(minutes=15))

    assert health["stale_delivery_attempts"] == 0
    assert health["healthy"] is True


def test_processed_alert_for_open_incident_requires_delivery_evidence(profile):
    _fresh_worker_heartbeats()
    active_incident = _incident(profile)
    AlertRecipient.objects.create(
        incident=active_incident,
        user=profile.owner,
        user_id_snapshot=profile.owner_id,
    )
    _alert_event(active_incident)

    health = delivery_health()

    assert health["missing_delivery_attempts"] == 1
    assert health["healthy"] is False

    active_incident.status = AlertIncident.Status.RESOLVED
    active_incident.resolved_at = timezone.now()
    active_incident.save(update_fields=["status", "resolved_at", "updated_at"])
    health = delivery_health()
    assert health["missing_delivery_attempts"] == 0
    assert health["healthy"] is True


def test_processed_alert_without_recipient_does_not_invent_missing_delivery(profile):
    _fresh_worker_heartbeats()
    _alert_event(_incident(profile))

    health = delivery_health()

    assert health["missing_delivery_attempts"] == 0
    assert health["healthy"] is True


def test_anonymized_recipient_without_attempt_does_not_poison_health(profile):
    _fresh_worker_heartbeats()
    incident = _incident(profile)
    AlertRecipient.objects.create(
        incident=incident,
        user=None,
        user_id_snapshot=uuid.uuid4(),
    )
    _alert_event(incident)

    health = delivery_health()

    assert health["missing_delivery_attempts"] == 0
    assert health["healthy"] is True


def test_account_erasure_tombstones_preserve_history_without_poisoning_health(profile):
    _fresh_worker_heartbeats()
    incident = _incident(profile, status=AlertIncident.Status.RESOLVED)
    event = _alert_event(incident)
    DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=event,
        status=DeliveryAttempt.Status.DEAD_LETTER,
        account_erasure_tombstone=True,
    )

    health = delivery_health()

    assert DeliveryAttempt.objects.filter(account_erasure_tombstone=True).exists()
    assert health["dead_letter_deliveries"] == 0
    assert health["stale_delivery_attempts"] == 0


@override_settings(GUARDIAN_LOCATION_DISCLOSURE_ENABLED=False)
def test_disabled_guardian_location_disclosure_fails_delivery_health_visibly():
    _fresh_worker_heartbeats()

    health = delivery_health()

    assert health["healthy"] is False
    assert health["disabled_safety_features"] == ["guardian_location_disclosure"]


@pytest.mark.parametrize(
    ("option", "value", "message"),
    [
        ("heartbeat_max_age_seconds", 0, "heartbeat-max-age-seconds"),
        ("poll_interval", 0, "poll-interval"),
    ],
)
def test_delivery_health_monitor_rejects_non_positive_timing(option, value, message):
    with pytest.raises(CommandError, match=message):
        call_command("check_delivery_health", **{option: value})
