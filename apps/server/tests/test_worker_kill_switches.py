from datetime import timedelta
from uuid import uuid4

import pytest
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from core.models import AlertIncident, OutboxEvent, WorkerHeartbeat

pytestmark = pytest.mark.django_db


def test_disabled_deadline_sweeper_retains_due_deadline_until_reenabled(profile):
    deadline = timezone.now() - timedelta(minutes=5)
    profile.next_deadline_at = deadline
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    with override_settings(DEADLINE_SWEEPER_ENABLED=False):
        call_command("sweep_deadlines")

    assert not AlertIncident.objects.exists()
    assert not OutboxEvent.objects.exists()
    heartbeat = WorkerHeartbeat.objects.get(worker_name="deadline_sweeper")
    assert heartbeat.details["healthy"] is False
    assert heartbeat.details["disabled"] is True

    with override_settings(DEADLINE_SWEEPER_ENABLED=True):
        call_command("sweep_deadlines")

    incident = AlertIncident.objects.get()
    assert incident.deadline_at == deadline
    assert OutboxEvent.objects.filter(event_type="alert.opened").count() == 1
    heartbeat.refresh_from_db()
    assert heartbeat.details["healthy"] is True
    assert heartbeat.details["disabled"] is False


@pytest.mark.parametrize(
    ("queue", "setting_name", "event_type", "worker_name"),
    [
        ("alert", "ALERT_OUTBOX_ENABLED", "alert.opened", "outbox_alerts"),
        ("email", "EMAIL_OUTBOX_ENABLED", "guardian.invited", "outbox_email"),
    ],
)
def test_disabled_outbox_worker_leaves_event_pending(
    queue,
    setting_name,
    event_type,
    worker_name,
):
    event = OutboxEvent.objects.create(
        event_type=event_type,
        aggregate_type="kill_switch_test",
        aggregate_id=uuid4(),
        deduplication_key=f"kill-switch:{queue}",
        payload={},
    )

    with override_settings(**{setting_name: False}):
        call_command("process_outbox", queue=queue)

    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PENDING
    assert event.attempts == 0
    assert event.locked_at is None
    heartbeat = WorkerHeartbeat.objects.get(worker_name=worker_name)
    assert heartbeat.details["healthy"] is False
    assert heartbeat.details["disabled"] is True


def test_combined_outbox_worker_stops_if_either_queue_is_disabled():
    event = OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="kill_switch_test",
        aggregate_id=uuid4(),
        deduplication_key="kill-switch:combined",
        payload={},
    )

    with override_settings(ALERT_OUTBOX_ENABLED=True, EMAIL_OUTBOX_ENABLED=False):
        call_command("process_outbox", queue="all")

    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PENDING
    heartbeat = WorkerHeartbeat.objects.get(worker_name="outbox")
    assert heartbeat.details["healthy"] is False
    assert heartbeat.details["disabled"] is True
