from datetime import timedelta

import pytest
from django.core.exceptions import ValidationError
from django.utils import timezone

from core.models import (
    PAUSED_UNTIL_MAX_ERROR,
    AlertIncident,
    AlertRecipient,
    GuardianMembership,
    OutboxEvent,
    User,
)
from core.services import (
    accept_invitation,
    create_invitation,
    create_profile,
    perform_check_in,
    sweep_expired_deadlines,
    update_profile,
)

pytestmark = pytest.mark.django_db


def test_deadline_sweeper_is_repeatable_per_generation(profile):
    expired_at = timezone.now() - timedelta(minutes=5)
    profile.next_deadline_at = expired_at
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    first = sweep_expired_deadlines(now=timezone.now())
    second = sweep_expired_deadlines(now=timezone.now())

    assert first == (1, 1)
    assert second == (0, 0)
    incident = AlertIncident.objects.get()
    assert incident.profile == profile
    assert incident.deadline_generation == profile.deadline_generation
    assert incident.deadline_at == expired_at
    assert OutboxEvent.objects.filter(event_type="alert.opened").count() == 1


def test_new_checkin_resolves_open_incident_and_advances_generation(profile):
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=profile.next_deadline_at,
    )

    result = perform_check_in(profile=profile, idempotency_key="resolution-test")

    incident.refresh_from_db()
    profile.refresh_from_db()
    assert result.created is True
    assert incident.status == AlertIncident.Status.RESOLVED
    assert incident.resolved_at is not None
    assert profile.deadline_generation == incident.deadline_generation + 1


def test_disabled_profile_does_not_generate_incident(profile):
    profile.enabled = False
    profile.next_deadline_at = timezone.now() - timedelta(hours=1)
    profile.save(update_fields=["enabled", "next_deadline_at", "updated_at"])

    assert sweep_expired_deadlines() == (0, 0)
    assert not AlertIncident.objects.exists()


def test_late_checkin_materializes_then_resolves_incident_with_recipient_outbox(
    profile, other_user
):
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    result = perform_check_in(profile=profile, idempotency_key="late-sync")

    incident = AlertIncident.objects.get(profile=profile)
    recipient = AlertRecipient.objects.get(incident=incident)
    assert incident.status == AlertIncident.Status.RESOLVED
    assert incident.resolved_by_check_in == result.check_in
    assert recipient.user_id_snapshot == other_user.id
    assert OutboxEvent.objects.filter(event_type="alert.opened").count() == 1
    resolution = OutboxEvent.objects.get(event_type="alert.resolved")
    assert resolution.payload["recipient_user_ids"] == [str(other_user.id)]


def test_late_deadline_is_materialized_before_interval_update(profile):
    expired = timezone.now() - timedelta(minutes=1)
    old_generation = profile.deadline_generation
    profile.next_deadline_at = expired
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    updated = update_profile(profile=profile, values={"interval_seconds": 7_200})

    incident = AlertIncident.objects.get(profile=profile)
    assert incident.deadline_generation == old_generation
    assert incident.deadline_at == expired
    assert updated.deadline_generation == old_generation + 1
    assert updated.next_deadline_at > timezone.now() + timedelta(minutes=119)


def test_pause_materializes_late_deadline_and_never_resolves_open_incident(profile):
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])
    paused_until = timezone.now() + timedelta(days=2)

    paused = update_profile(
        profile=profile,
        values={"is_paused": True, "paused_until": paused_until},
    )

    assert paused.is_paused is True
    assert paused.paused_until == paused_until
    assert paused.next_deadline_at is None
    assert AlertIncident.objects.get(profile=profile).status == AlertIncident.Status.OPEN
    assert sweep_expired_deadlines(now=paused_until - timedelta(seconds=1)) == (0, 0)

    resumed = update_profile(profile=paused, values={"is_paused": False})
    assert resumed.is_paused is False
    assert resumed.paused_until is None
    assert resumed.next_deadline_at > timezone.now() + timedelta(hours=23)
    assert AlertIncident.objects.get(profile=profile).status == AlertIncident.Status.OPEN


def test_custom_pause_horizon_is_enforced_by_model_and_service_without_partial_update(
    profile,
    monkeypatch,
):
    server_now = timezone.now().replace(microsecond=0)
    monkeypatch.setattr(timezone, "now", lambda: server_now)
    boundary = server_now + timedelta(days=366)

    updated = update_profile(
        profile=profile,
        values={"is_paused": True, "paused_until": boundary},
    )
    assert updated.paused_until == boundary
    updated.full_clean()

    resumed = update_profile(profile=updated, values={"is_paused": False})
    original_generation = resumed.deadline_generation
    original_deadline = resumed.next_deadline_at
    far_future = server_now + timedelta(days=366, microseconds=1)
    resumed.is_paused = True
    resumed.paused_until = far_future
    with pytest.raises(ValidationError) as model_error:
        resumed.full_clean()
    assert model_error.value.message_dict == {"paused_until": [PAUSED_UNTIL_MAX_ERROR]}

    with pytest.raises(ValidationError) as service_error:
        update_profile(
            profile=resumed,
            values={"is_paused": True, "paused_until": far_future},
        )
    assert service_error.value.message_dict == {"paused_until": [PAUSED_UNTIL_MAX_ERROR]}
    resumed.refresh_from_db()
    assert resumed.is_paused is False
    assert resumed.paused_until is None
    assert resumed.deadline_generation == original_generation
    assert resumed.next_deadline_at == original_deadline


def test_sweeper_does_not_starve_fresh_generations_behind_materialized_rows(user, profile):
    second = create_profile(owner=user, name="Druhý", interval_seconds=3_600)
    third = create_profile(owner=user, name="Třetí", interval_seconds=3_600)
    now = timezone.now()
    for index, candidate in enumerate((profile, second, third), start=1):
        candidate.next_deadline_at = now - timedelta(minutes=10 - index)
        candidate.save(update_fields=["next_deadline_at", "updated_at"])
    for candidate in (profile, second):
        AlertIncident.objects.create(
            profile=candidate,
            deadline_generation=candidate.deadline_generation,
            deadline_at=candidate.next_deadline_at,
        )

    assert sweep_expired_deadlines(now=now, limit=1) == (1, 1)
    assert AlertIncident.objects.filter(profile=third).exists()


def test_accepting_sixth_guardian_is_rejected_under_profile_limit(profile):
    users = [
        User.objects.create_user(email=f"g{number}@example.cz", password="Long-pass-123")
        for number in range(6)
    ]
    tokens = [
        create_invitation(profile=profile, invited_by=profile.owner, email=user.email)[1]
        for user in users
    ]
    for user, token in zip(users[:5], tokens[:5], strict=True):
        accept_invitation(raw_token=token, user=user)

    with pytest.raises(ValidationError) as exc_info:
        accept_invitation(raw_token=tokens[5], user=users[5])

    assert exc_info.value.message_dict == {
        "guardians": ["Vše je zdarma. Limit je 5/5 aktivních strážců na profil."]
    }
    assert profile.guardians.filter(status=GuardianMembership.Status.ACTIVE).count() == 5
