import json
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from io import StringIO

import pytest
from django.core.management import call_command
from django.test import override_settings

from core.health import REQUIRED_DELIVERY_WORKERS
from core.models import AlertIncident, DeliveryAttempt, OutboxEvent, WorkerHeartbeat
from core.safety_metrics import safety_metrics_snapshot
from core.services import create_profile

pytestmark = pytest.mark.django_db


def _outbox_event(*, event_type, aggregate_id, status, created_at):
    event = OutboxEvent.objects.create(
        event_type=event_type,
        aggregate_type="synthetic_aggregate",
        aggregate_id=aggregate_id,
        deduplication_key=f"safety-metrics:{uuid.uuid4()}",
        status=status,
    )
    OutboxEvent.objects.filter(pk=event.pk).update(created_at=created_at)
    return event


def test_snapshot_reports_clock_due_backlog_and_worker_aggregates(user, profile):
    database_now = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)
    app_now = database_now + timedelta(seconds=2.5)
    profile.next_deadline_at = database_now - timedelta(minutes=2)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    materialized_profile = create_profile(
        owner=user,
        name="Materialized synthetic profile",
        interval_seconds=86_400,
    )
    materialized_profile.next_deadline_at = database_now - timedelta(minutes=10)
    materialized_profile.save(update_fields=["next_deadline_at", "updated_at"])
    incident = AlertIncident.objects.create(
        profile=materialized_profile,
        deadline_generation=materialized_profile.deadline_generation,
        deadline_at=materialized_profile.next_deadline_at,
    )

    oldest_alert = _outbox_event(
        event_type="alert.opened",
        aggregate_id=incident.id,
        status=OutboxEvent.Status.PENDING,
        created_at=database_now - timedelta(seconds=90),
    )
    _outbox_event(
        event_type="alert.retry",
        aggregate_id=incident.id,
        status=OutboxEvent.Status.PENDING,
        created_at=database_now - timedelta(seconds=5),
    )
    _outbox_event(
        event_type="guardian.invited",
        aggregate_id=uuid.uuid4(),
        status=OutboxEvent.Status.PENDING,
        created_at=database_now - timedelta(hours=1),
    )
    _outbox_event(
        event_type="alert.resolved",
        aggregate_id=incident.id,
        status=OutboxEvent.Status.PROCESSED,
        created_at=database_now - timedelta(hours=1),
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=oldest_alert,
        status=DeliveryAttempt.Status.DEAD_LETTER,
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=oldest_alert,
        status=DeliveryAttempt.Status.DEAD_LETTER,
        account_erasure_tombstone=True,
    )

    required_workers = sorted(REQUIRED_DELIVERY_WORKERS)
    heartbeat_states = [
        (required_workers[0], 10, True),
        (required_workers[1], 45, False),
        (required_workers[2], 400, True),
        (required_workers[3], 20, True),
    ]
    for worker_name, age_seconds, healthy in heartbeat_states:
        WorkerHeartbeat.objects.create(
            worker_name=worker_name,
            last_seen_at=database_now - timedelta(seconds=age_seconds),
            details={"healthy": healthy},
        )

    snapshot = safety_metrics_snapshot(
        app_now=app_now,
        database_now=database_now,
        heartbeat_max_age=timedelta(minutes=5),
    )

    assert snapshot == {
        "schema_version": 2,
        "observed_at": "2026-07-20T12:00:02.500000+00:00",
        "clock": {
            "app_time": "2026-07-20T12:00:02.500000+00:00",
            "database_time": "2026-07-20T12:00:00+00:00",
            "app_minus_database_seconds": 2.5,
        },
        "deadlines": {
            "eligible_count": 1,
            "oldest_due_age_seconds": 120.0,
            "current_generation_incident_gap_count": 1,
        },
        "incidents": {"open_count": 1},
        "alert_outbox": {
            "pending_count": 2,
            "oldest_pending_age_seconds": 90.0,
        },
        "delivery": {"dead_letter_count": 1},
        "safety_switches": {"guardian_location_disclosure_enabled": True},
        "workers": {
            "required_count": 5,
            "reported_count": 4,
            "missing_count": 1,
            "heartbeat_max_age_seconds": 300.0,
            "oldest_heartbeat_age_seconds": 400.0,
            "stale_count": 1,
            "failing_count": 1,
        },
    }
    rendered = json.dumps(snapshot)
    for forbidden in ("email", "latitude", "longitude", "profile_id", "incident_id", "user_id"):
        assert forbidden not in rendered


def test_empty_snapshot_uses_null_ages():
    observed_at = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)

    snapshot = safety_metrics_snapshot(app_now=observed_at, database_now=observed_at)

    assert snapshot["deadlines"] == {
        "eligible_count": 0,
        "oldest_due_age_seconds": None,
        "current_generation_incident_gap_count": 0,
    }
    assert snapshot["alert_outbox"] == {
        "pending_count": 0,
        "oldest_pending_age_seconds": None,
    }
    assert snapshot["safety_switches"] == {"guardian_location_disclosure_enabled": True}
    assert snapshot["workers"]["oldest_heartbeat_age_seconds"] is None
    assert snapshot["workers"]["missing_count"] == len(REQUIRED_DELIVERY_WORKERS)


def test_one_shot_command_queries_database_clock_and_emits_one_private_snapshot():
    stdout = StringIO()

    call_command("emit_safety_metrics", stdout=stdout)

    lines = stdout.getvalue().splitlines()
    assert len(lines) == 1
    snapshot = json.loads(lines[0])
    assert set(snapshot) == {
        "schema_version",
        "observed_at",
        "clock",
        "deadlines",
        "incidents",
        "alert_outbox",
        "delivery",
        "safety_switches",
        "workers",
    }
    assert isinstance(snapshot["clock"]["app_minus_database_seconds"], float)
    assert snapshot["workers"]["required_count"] == len(REQUIRED_DELIVERY_WORKERS)
    for forbidden in ("email", "latitude", "longitude", "profile_id", "incident_id", "user_id"):
        assert forbidden not in lines[0]


@override_settings(GUARDIAN_LOCATION_DISCLOSURE_ENABLED=False)
def test_snapshot_exposes_disabled_guardian_location_switch_without_sensitive_data():
    observed_at = datetime(2026, 7, 20, 12, 0, tzinfo=UTC)

    snapshot = safety_metrics_snapshot(app_now=observed_at, database_now=observed_at)

    assert snapshot["schema_version"] == 2
    assert snapshot["safety_switches"] == {"guardian_location_disclosure_enabled": False}


def test_watch_mode_emits_json_and_cooperatively_waits(monkeypatch):
    class StopAfterOneWait:
        requested = False
        waited = []

        def wait(self, seconds):
            self.waited.append(seconds)
            self.requested = True

    stop = StopAfterOneWait()

    @contextmanager
    def fake_graceful_stop_signals():
        yield stop

    monkeypatch.setattr(
        "core.management.commands.emit_safety_metrics.graceful_stop_signals",
        fake_graceful_stop_signals,
    )
    monkeypatch.setattr(
        "core.management.commands.emit_safety_metrics.safety_metrics_snapshot",
        lambda **_kwargs: {"schema_version": 1, "safe": True},
    )
    stdout = StringIO()

    call_command("emit_safety_metrics", watch=True, poll_interval=7, stdout=stdout)

    assert stdout.getvalue().splitlines() == ['{"safe":true,"schema_version":1}']
    assert stop.waited == [7]
