import json
import os
import secrets
from pathlib import Path
from unittest.mock import patch

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError

from core.management.commands.seed_e2e import (
    ARCHIVED_HISTORY_PROFILE_NAME,
    BOUNDARY_GUARDIAN_EMAILS,
    E2E_EMAILS,
    GUARDIAN_EMAIL,
    INCIDENT_PROFILE_NAME,
    OWNER_EMAIL,
    OWNER_SAFE_PROFILE_NAME,
    assert_safe_e2e_database,
)
from core.models import (
    AlertIncident,
    AlertRecipient,
    AuditEvent,
    CheckIn,
    CheckInProfile,
    DeliveryAttempt,
    GuardianMembership,
    OutboxEvent,
    User,
)
from core.services import create_invitation, create_profile, perform_check_in


@pytest.fixture
def e2e_run_credential():
    return secrets.token_urlsafe(48)


def run_seed(capsys, e2e_run_credential, *, mode="guardian-open"):
    # pytest-django intentionally swaps in a test database and DEBUG=False. The
    # fail-closed database predicate is covered independently below.
    with (
        patch("core.management.commands.seed_e2e.assert_safe_e2e_database"),
        patch.dict(
            os.environ,
            {"HLASIMSE_E2E_CREDENTIAL": e2e_run_credential},
            clear=False,
        ),
    ):
        call_command("seed_e2e", confirm_local_e2e=True, mode=mode)
    return json.loads(capsys.readouterr().out.strip())


@pytest.mark.django_db
def test_seed_builds_verified_two_account_incident_dataset(capsys, e2e_run_credential):
    result = run_seed(capsys, e2e_run_credential)

    assert User.objects.filter(email__in=E2E_EMAILS).count() == 2
    owner = User.objects.get(email=OWNER_EMAIL)
    guardian = User.objects.get(email=GUARDIAN_EMAIL)
    assert owner.check_password(e2e_run_credential)
    assert guardian.check_password(e2e_run_credential)
    assert owner.email_verified_at is not None
    assert guardian.email_verified_at is not None

    profile = CheckInProfile.objects.get(owner=owner, archived_at__isnull=True)
    archived_profile = CheckInProfile.objects.get(
        owner=owner,
        name=ARCHIVED_HISTORY_PROFILE_NAME,
        archived_at__isnull=False,
    )
    membership = GuardianMembership.objects.get(profile=profile, guardian=guardian)
    incident = AlertIncident.objects.get(profile=profile, status=AlertIncident.Status.OPEN)
    assert CheckIn.objects.filter(profile=profile).count() == 1
    assert AlertRecipient.objects.filter(
        incident=incident,
        user=guardian,
        user_id_snapshot=guardian.id,
    ).exists()
    assert membership.status == GuardianMembership.Status.ACTIVE
    assert result["incident_id"] == str(incident.id)
    assert result["incidents_created"] == 1
    assert result["outbox_events_created"] == 1
    assert result["archived_profile_id"] == str(archived_profile.id)
    assert result["archived_profile_name"] == ARCHIVED_HISTORY_PROFILE_NAME
    assert archived_profile.enabled is False
    assert archived_profile.is_paused is True
    assert archived_profile.next_deadline_at is None
    assert AuditEvent.objects.filter(
        event_type="profile.archived",
        aggregate_id=archived_profile.id,
    ).exists()
    assert AuditEvent.objects.filter(event_type="incident.opened").exists()
    assert e2e_run_credential not in json.dumps(result)


@pytest.mark.django_db
def test_store_review_seed_keeps_owner_checkin_separate_from_guardian_incident(
    capsys,
    e2e_run_credential,
):
    result = run_seed(capsys, e2e_run_credential, mode="store-review")

    owner = User.objects.get(email=OWNER_EMAIL)
    guardian = User.objects.get(email=GUARDIAN_EMAIL)
    owner_safe_profile = CheckInProfile.objects.get(
        owner=owner,
        name=OWNER_SAFE_PROFILE_NAME,
    )
    incident_profile = CheckInProfile.objects.get(
        owner=owner,
        name=INCIDENT_PROFILE_NAME,
    )
    incident = AlertIncident.objects.get(
        profile=incident_profile,
        status=AlertIncident.Status.OPEN,
    )

    perform_check_in(
        profile=owner_safe_profile,
        idempotency_key="store-review-owner-walkthrough-check-in",
    )
    incident.refresh_from_db()

    assert CheckInProfile.objects.filter(owner=owner, enabled=True).count() == 2
    assert GuardianMembership.objects.filter(
        profile=incident_profile,
        guardian=guardian,
        status=GuardianMembership.Status.ACTIVE,
    ).exists()
    assert incident.status == AlertIncident.Status.OPEN
    assert incident.resolved_at is None
    assert result["active_profile_count"] == 2
    assert result["profile_id"] == str(incident_profile.id)
    assert result["incident_profile_id"] == str(incident_profile.id)
    assert result["incident_profile_name"] == INCIDENT_PROFILE_NAME
    assert result["owner_safe_profile_id"] == str(owner_safe_profile.id)
    assert result["owner_safe_profile_name"] == OWNER_SAFE_PROFILE_NAME


@pytest.mark.django_db
def test_store_review_seed_rebuilds_the_same_named_postconditions(
    capsys,
    e2e_run_credential,
):
    first = run_seed(capsys, e2e_run_credential, mode="store-review")
    first_profile_ids = {
        first["owner_safe_profile_id"],
        first["incident_profile_id"],
    }

    second = run_seed(capsys, e2e_run_credential, mode="store-review")

    owner = User.objects.get(email=OWNER_EMAIL)
    guardian = User.objects.get(email=GUARDIAN_EMAIL)
    profiles = CheckInProfile.objects.filter(owner=owner)
    incident = AlertIncident.objects.get(status=AlertIncident.Status.OPEN)
    assert not CheckInProfile.objects.filter(pk__in=first_profile_ids).exists()
    assert set(profiles.values_list("name", flat=True)) == {
        OWNER_SAFE_PROFILE_NAME,
        INCIDENT_PROFILE_NAME,
    }
    assert incident.profile.name == INCIDENT_PROFILE_NAME
    assert (
        GuardianMembership.objects.filter(
            profile=incident.profile,
            guardian=guardian,
            status=GuardianMembership.Status.ACTIVE,
        ).count()
        == 1
    )
    assert second["active_profile_count"] == 2
    assert second["incident_status"] == AlertIncident.Status.OPEN
    assert second["owner_safe_profile_name"] == OWNER_SAFE_PROFILE_NAME
    assert second["incident_profile_name"] == INCIDENT_PROFILE_NAME


@pytest.mark.django_db
def test_seed_is_idempotent_and_preserves_unrelated_users(capsys, e2e_run_credential):
    unrelated = User.objects.create_user(
        email="developer@example.cz",
        password=secrets.token_urlsafe(48),
    )
    first = run_seed(capsys, e2e_run_credential)
    old_profile_id = first["profile_id"]
    old_archived_profile_id = first["archived_profile_id"]
    old_profile = CheckInProfile.objects.get(pk=old_profile_id)
    old_incident = AlertIncident.objects.get(pk=first["incident_id"])
    old_event = OutboxEvent.objects.get(
        aggregate_id=old_incident.id,
        event_type="alert.opened",
    )
    DeliveryAttempt.objects.create(
        incident=old_incident,
        outbox_event=old_event,
        status="provider_accepted",
        attempt_number=1,
    )
    old_aggregate_ids = {
        old_profile.id,
        old_incident.id,
        *CheckIn.objects.filter(profile=old_profile).values_list("id", flat=True),
        *old_profile.invitations.values_list("id", flat=True),
        *old_profile.guardians.values_list("id", flat=True),
    }
    unrelated_profile = create_profile(
        owner=unrelated,
        name="Unrelated profile",
        interval_seconds=3_600,
    )
    reserved_email_invitation, _raw_token = create_invitation(
        profile=unrelated_profile,
        invited_by=unrelated,
        email=OWNER_EMAIL,
    )
    old_aggregate_ids.add(reserved_email_invitation.id)
    second = run_seed(capsys, e2e_run_credential)

    assert User.objects.filter(pk=unrelated.pk).exists()
    assert CheckInProfile.objects.filter(pk=unrelated_profile.pk).exists()
    assert not unrelated_profile.invitations.filter(pk=reserved_email_invitation.pk).exists()
    assert User.objects.filter(email__in=E2E_EMAILS).count() == 2
    assert CheckInProfile.objects.filter(owner__email=OWNER_EMAIL).count() == 2
    assert AlertIncident.objects.filter(profile__owner__email=OWNER_EMAIL).count() == 1
    assert first["profile_id"] != second["profile_id"]
    assert not CheckInProfile.objects.filter(pk=old_archived_profile_id).exists()
    assert not DeliveryAttempt.objects.filter(outbox_event_id=old_event.id).exists()
    assert not OutboxEvent.objects.filter(aggregate_id__in=old_aggregate_ids).exists()


@pytest.mark.django_db
def test_owner_no_profile_mode_is_explicit_and_clean(capsys, e2e_run_credential):
    with (
        patch("core.management.commands.seed_e2e.assert_safe_e2e_database"),
        patch.dict(
            os.environ,
            {"HLASIMSE_E2E_CREDENTIAL": e2e_run_credential},
            clear=False,
        ),
    ):
        call_command("seed_e2e", confirm_local_e2e=True, mode="owner-no-profile")
    result = json.loads(capsys.readouterr().out.strip())

    assert result["mode"] == "owner-no-profile"
    assert result["profile_id"] is None
    assert User.objects.filter(email__in=E2E_EMAILS).count() == 2
    assert not CheckInProfile.objects.filter(owner__email=OWNER_EMAIL).exists()


@pytest.mark.django_db
def test_free_boundaries_mode_builds_exact_free_tier_limits(capsys, e2e_run_credential):
    with (
        patch("core.management.commands.seed_e2e.assert_safe_e2e_database"),
        patch.dict(
            os.environ,
            {"HLASIMSE_E2E_CREDENTIAL": e2e_run_credential},
            clear=False,
        ),
    ):
        call_command("seed_e2e", confirm_local_e2e=True, mode="free-boundaries")
    result = json.loads(capsys.readouterr().out.strip())

    owner = User.objects.get(email=OWNER_EMAIL)
    profile = CheckInProfile.objects.get(owner=owner, name="E2E hranice 7 dní")
    active_guardians = profile.guardians.filter(status=GuardianMembership.Status.ACTIVE)

    assert result["mode"] == "free-boundaries"
    assert result["active_profile_count"] == 5
    assert result["active_guardian_count"] == 5
    assert result["profile_interval_seconds"] == 604_800
    assert CheckInProfile.objects.filter(owner=owner, enabled=True).count() == 5
    assert active_guardians.count() == 5
    assert profile.interval_seconds == 604_800
    assert set(active_guardians.values_list("guardian__email", flat=True)) == {
        GUARDIAN_EMAIL,
        *BOUNDARY_GUARDIAN_EMAILS,
    }
    assert User.objects.filter(email__in=E2E_EMAILS).count() == 6


@pytest.mark.django_db
def test_cleanup_only_removes_reserved_fixture_without_recreating_it(capsys, e2e_run_credential):
    run_seed(capsys, e2e_run_credential, mode="free-boundaries")
    assert User.objects.filter(email__in=E2E_EMAILS).count() == 6
    with patch("core.management.commands.seed_e2e.assert_safe_e2e_database"):
        call_command("seed_e2e", confirm_local_e2e=True, mode="cleanup-only")
    result = json.loads(capsys.readouterr().out.strip())

    assert result["mode"] == "cleanup-only"
    assert result["removed_aggregate_count"] > 0
    assert not User.objects.filter(email__in=E2E_EMAILS).exists()
    assert result["profile_id"] is None


@pytest.mark.django_db
def test_seed_requires_explicit_confirmation():
    with pytest.raises(CommandError, match="Pass --confirm-local-e2e"):
        call_command("seed_e2e")
    assert not User.objects.filter(email__in=E2E_EMAILS).exists()


@pytest.mark.django_db
def test_seed_rejects_missing_or_short_generated_credential():
    with (
        patch("core.management.commands.seed_e2e.assert_safe_e2e_database"),
        patch.dict(os.environ, {}, clear=True),
        pytest.raises(CommandError, match="generated per run"),
    ):
        call_command("seed_e2e", confirm_local_e2e=True)
    assert not User.objects.filter(email__in=E2E_EMAILS).exists()


def test_database_guard_rejects_debug_false(settings):
    settings.DEBUG = False
    with pytest.raises(CommandError, match="DEBUG is false"):
        assert_safe_e2e_database()


def test_database_guard_rejects_sqlite_outside_server_root(settings, tmp_path):
    settings.DEBUG = True
    unsafe_config = {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": str(Path(tmp_path) / "db.sqlite3"),
    }
    with (
        patch("core.management.commands.seed_e2e.connection.settings_dict", unsafe_config),
        pytest.raises(CommandError, match="repository-local"),
    ):
        assert_safe_e2e_database()


@pytest.mark.parametrize(
    ("host", "name"),
    [("db.example.com", "hlasimse_e2e"), ("127.0.0.1", "hlasimse")],
)
def test_database_guard_rejects_remote_or_non_namespaced_postgres(settings, host, name):
    settings.DEBUG = True
    unsafe_config = {
        "ENGINE": "django.db.backends.postgresql",
        "HOST": host,
        "NAME": name,
    }
    with (
        patch("core.management.commands.seed_e2e.connection.settings_dict", unsafe_config),
        pytest.raises(CommandError, match="loopback/local socket"),
    ):
        assert_safe_e2e_database()


def test_database_guard_accepts_namespaced_local_postgres(settings):
    settings.DEBUG = True
    safe_config = {
        "ENGINE": "django.db.backends.postgresql",
        "HOST": "127.0.0.1",
        "NAME": "hlasimse_e2e",
    }
    with patch("core.management.commands.seed_e2e.connection.settings_dict", safe_config):
        assert_safe_e2e_database()
