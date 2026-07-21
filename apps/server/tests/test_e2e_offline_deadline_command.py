import io
import json
import os
import secrets
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from core.management.commands.seed_e2e import OWNER_EMAIL
from core.models import AlertIncident, AuditEvent, CheckIn, OutboxEvent, User
from core.services import create_profile, perform_check_in

pytestmark = pytest.mark.django_db


@pytest.fixture
def at08_fixture():
    credential = secrets.token_urlsafe(48)
    owner = User.objects.create_user(
        email=OWNER_EMAIL,
        password=credential,
        email_verified_at=timezone.now(),
    )
    profile = create_profile(
        owner=owner,
        name="AT-08 exact profile",
        interval_seconds=3_600,
    )
    return owner, profile, credential


def _command(*, credential, phase, profile_id, incident_id=None):
    stdout = io.StringIO()
    options = {
        "confirm_local_e2e": True,
        "phase": phase,
        "profile_id": profile_id,
        "stdout": stdout,
    }
    if incident_id is not None:
        options["incident_id"] = incident_id
    with (
        patch("core.management.commands.exercise_e2e_offline_deadline.assert_safe_e2e_database"),
        patch.dict(
            os.environ,
            {"HLASIMSE_E2E_CREDENTIAL": credential},
            clear=False,
        ),
    ):
        call_command("exercise_e2e_offline_deadline", **options)
    return json.loads(stdout.getvalue())


def test_at08_command_opens_then_verifies_exact_offline_resolution(at08_fixture):
    owner, profile, credential = at08_fixture
    interval_before = profile.interval_seconds
    deadline_before = profile.next_deadline_at

    opened = _command(
        credential=credential,
        phase="open-incident",
        profile_id=profile.id,
    )

    incident = AlertIncident.objects.get(pk=opened["incident_id"])
    opened_event = OutboxEvent.objects.get(pk=opened["opened_outbox_id"])
    assert opened == {
        "acceptance_test": "AT-08",
        "schema_version": 1,
        "phase": "incident_opened_while_mobile_pending",
        "profile_id": str(profile.id),
        "deadline_generation": incident.deadline_generation,
        "original_deadline_was_future": True,
        "deadline_forced_past_for_e2e": True,
        "production_interval_unchanged": True,
        "profile_interval_seconds": 3_600,
        "server_queued_checkin_count": 0,
        "incident_id": str(incident.id),
        "incident_status": AlertIncident.Status.OPEN,
        "opened_audit_id": str(
            AuditEvent.objects.get(
                aggregate_id=incident.id,
                event_type="incident.opened",
            ).id
        ),
        "opened_audit_system_actor": True,
        "opened_outbox_id": str(opened_event.id),
        "opened_outbox_status": OutboxEvent.Status.PENDING,
        "scheduler_incidents_created": 1,
        "scheduler_events_created": 1,
    }
    profile.refresh_from_db()
    assert profile.interval_seconds == interval_before
    assert profile.next_deadline_at < incident.opened_at
    assert deadline_before > incident.opened_at

    queued = perform_check_in(
        profile=profile,
        idempotency_key="at08-encrypted-device-queue-key",
        client_recorded_at=incident.opened_at - timedelta(seconds=5),
        submitted_from_queue=True,
    ).check_in
    resolved = _command(
        credential=credential,
        phase="verify-resolution",
        profile_id=profile.id,
        incident_id=incident.id,
    )

    incident.refresh_from_db()
    assert resolved["acceptance_test"] == "AT-08"
    assert resolved["phase"] == "exact_incident_resolved_after_api_restart"
    assert resolved["profile_id"] == opened["profile_id"]
    assert resolved["incident_id"] == opened["incident_id"]
    assert resolved["opened_audit_id"] == opened["opened_audit_id"]
    assert resolved["opened_outbox_id"] == opened["opened_outbox_id"]
    assert resolved["queued_check_in_id"] == str(queued.id)
    assert resolved["submitted_from_queue"] is True
    assert resolved["owner_audit_actor_verified"] is True
    assert resolved["client_recorded_before_incident"] is True
    assert resolved["server_accepted_after_incident"] is True
    assert resolved["opened_outbox_preserved"] is True
    assert resolved["audit_event_types"] == [
        "incident.opened",
        "incident.resolved",
        "checkin.confirmed",
    ]
    assert resolved["outbox_event_types"] == ["alert.opened", "alert.resolved"]
    assert incident.status == AlertIncident.Status.RESOLVED
    assert incident.resolved_by_check_in_id == queued.id
    assert CheckIn.objects.filter(profile=profile, submitted_from_queue=True).count() == 1
    assert OutboxEvent.objects.filter(pk=opened_event.id).exists()


def test_at08_command_requires_confirmation_and_matching_run_credential(at08_fixture):
    _, profile, credential = at08_fixture

    with (
        patch("core.management.commands.exercise_e2e_offline_deadline.assert_safe_e2e_database"),
        patch.dict(
            os.environ,
            {"HLASIMSE_E2E_CREDENTIAL": credential},
            clear=False,
        ),
        pytest.raises(CommandError, match="confirm-local-e2e"),
    ):
        call_command(
            "exercise_e2e_offline_deadline",
            phase="open-incident",
            profile_id=profile.id,
        )

    with (
        patch("core.management.commands.exercise_e2e_offline_deadline.assert_safe_e2e_database"),
        patch.dict(
            os.environ,
            {"HLASIMSE_E2E_CREDENTIAL": "x" * 48},
            clear=False,
        ),
        pytest.raises(CommandError, match="authentication failed"),
    ):
        call_command(
            "exercise_e2e_offline_deadline",
            confirm_local_e2e=True,
            phase="open-incident",
            profile_id=profile.id,
        )

    profile.refresh_from_db()
    assert profile.next_deadline_at > timezone.now()
    assert not AlertIncident.objects.filter(profile=profile).exists()


def test_at08_command_rejects_profile_outside_reserved_owner(at08_fixture):
    _, _, credential = at08_fixture
    unrelated = User.objects.create_user(
        email="unrelated@example.cz",
        password=secrets.token_urlsafe(48),
    )
    unrelated_profile = create_profile(
        owner=unrelated,
        name="Unrelated",
        interval_seconds=3_600,
    )

    with pytest.raises(CommandError, match="does not belong"):
        _command(
            credential=credential,
            phase="open-incident",
            profile_id=unrelated_profile.id,
        )


def test_at08_verify_requires_exact_incident_identity(at08_fixture):
    _, profile, credential = at08_fixture
    _command(
        credential=credential,
        phase="open-incident",
        profile_id=profile.id,
    )

    with pytest.raises(CommandError, match="identity does not match"):
        _command(
            credential=credential,
            phase="verify-resolution",
            profile_id=profile.id,
            incident_id=uuid.uuid4(),
        )
