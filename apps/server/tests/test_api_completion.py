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
    AlertAcknowledgement,
    AlertIncident,
    AlertRecipient,
    AuditEvent,
    CheckIn,
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
    accepted_at = timezone.now().replace(microsecond=0)
    user.terms_accepted_at = accepted_at
    user.terms_version = "2026-07-21-export-v1"
    user.save(update_fields=["terms_accepted_at", "terms_version"])
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
    assert payload["account"]["terms_accepted_at"] == accepted_at.isoformat().replace("+00:00", "Z")
    assert payload["account"]["terms_version"] == "2026-07-21-export-v1"
    assert payload["check_ins"][0]["latitude"] == "50.075500"
    assert payload["sent_invitations"][0]["id"] == str(invitation.id)
    assert "password" not in serialized
    assert "token_digest" not in serialized
    assert "secret-provider-token" not in serialized
    assert "destination_token_hash" not in serialized


def test_check_in_location_contract_and_owner_only_idempotent_deletion(
    api_client, user, other_user, profile
):
    check_in = perform_check_in(
        profile=profile,
        idempotency_key="location-delete",
        latitude="50.075500",
        longitude="14.437800",
        location_accuracy_meters="8.50",
    ).check_in
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    foreign_owner = User.objects.create_user(
        email="foreign-owner@example.cz",
        password="Safely-testing-123",
    )
    create_profile(owner=foreign_owner, name="Cizí profil", interval_seconds=86_400)
    delete_url = f"/api/v1/check-ins/{check_in.id}/location/"

    history = authenticate(api_client, user).get(f"/api/v1/check-ins/?profile={profile.id}")
    timeline = authenticate(api_client, user).get(
        f"/api/v1/profiles/{profile.id}/timeline/?page_size=100"
    )
    history_item = next(
        item for item in history.json()["results"] if item["id"] == str(check_in.id)
    )
    timeline_item = next(
        item
        for item in timeline.json()["results"]
        if item["event_type"] == "checkin.confirmed"
        and item["details"]["check_in_id"] == str(check_in.id)
    )

    assert history.status_code == timeline.status_code == 200
    assert history["Cache-Control"] == timeline["Cache-Control"] == "no-store, private"
    assert history["Pragma"] == timeline["Pragma"] == "no-cache"
    assert history_item["has_location"] is True
    assert timeline_item["details"]["has_location"] is True
    assert "latitude" not in history.content.decode()
    assert "longitude" not in history.content.decode()
    assert "latitude" not in timeline.content.decode()
    assert "longitude" not in timeline.content.decode()

    guardian_denied = authenticate(api_client, other_user).delete(delete_url)
    foreign_owner_denied = authenticate(api_client, foreign_owner).delete(delete_url)

    assert guardian_denied.status_code == 404
    assert foreign_owner_denied.status_code == 404
    assert guardian_denied["Cache-Control"] == "no-store, private"
    assert foreign_owner_denied["Cache-Control"] == "no-store, private"
    assert guardian_denied["Pragma"] == "no-cache"
    assert foreign_owner_denied["Pragma"] == "no-cache"
    check_in.refresh_from_db()
    assert check_in.latitude is not None
    assert (
        AuditEvent.objects.filter(
            event_type="checkin.location_deleted",
            aggregate_type="check_in",
            aggregate_id=check_in.id,
        ).count()
        == 0
    )

    owner = authenticate(api_client, user)
    deleted = owner.delete(delete_url)
    repeated = owner.delete(delete_url)

    assert deleted.status_code == repeated.status_code == 204
    assert deleted["Cache-Control"] == repeated["Cache-Control"] == "no-store, private"
    assert deleted["Pragma"] == repeated["Pragma"] == "no-cache"
    check_in.refresh_from_db()
    assert check_in.latitude is None
    assert check_in.longitude is None
    assert check_in.location_accuracy_meters is None
    deletion_events = AuditEvent.objects.filter(
        event_type="checkin.location_deleted",
        aggregate_type="check_in",
        aggregate_id=check_in.id,
    )
    assert deletion_events.count() == 1
    assert deletion_events.get().actor == user

    history_after_delete = owner.get(f"/api/v1/check-ins/?profile={profile.id}")
    timeline_after_delete = owner.get(f"/api/v1/profiles/{profile.id}/timeline/?page_size=100")
    history_item = next(
        item for item in history_after_delete.json()["results"] if item["id"] == str(check_in.id)
    )
    timeline_item = next(
        item
        for item in timeline_after_delete.json()["results"]
        if item["event_type"] == "checkin.confirmed"
        and item["details"]["check_in_id"] == str(check_in.id)
    )
    assert history_item["has_location"] is False
    assert timeline_item["details"]["has_location"] is False
    assert CheckIn.objects.filter(pk=check_in.id).exists()


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


def test_account_delete_invalidates_existing_access_and_refresh_tokens(api_client, user):
    issued = api_client.post(
        "/api/v1/auth/token/",
        {"email": user.email, "password": "Safely-testing-123"},
        format="json",
    )
    assert issued.status_code == 200
    tokens = issued.json()
    authenticated = APIClient()
    authenticated.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

    deleted = authenticated.delete(
        "/api/v1/account/",
        {"password": "Safely-testing-123", "confirmed": True},
        format="json",
    )

    assert deleted.status_code == 204
    assert authenticated.get("/api/v1/auth/me/").status_code == 401
    assert (
        api_client.post(
            "/api/v1/auth/token/refresh/",
            {"refresh": tokens["refresh"]},
            format="json",
        ).status_code
        == 401
    )


def test_account_delete_blocks_owner_but_anonymizes_guardian_in_open_incident(
    api_client, user, other_user, profile
):
    remaining_guardian = User.objects.create_user(
        email="remaining-guardian@example.cz",
        password="Safely-testing-123",
    )
    deleted_membership = GuardianMembership.objects.create(
        profile=profile,
        guardian=other_user,
    )
    remaining_membership = GuardianMembership.objects.create(
        profile=profile,
        guardian=remaining_guardian,
    )
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now(),
    )
    deleted_recipient = AlertRecipient.objects.create(
        incident=incident,
        user=other_user,
        user_id_snapshot=other_user.id,
    )
    remaining_recipient = AlertRecipient.objects.create(
        incident=incident,
        user=remaining_guardian,
        user_id_snapshot=remaining_guardian.id,
    )
    deleted_acknowledgement = AlertAcknowledgement.objects.create(
        incident=incident,
        user=other_user,
    )
    remaining_acknowledgement = AlertAcknowledgement.objects.create(
        incident=incident,
        user=remaining_guardian,
    )
    event = OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"role-aware-delete:{incident.id}",
        payload={
            "recipient_user_ids": [str(other_user.id), str(remaining_guardian.id)],
        },
    )
    deleted_device = PushDevice.objects.create(
        user=other_user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[deleted-open-guardian]",
        platform=PushDevice.Platform.ANDROID,
    )
    remaining_device = PushDevice.objects.create(
        user=remaining_guardian,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[remaining-open-guardian]",
        platform=PushDevice.Platform.IOS,
    )
    deleted_attempt = DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=event,
        device=deleted_device,
        device_id_snapshot=deleted_device.id,
        destination_token_hash="deleted-recipient-token-hash",
        platform_snapshot=PushDevice.Platform.ANDROID,
        status=DeliveryAttempt.Status.TICKET_RECEIVED,
        expo_ticket_id="deleted-recipient-ticket",
        response_data={"status": "ok", "id": "deleted-recipient-ticket"},
    )
    remaining_attempt = DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=event,
        device=remaining_device,
        device_id_snapshot=remaining_device.id,
        destination_token_hash="remaining-recipient-token-hash",
        platform_snapshot=PushDevice.Platform.IOS,
        status=DeliveryAttempt.Status.TICKET_RECEIVED,
        expo_ticket_id="remaining-recipient-ticket",
        response_data={"status": "ok", "id": "remaining-recipient-ticket"},
    )

    owner_response = authenticate(api_client, user).delete(
        "/api/v1/account/",
        {"password": "Safely-testing-123", "confirmed": True},
        format="json",
    )

    assert owner_response.status_code == 409
    assert "vašich profilů" in owner_response.json()["error"]["details"]
    assert User.objects.filter(pk=user.pk).exists()
    assert AlertIncident.objects.get(pk=incident.pk).status == AlertIncident.Status.OPEN

    guardian_response = authenticate(api_client, other_user).delete(
        "/api/v1/account/",
        {"password": "Safely-testing-123", "confirmed": True},
        format="json",
    )

    assert guardian_response.status_code == 204
    assert not User.objects.filter(pk=other_user.pk).exists()
    assert User.objects.filter(pk=user.pk).exists()
    assert User.objects.filter(pk=remaining_guardian.pk).exists()
    assert not GuardianMembership.objects.filter(pk=deleted_membership.pk).exists()
    remaining_membership.refresh_from_db()
    assert remaining_membership.status == GuardianMembership.Status.ACTIVE
    incident.refresh_from_db()
    assert incident.status == AlertIncident.Status.OPEN
    assert incident.resolved_at is None
    deleted_recipient.refresh_from_db()
    assert deleted_recipient.user is None
    assert deleted_recipient.user_id_snapshot != other_user.id
    remaining_recipient.refresh_from_db()
    assert remaining_recipient.user == remaining_guardian
    assert remaining_recipient.user_id_snapshot == remaining_guardian.id
    deleted_acknowledgement.refresh_from_db()
    assert deleted_acknowledgement.user is None
    assert deleted_acknowledgement.user_id_snapshot != other_user.id
    remaining_acknowledgement.refresh_from_db()
    assert remaining_acknowledgement.user == remaining_guardian
    assert remaining_acknowledgement.user_id_snapshot == remaining_guardian.id
    event.refresh_from_db()
    assert event.payload["recipient_user_ids"] == [str(remaining_guardian.id)]
    assert not DeliveryAttempt.objects.filter(pk=deleted_attempt.pk).exists()
    deleted_attempt_tombstone = DeliveryAttempt.objects.get(
        incident=incident,
        outbox_event=event,
        device__isnull=True,
        device_id_snapshot__isnull=True,
        platform_snapshot=PushDevice.Platform.ANDROID,
    )
    assert deleted_attempt_tombstone.destination_token_hash == ""
    assert deleted_attempt_tombstone.expo_ticket_id == ""
    assert deleted_attempt_tombstone.response_data == {}
    assert deleted_attempt_tombstone.status == DeliveryAttempt.Status.TICKET_RECEIVED
    assert deleted_attempt_tombstone.account_erasure_tombstone is True
    assert deleted_attempt_tombstone.created_at == deleted_attempt.created_at
    assert (
        DeliveryAttempt.objects.filter(pk=deleted_attempt.pk).update(
            expo_ticket_id="late-provider-ticket",
            response_data={"id": "late-provider-ticket"},
        )
        == 0
    )
    deleted_attempt_tombstone.refresh_from_db()
    assert deleted_attempt_tombstone.expo_ticket_id == ""
    assert deleted_attempt_tombstone.response_data == {}
    remaining_attempt.refresh_from_db()
    assert remaining_attempt.device == remaining_device
    assert remaining_attempt.device_id_snapshot == remaining_device.id
    assert remaining_attempt.destination_token_hash == "remaining-recipient-token-hash"
    assert remaining_attempt.expo_ticket_id == "remaining-recipient-ticket"
    assert remaining_attempt.response_data == {
        "status": "ok",
        "id": "remaining-recipient-ticket",
    }
    owner_detail = authenticate(api_client, user).get(f"/api/v1/alerts/{incident.id}/")
    assert owner_detail.status_code == 200
    serialized_acknowledgement_ids = {
        item["user_id"] for item in owner_detail.json()["acknowledgements"]
    }
    assert str(other_user.id) not in serialized_acknowledgement_ids
    assert str(deleted_acknowledgement.user_id_snapshot) in serialized_acknowledgement_ids
    assert str(remaining_guardian.id) in serialized_acknowledgement_ids


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
    acknowledgement = AlertAcknowledgement.objects.create(
        incident=incident,
        user=user,
    )
    retry_event = OutboxEvent.objects.create(
        event_type="alert.retry",
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"test-alert-retry:{incident.id}",
        payload={"recipient_user_ids": [str(user.id)]},
    )
    device = PushDevice.objects.create(
        user=user,
        installation_id=uuid.uuid4(),
        expo_push_token="ExponentPushToken[account-erasure-target]",
        platform=PushDevice.Platform.IOS,
    )
    attempt = DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=retry_event,
        device=device,
        device_id_snapshot=device.id,
        destination_token_hash="sensitive-destination-hash",
        platform_snapshot=PushDevice.Platform.IOS,
        status=DeliveryAttempt.Status.TICKET_RECEIVED,
        expo_ticket_id="provider-ticket-correlator",
        response_data={"provider_reference": "correlating-response"},
    )
    legacy_attempt = DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=retry_event,
        device=device,
        device_id_snapshot=None,
        destination_token_hash="legacy-sensitive-destination-hash",
        platform_snapshot=PushDevice.Platform.IOS,
        status=DeliveryAttempt.Status.RETRYABLE_FAILURE,
        expo_ticket_id="legacy-provider-ticket-correlator",
        response_data={"legacy": "correlating-response"},
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
    acknowledgement.refresh_from_db()
    assert acknowledgement.user is None
    assert acknowledgement.user_id_snapshot != user.id
    erased_event = OutboxEvent.objects.get(aggregate_id=incident.id)
    assert erased_event.payload["recipient_user_ids"] == []
    assert erased_event.status == OutboxEvent.Status.PROCESSED
    assert erased_event.last_error == "No recipient remains after account erasure"
    assert not DeliveryAttempt.objects.filter(pk__in=[attempt.pk, legacy_attempt.pk]).exists()
    tombstones = list(
        DeliveryAttempt.objects.filter(
            incident=incident,
            outbox_event=retry_event,
            device__isnull=True,
            device_id_snapshot__isnull=True,
            platform_snapshot=PushDevice.Platform.IOS,
        ).order_by("status")
    )
    assert len(tombstones) == 2
    assert {item.status for item in tombstones} == {
        DeliveryAttempt.Status.TICKET_RECEIVED,
        DeliveryAttempt.Status.RETRYABLE_FAILURE,
    }
    assert all(item.destination_token_hash == "" for item in tombstones)
    assert all(item.expo_ticket_id == "" for item in tombstones)
    assert all(item.response_data == {} for item in tombstones)
    assert all(item.next_retry_at is None for item in tombstones)
    assert all(item.account_erasure_tombstone is True for item in tombstones)


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


def test_alert_delivery_status_normalizes_legacy_provider_receipts(api_client, other_user, profile):
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
        expo_push_token="ExponentPushToken[legacy-provider-receipt]",
        platform=PushDevice.Platform.ANDROID,
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        device=device,
        device_id_snapshot=device.id,
        status=DeliveryAttempt.Status.LEGACY_DELIVERED,
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
