import uuid
from datetime import timedelta
from urllib.parse import urlparse

import pytest
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (
    AlertIncident,
    AlertRecipient,
    DeliveryAttempt,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    User,
)
from core.services import (
    create_invitation,
    create_profile,
    perform_check_in,
    sweep_expired_deadlines,
)

pytestmark = pytest.mark.django_db


def authenticate(client, user):
    client.force_authenticate(user=user)
    return client


def test_account_patch_only_updates_names(api_client, user, other_user):
    response = authenticate(api_client, user).patch(
        "/api/v1/auth/me/",
        {
            "email": other_user.email,
            "first_name": "  Anna ",
            "last_name": " Bezpečná  ",
            "is_staff": True,
        },
        format="json",
    )

    assert response.status_code == 200
    user.refresh_from_db()
    assert user.email == "owner@example.cz"
    assert user.first_name == "Anna"
    assert user.last_name == "Bezpečná"
    assert user.is_staff is False


def test_account_export_is_scoped_complete_and_excludes_secrets(api_client, user, profile):
    perform_check_in(
        profile=profile,
        idempotency_key="export-check-in",
        latitude="50.075500",
        longitude="14.437800",
    )
    invitation, _token = create_invitation(
        profile=profile,
        invited_by=user,
        email="guardian@example.cz",
    )
    PushDevice.objects.create(
        user=user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[secret-provider-token]",
        platform="ios",
    )

    response = authenticate(api_client, user).get("/api/v1/account/export/")

    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store"
    payload = response.json()
    serialized = response.content.decode()
    assert payload["account"]["email"] == user.email
    assert payload["check_ins"][0]["latitude"] == "50.075500"
    assert payload["sent_invitations"][0]["id"] == str(invitation.id)
    assert "password" not in serialized
    assert "token_digest" not in serialized
    assert "secret-provider-token" not in serialized
    assert "destination_token_hash" not in serialized


def test_account_delete_requires_confirmation_and_current_password(api_client, user):
    client = authenticate(api_client, user)
    unconfirmed = client.delete(
        "/api/v1/account/",
        {"password": "Safely-testing-123", "confirmed": False},
        format="json",
    )
    wrong_password = client.delete(
        "/api/v1/account/",
        {"password": "Not-the-password", "confirmed": True},
        format="json",
    )

    assert unconfirmed.status_code == 400
    assert wrong_password.status_code == 400
    assert User.objects.filter(pk=user.pk).exists()


def test_account_delete_blocks_any_open_incident(api_client, user, other_user, profile):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now(),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.id,
    )

    for participant in (user, other_user):
        response = authenticate(api_client, participant).delete(
            "/api/v1/account/",
            {"password": "Safely-testing-123", "confirmed": True},
            format="json",
        )
        assert response.status_code == 409
        assert User.objects.filter(pk=participant.pk).exists()
    membership.refresh_from_db()
    assert membership.status == GuardianMembership.Status.ACTIVE


def test_account_delete_anonymizes_closed_third_party_audit(api_client, user, other_user):
    watched = create_profile(owner=other_user, name="Eva", interval_seconds=3600)
    GuardianMembership.objects.create(profile=watched, guardian=user)
    incident = AlertIncident.objects.create(
        profile=watched,
        deadline_generation=watched.deadline_generation,
        deadline_at=timezone.now() - timedelta(hours=2),
        status=AlertIncident.Status.RESOLVED,
        resolved_at=timezone.now() - timedelta(hours=1),
    )
    recipient = AlertRecipient.objects.create(
        incident=incident,
        user=user,
        user_id_snapshot=user.id,
    )
    OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"test-alert:{incident.id}",
        payload={"recipient_user_ids": [str(user.id)]},
    )

    response = authenticate(api_client, user).delete(
        "/api/v1/account/",
        {"password": "Safely-testing-123", "confirmed": True},
        format="json",
    )

    assert response.status_code == 204
    assert not User.objects.filter(pk=user.pk).exists()
    assert AlertIncident.objects.filter(pk=incident.pk).exists()
    recipient.refresh_from_db()
    assert recipient.user is None
    assert recipient.user_id_snapshot != user.id
    assert OutboxEvent.objects.get(aggregate_id=incident.id).payload["recipient_user_ids"] == []


def test_history_is_owner_scoped_paginated_and_validates_filters(
    api_client, user, other_user, profile
):
    own = perform_check_in(profile=profile, idempotency_key="own-history").check_in
    other_profile = create_profile(owner=other_user, name="Cizí", interval_seconds=3600)
    perform_check_in(profile=other_profile, idempotency_key="other-history")
    client = authenticate(api_client, user)

    response = client.get("/api/v1/check-ins/?page_size=1")
    foreign_filter = client.get(f"/api/v1/check-ins/?profile={other_profile.id}")
    invalid_filter = client.get("/api/v1/check-ins/?profile=not-a-uuid")
    invalid_period = client.get(
        "/api/v1/check-ins/?from=2026-07-20T00:00:00Z&to=2026-07-19T00:00:00Z"
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["results"][0]["id"] == str(own.id)
    assert response.json()["results"][0]["server_confirmed"] is True
    assert foreign_filter.status_code == 200
    assert foreign_filter.json()["count"] == 0
    assert invalid_filter.status_code == 400
    assert invalid_period.status_code == 400


def test_statistics_count_only_confirmed_server_records(api_client, user, profile):
    perform_check_in(profile=profile, idempotency_key="on-time")
    profile.refresh_from_db()
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])
    assert sweep_expired_deadlines() == (1, 1)
    perform_check_in(profile=profile, idempotency_key="late-resolver")

    response = authenticate(api_client, user).get("/api/v1/statistics/")

    assert response.status_code == 200
    assert response.json()["total_check_ins"] == 2
    assert response.json()["on_time_check_ins"] == 1
    assert response.json()["incident_count"] == 1
    assert "definitions" in response.json()


def test_received_invitation_flow_does_not_expose_tokens(api_client, user, other_user, profile):
    invitation, raw_token = create_invitation(
        profile=profile,
        invited_by=user,
        email=other_user.email.upper(),
    )
    invited_client = authenticate(api_client, other_user)

    listed = invited_client.get("/api/v1/guardian-invitations/")
    accepted = invited_client.post(
        f"/api/v1/guardian-invitations/{invitation.id}/respond/",
        {"decision": "accept"},
        format="json",
    )

    assert listed.status_code == 200
    assert listed.json()[0]["id"] == str(invitation.id)
    assert raw_token not in listed.content.decode()
    assert "acceptance_token" not in listed.content.decode()
    assert "email" not in listed.json()[0]
    assert accepted.status_code == 200
    assert GuardianMembership.objects.filter(profile=profile, guardian=other_user).exists()


def test_received_invitation_response_prevents_idor_and_supports_decline(
    api_client, user, other_user, profile
):
    invitation, _ = create_invitation(
        profile=profile,
        invited_by=user,
        email=other_user.email,
    )
    stranger = User.objects.create_user(email="stranger@example.cz", password="Safely-testing-123")
    denied = authenticate(api_client, stranger).post(
        f"/api/v1/guardian-invitations/{invitation.id}/respond/",
        {"decision": "decline"},
        format="json",
    )
    declined = authenticate(api_client, other_user).post(
        f"/api/v1/guardian-invitations/{invitation.id}/respond/",
        {"decision": "decline"},
        format="json",
    )

    assert denied.status_code == 404
    assert declined.status_code == 200
    invitation.refresh_from_db()
    assert invitation.status == GuardianInvitation.Status.REVOKED


@override_settings(
    DEBUG=False,
    EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend",
)
def test_production_invitation_create_never_returns_acceptance_token(
    api_client, user, other_user, profile
):
    response = authenticate(api_client, user).post(
        f"/api/v1/profiles/{profile.id}/invitations/",
        {"email": other_user.email},
        format="json",
    )

    assert response.status_code == 201
    assert "acceptance_token" not in response.json()


def test_guardian_can_revoke_only_own_membership(api_client, user, other_user, profile):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    denied = authenticate(api_client, user).post(
        f"/api/v1/guardian-memberships/{membership.id}/revoke/"
    )
    revoked = authenticate(api_client, other_user).post(
        f"/api/v1/guardian-memberships/{membership.id}/revoke/"
    )

    assert denied.status_code == 404
    assert revoked.status_code == 204
    membership.refresh_from_db()
    assert membership.status == GuardianMembership.Status.REVOKED


def test_profile_guardian_list_returns_only_active_memberships(
    api_client, user, other_user, profile
):
    active = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    revoked_user = User.objects.create_user(
        email="revoked@example.test", password="Safely-testing-123"
    )
    GuardianMembership.objects.create(
        profile=profile,
        guardian=revoked_user,
        status=GuardianMembership.Status.REVOKED,
    )

    response = authenticate(api_client, user).get(f"/api/v1/profiles/{profile.id}/guardians/")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(active.id)]


def test_alert_delivery_status_distinguishes_provider_ticket_from_delivery(
    api_client, user, other_user, profile
):
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now(),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.id,
    )
    device = PushDevice.objects.create(
        user=other_user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[delivery-status]",
        platform="android",
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        device=device,
        device_id_snapshot=device.id,
        status=DeliveryAttempt.Status.TICKET_RECEIVED,
    )

    response = authenticate(api_client, other_user).get(f"/api/v1/alerts/{incident.id}/")

    assert response.status_code == 200
    assert response.json()["delivery_status"] == {
        "state": "sent_to_provider",
        "attempt_counts": {"ticket_received": 1},
    }


def test_alert_delivery_status_never_claims_receipt_is_device_delivery(
    api_client, user, other_user, profile
):
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now(),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.id,
    )
    device = PushDevice.objects.create(
        user=other_user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[api-receipt-truth]",
        platform=PushDevice.Platform.ANDROID,
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        device=device,
        device_id_snapshot=device.id,
        status=DeliveryAttempt.Status.PROVIDER_ACCEPTED,
    )

    response = authenticate(api_client, other_user).get(f"/api/v1/alerts/{incident.id}/")

    assert response.status_code == 200
    assert response.json()["delivery_status"] == {
        "state": "accepted_by_push_service",
        "attempt_counts": {"provider_accepted": 1},
    }


def test_password_reset_is_non_enumerating_and_token_is_single_use(api_client, user):
    cache.clear()
    reset_password = f"{uuid.uuid4()}-Safe1!"
    issued_refresh = api_client.post(
        "/api/v1/auth/token/",
        {"email": user.email, "password": "Safely-testing-123"},
    ).json()["refresh"]
    existing = api_client.post("/api/v1/auth/password-reset/", {"email": user.email})
    unknown = api_client.post("/api/v1/auth/password-reset/", {"email": "unknown@example.cz"})

    assert existing.status_code == unknown.status_code == 202
    assert existing.json() == unknown.json()
    assert len(mail.outbox) == 1
    reset_url = next(word for word in mail.outbox[0].body.split() if word.startswith("http"))
    reset_path = urlparse(reset_url).path
    resolved_link = resolve(reset_path)
    rendered_form = api_client.get(reset_path, follow=True)
    payload = {
        "uid": resolved_link.kwargs["uidb64"],
        "token": resolved_link.kwargs["token"],
        "new_password": reset_password,
    }
    confirmed = api_client.post("/api/v1/auth/password-reset/confirm/", payload)
    repeated = api_client.post("/api/v1/auth/password-reset/confirm/", payload)

    assert rendered_form.status_code == 200
    assert "Uložit nové heslo" in rendered_form.content.decode()
    assert confirmed.status_code == 204
    assert repeated.status_code == 400
    assert (
        api_client.post("/api/v1/auth/token/refresh/", {"refresh": issued_refresh}).status_code
        == 401
    )
    user.refresh_from_db()
    assert user.check_password(reset_password)


def test_password_reset_does_not_reveal_smtp_failure(api_client, user, monkeypatch):
    cache.clear()

    def fail_delivery(*args, **kwargs):
        raise OSError("SMTP unavailable")

    monkeypatch.setattr("core.views.send_mail", fail_delivery)
    response = api_client.post("/api/v1/auth/password-reset/", {"email": user.email})

    assert response.status_code == 202


def test_password_reset_request_is_rate_limited(api_client):
    cache.clear()
    responses = [
        api_client.post(
            "/api/v1/auth/password-reset/",
            {"email": f"unknown-{number}@example.cz"},
            REMOTE_ADDR="203.0.113.42",
        )
        for number in range(6)
    ]

    assert [response.status_code for response in responses[:5]] == [202] * 5
    assert responses[5].status_code == 429
    cache.clear()


def test_jwt_api_does_not_accept_cookie_session_or_require_csrf_token(user):
    client = APIClient(enforce_csrf_checks=True)
    client.force_login(user)
    cookie_only = client.patch("/api/v1/auth/me/", {"first_name": "CSRF"}, format="json")
    token = client.post(
        "/api/v1/auth/token/",
        {"email": user.email, "password": "Safely-testing-123"},
        format="json",
    )

    assert cookie_only.status_code == 401
    assert token.status_code == 200
