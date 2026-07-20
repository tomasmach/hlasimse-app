import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from core.models import (
    AlertIncident,
    AlertRecipient,
    CheckIn,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    User,
)
from core.services import create_profile, perform_check_in, sweep_expired_deadlines

pytestmark = pytest.mark.django_db


def authenticate(client, user):
    client.force_authenticate(user=user)
    return client


def test_profile_endpoints_prevent_ownership_idor(api_client, user, other_user, profile):
    client = authenticate(api_client, other_user)

    assert client.get(f"/api/v1/profiles/{profile.id}/").status_code == 404
    response = client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        {},
        HTTP_IDEMPOTENCY_KEY="stolen-profile-checkin",
    )

    assert response.status_code == 404
    assert CheckIn.objects.count() == 0


def test_account_cannot_create_more_than_five_profiles(api_client, user):
    client = authenticate(api_client, user)
    for number in range(5):
        response = client.post(
            "/api/v1/profiles/",
            {"name": f"Profil {number}", "interval_seconds": 3600},
        )
        assert response.status_code == 201

    response = client.post(
        "/api/v1/profiles/",
        {"name": "Šestý", "interval_seconds": 3600},
    )

    assert response.status_code == 400
    assert user.profiles.count() == 5


def test_checkin_api_is_idempotent_and_uses_server_time(api_client, user, profile):
    client = authenticate(api_client, user)
    impossible_client_time = timezone.now() - timedelta(days=30)
    payload = {
        "client_recorded_at": impossible_client_time.isoformat(),
        "latitude": "50.075500",
        "longitude": "14.437800",
    }

    first = client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        payload,
        HTTP_IDEMPOTENCY_KEY="offline-event-123",
    )
    second = client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        payload,
        HTTP_IDEMPOTENCY_KEY="offline-event-123",
    )

    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json() == second.json()
    assert CheckIn.objects.filter(profile=profile).count() == 1
    profile.refresh_from_db()
    check_in = profile.check_ins.get()
    assert profile.deadline_generation == 2
    assert abs((profile.last_checked_in_at - timezone.now()).total_seconds()) < 5
    assert profile.next_deadline_at == profile.last_checked_in_at + timedelta(days=1)
    assert check_in.client_recorded_at < check_in.accepted_at - timedelta(days=29)
    assert OutboxEvent.objects.filter(event_type="checkin.accepted").count() == 0
    assert "latitude" not in first.json()
    assert "longitude" not in first.json()


def test_guardian_and_push_device_endpoints_prevent_idor(api_client, user, other_user, profile):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    device = PushDevice.objects.create(
        user=user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[owners-device]",
        platform="ios",
    )
    client = authenticate(api_client, other_user)

    watched = client.get("/api/v1/watched-profiles/")
    delete = client.delete(f"/api/v1/push-devices/{device.id}/")

    assert membership.status == GuardianMembership.Status.ACTIVE
    assert watched.status_code == 200
    assert watched.json()[0]["id"] == str(profile.id)
    assert "email" not in watched.json()[0]
    assert "latitude" not in watched.json()[0]
    assert delete.status_code == 404
    device.refresh_from_db()
    assert device.active is True


def test_alert_detail_and_ack_only_allow_owner_or_active_guardian(
    api_client, user, other_user, profile
):
    guardian = other_user
    stranger = User.objects.create_user(email="stranger@example.cz", password="Long-pass-123")
    GuardianMembership.objects.create(profile=profile, guardian=guardian)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.create(incident=incident, user=guardian, user_id_snapshot=guardian.id)

    guardian_client = authenticate(api_client, guardian)
    detail = guardian_client.get(f"/api/v1/alerts/{incident.id}/")
    ack = guardian_client.post(f"/api/v1/alerts/{incident.id}/acknowledge/")
    stranger_client = authenticate(api_client, stranger)
    denied = stranger_client.get(f"/api/v1/alerts/{incident.id}/")

    assert detail.status_code == 200
    assert ack.status_code == 200
    assert denied.status_code == 404
    serialized = detail.json()
    assert "latitude" not in serialized
    assert "longitude" not in serialized
    assert "owner_email" not in serialized
    assert ack.json()["acknowledgements"][0]["user_id"] == str(guardian.id)
    assert detail.json()["can_acknowledge"] is True

    owner_client = authenticate(api_client, user)
    owner_detail = owner_client.get(f"/api/v1/alerts/{incident.id}/")
    owner_ack = owner_client.post(f"/api/v1/alerts/{incident.id}/acknowledge/")
    assert owner_detail.json()["can_acknowledge"] is False
    assert owner_ack.status_code == 403
    assert not incident.acknowledgements.filter(user=user).exists()


def test_invitation_can_only_be_accepted_by_matching_email(api_client, user, other_user, profile):
    owner_client = authenticate(api_client, user)
    created = owner_client.post(
        f"/api/v1/profiles/{profile.id}/invitations/",
        {"email": other_user.email},
    )
    assert created.status_code == 201
    token = created.json()["acceptance_token"]

    stranger = User.objects.create_user(email="wrong@example.cz", password="Long-pass-123")
    wrong_client = authenticate(api_client, stranger)
    assert (
        wrong_client.post("/api/v1/guardian-invitations/accept/", {"token": token}).status_code
        == 403
    )

    invited_client = authenticate(api_client, other_user)
    accepted = invited_client.post("/api/v1/guardian-invitations/accept/", {"token": token})
    repeated = invited_client.post("/api/v1/guardian-invitations/accept/", {"token": token})

    assert accepted.status_code == 200
    assert repeated.status_code == 200
    assert GuardianMembership.objects.filter(profile=profile, guardian=other_user).count() == 1


def test_profile_list_only_returns_current_owners_profiles(api_client, user, other_user):
    own = create_profile(owner=user, name="Vlastní", interval_seconds=3600)
    create_profile(owner=other_user, name="Cizí", interval_seconds=3600)

    response = authenticate(api_client, user).get("/api/v1/profiles/")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(own.id)]


@pytest.mark.parametrize(
    ("interval", "expected_status"),
    [(3600, 201), (604800, 201), (3599, 400), (604801, 400), (3661, 400)],
)
def test_profile_interval_boundaries_are_exact_minutes(api_client, user, interval, expected_status):
    response = authenticate(api_client, user).post(
        "/api/v1/profiles/",
        {"name": f"Interval {interval}", "interval_seconds": interval},
    )

    assert response.status_code == expected_status


def test_idempotent_receipt_keeps_original_deadline_after_profile_advances(
    api_client, user, profile
):
    client = authenticate(api_client, user)
    first = client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        HTTP_IDEMPOTENCY_KEY="stable-receipt",
    )
    client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        HTTP_IDEMPOTENCY_KEY="later-checkin",
    )
    repeated = client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        HTTP_IDEMPOTENCY_KEY="stable-receipt",
    )

    assert repeated.status_code == 200
    assert repeated.json() == first.json()


def test_duplicate_and_eleventh_pending_invitation_are_clean_400(api_client, user, profile):
    client = authenticate(api_client, user)
    first = client.post(f"/api/v1/profiles/{profile.id}/invitations/", {"email": "same@example.cz"})
    duplicate = client.post(
        f"/api/v1/profiles/{profile.id}/invitations/", {"email": "SAME@example.cz"}
    )
    for number in range(1, 10):
        assert (
            client.post(
                f"/api/v1/profiles/{profile.id}/invitations/",
                {"email": f"guardian-{number}@example.cz"},
            ).status_code
            == 201
        )
    eleventh = client.post(
        f"/api/v1/profiles/{profile.id}/invitations/",
        {"email": "guardian-10@example.cz"},
    )

    assert first.status_code == 201
    assert duplicate.status_code == 400
    assert eleventh.status_code == 400


def test_push_device_can_be_safely_rebound_with_matching_installation_token(
    api_client, user, other_user
):
    installation_id = uuid.uuid4()
    payload = {
        "installation_id": str(installation_id),
        "expo_push_token": "ExponentPushToken[rebind]",
        "platform": "ios",
    }
    assert authenticate(api_client, user).post("/api/v1/push-devices/", payload).status_code == 201
    rebound = authenticate(api_client, other_user).post("/api/v1/push-devices/", payload)
    unsafe = authenticate(api_client, user).post(
        "/api/v1/push-devices/", {**payload, "expo_push_token": "ExponentPushToken[changed]"}
    )

    assert rebound.status_code == 201
    assert unsafe.status_code == 400
    assert PushDevice.objects.get(installation_id=installation_id).user == other_user


def test_real_jwt_rotation_blacklist_and_logout_subject_check(api_client, user, other_user):
    issued = api_client.post(
        "/api/v1/auth/token/",
        {"email": user.email, "password": "Safely-testing-123"},
    )
    assert issued.status_code == 200
    old_refresh = issued.json()["refresh"]
    rotated = api_client.post("/api/v1/auth/token/refresh/", {"refresh": old_refresh})
    assert rotated.status_code == 200
    assert (
        api_client.post("/api/v1/auth/token/refresh/", {"refresh": old_refresh}).status_code == 401
    )

    other_tokens = api_client.post(
        "/api/v1/auth/token/",
        {"email": other_user.email, "password": "Safely-testing-123"},
    ).json()
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {rotated.json()['access']}")
    mismatch = api_client.post("/api/v1/auth/logout/", {"refresh": other_tokens["refresh"]})
    logout = api_client.post("/api/v1/auth/logout/", {"refresh": rotated.json()["refresh"]})

    assert mismatch.status_code == 400
    assert logout.status_code == 204
    api_client.credentials()
    assert (
        api_client.post(
            "/api/v1/auth/token/refresh/", {"refresh": rotated.json()["refresh"]}
        ).status_code
        == 401
    )


def test_location_with_accuracy_only_exists_on_active_incident_for_current_recipient(
    api_client, user, other_user, profile
):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    perform_check_in(
        profile=profile,
        idempotency_key="location-source",
        latitude="50.075500",
        longitude="14.437800",
        location_accuracy_meters="12.50",
    )
    profile.refresh_from_db()
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])
    sweep_expired_deadlines()
    incident = AlertIncident.objects.get(profile=profile)

    guardian_detail = authenticate(api_client, other_user).get(f"/api/v1/alerts/{incident.id}/")
    assert guardian_detail.status_code == 200
    assert guardian_detail.json()["last_known_location"] == {
        "latitude": "50.075500",
        "longitude": "14.437800",
        "accuracy_meters": "12.50",
        "recorded_at": guardian_detail.json()["last_known_location"]["recorded_at"],
        "is_live": False,
    }

    membership.status = GuardianMembership.Status.REVOKED
    membership.save(update_fields=["status", "updated_at"])
    assert (
        authenticate(api_client, other_user).get(f"/api/v1/alerts/{incident.id}/").status_code
        == 404
    )
    perform_check_in(profile=profile, idempotency_key="resolve-location-incident")
    owner_detail = authenticate(api_client, user).get(f"/api/v1/alerts/{incident.id}/")
    assert owner_detail.status_code == 200
    assert owner_detail.json()["last_known_location"] is None
