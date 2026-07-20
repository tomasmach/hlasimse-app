import smtplib
from datetime import timedelta
from importlib import import_module

import pytest
from django.apps import apps as django_apps
from django.core import mail
from django.core.cache import cache
from django.core.exceptions import PermissionDenied
from django.core.mail import EmailMultiAlternatives
from django.db import IntegrityError, transaction
from django.urls import reverse
from django.utils import timezone

from core.email_verification import verification_token
from core.health import delivery_health
from core.models import (
    AuditEvent,
    EmailVerificationChallenge,
    GuardianInvitation,
    OutboxEvent,
    User,
    WorkerHeartbeat,
)
from core.push import process_one_outbox_event
from core.services import create_invitation, create_profile, respond_to_invitation

pytestmark = pytest.mark.django_db


REGISTRATION = {
    "email": "new-owner@example.cz",
    "password": "A-strong-unique-password-123",
    "first_name": "Alena",
    "last_name": "Nová",
}


@pytest.fixture(autouse=True)
def clear_shared_cache():
    cache.clear()
    yield
    cache.clear()


def _register(api_client, **overrides):
    return api_client.post(reverse("register"), {**REGISTRATION, **overrides}, format="json")


def _challenge(email=REGISTRATION["email"]):
    return EmailVerificationChallenge.objects.get(user__email=email)


def test_trusted_manager_is_verified_but_public_registration_is_not(api_client):
    trusted = User.objects.create_user(
        email="fixture@example.cz", password="A-strong-unique-password-123"
    )
    assert trusted.email_verified_at is not None

    response = _register(api_client)

    assert response.status_code == 202
    assert response.data["verification_required"] is True
    public_user = User.objects.get(email=REGISTRATION["email"])
    assert public_user.email_verified_at is None
    assert OutboxEvent.objects.filter(event_type="user.email_verification").count() == 1


def test_registration_replay_is_non_enumerating_and_keeps_valid_challenge(api_client):
    first = _register(api_client)
    challenge = _challenge()
    event = OutboxEvent.objects.get(event_type="user.email_verification")

    replay = _register(api_client, password="Another-strong-password-456")

    assert replay.status_code == first.status_code == 202
    assert replay.data == first.data
    challenge.refresh_from_db()
    assert challenge.cancelled_at is None
    assert EmailVerificationChallenge.objects.count() == 1
    assert OutboxEvent.objects.get().pk == event.pk

    User.objects.create_user(email="verified@example.cz", password="A-strong-unique-password-123")
    verified_replay = _register(api_client, email="verified@example.cz")
    assert verified_replay.status_code == 202
    assert verified_replay.data == first.data
    assert OutboxEvent.objects.count() == 1


def test_database_rejects_case_insensitive_duplicate_email():
    User.objects.create_user(email="Case@Example.cz", password="A-strong-password-123")
    with pytest.raises(IntegrityError), transaction.atomic():
        User.objects.create_user(email="CASE@example.cz", password="A-strong-password-456")


def test_migration_backfills_existing_accounts_as_verified():
    legacy = User.objects.create_user(
        email="legacy@example.cz",
        password="A-strong-password-123",
        email_verified_at=None,
    )
    migration = import_module("core.migrations.0006_email_verification")

    migration.verify_legacy_email_uniqueness_and_backfill(django_apps, None)

    legacy.refresh_from_db()
    assert legacy.email_verified_at is not None


def test_unverified_user_cannot_get_jwt_or_read_or_respond_to_invitations(api_client, user):
    profile = create_profile(owner=user, name="Denní", interval_seconds=86_400)
    invitation, _ = create_invitation(
        profile=profile,
        invited_by=user,
        email="spoofed@example.cz",
    )
    spoofed = User.objects.create_user(
        email="spoofed@example.cz",
        password="A-strong-unique-password-123",
        email_verified_at=None,
    )

    token_response = api_client.post(
        reverse("token"),
        {"email": spoofed.email, "password": "A-strong-unique-password-123"},
        format="json",
    )
    assert token_response.status_code == 401

    api_client.force_authenticate(user=spoofed)
    assert api_client.get(reverse("received-invitations")).status_code == 403
    assert (
        api_client.post(
            reverse("received-invitation-respond", kwargs={"invitation_id": invitation.id}),
            {"decision": "accept"},
            format="json",
        ).status_code
        == 403
    )
    with pytest.raises(PermissionDenied, match="ověřit e-mail"):
        respond_to_invitation(invitation_id=invitation.id, user=spoofed, decision="accept")
    assert invitation.status == GuardianInvitation.Status.PENDING


def test_refresh_token_is_rejected_if_account_becomes_unverified(api_client, user):
    login_response = api_client.post(
        reverse("token"),
        {"email": user.email, "password": "Safely-testing-123"},
        format="json",
    )
    assert login_response.status_code == 200
    User.objects.filter(pk=user.pk).update(email_verified_at=None)

    refreshed = api_client.post(
        reverse("token-refresh"),
        {"refresh": login_response.data["refresh"]},
        format="json",
    )
    assert refreshed.status_code == 401


def test_unverified_owner_cannot_create_invitation_through_service():
    owner = User.objects.create_user(
        email="unverified-owner@example.cz",
        password="A-strong-unique-password-123",
        email_verified_at=None,
    )
    profile = create_profile(owner=owner, name="Denní", interval_seconds=86_400)
    with pytest.raises(PermissionDenied, match="ověřit e-mail"):
        create_invitation(profile=profile, invited_by=owner, email="guardian@example.cz")
    assert GuardianInvitation.objects.count() == 0


def test_signed_token_expires_and_is_one_time(api_client):
    _register(api_client)
    challenge = _challenge()
    token = verification_token(challenge)

    verified = api_client.post(
        reverse("email-verification-confirm"), {"token": token}, format="json"
    )
    reused = api_client.post(reverse("email-verification-confirm"), {"token": token}, format="json")

    assert verified.status_code == 200
    assert verified.data == {"status": "verified"}
    assert reused.status_code == 200
    assert reused.data == {"status": "already_verified"}
    assert User.objects.get(email=REGISTRATION["email"]).email_verified_at is not None
    assert AuditEvent.objects.filter(event_type="user.email_verified", metadata={}).count() == 1

    _register(api_client, email="expired@example.cz")
    expired = _challenge("expired@example.cz")
    expired.expires_at = timezone.now() - timedelta(seconds=1)
    expired.save(update_fields=["expires_at", "updated_at"])
    expired_response = api_client.post(
        reverse("email-verification-confirm"),
        {"token": verification_token(expired)},
        format="json",
    )
    assert expired_response.status_code == 400
    assert expired_response.data == {"status": "expired"}


def test_resend_is_non_enumerating_and_has_cache_and_database_cooldowns(api_client):
    cache.clear()
    _register(api_client)
    first_challenge = _challenge()
    endpoint = reverse("email-verification-resend")

    existing = api_client.post(endpoint, {"email": REGISTRATION["email"]}, format="json")
    unknown = api_client.post(endpoint, {"email": "unknown@example.cz"}, format="json")
    repeated = api_client.post(endpoint, {"email": REGISTRATION["email"]}, format="json")

    assert existing.status_code == unknown.status_code == repeated.status_code == 202
    assert existing.data == unknown.data == repeated.data
    assert EmailVerificationChallenge.objects.filter(user__email=REGISTRATION["email"]).count() == 1
    assert OutboxEvent.objects.filter(event_type="user.email_verification").count() == 1

    first_token = verification_token(first_challenge)
    EmailVerificationChallenge.objects.filter(pk=first_challenge.pk).update(
        last_delivery_requested_at=timezone.now() - timedelta(seconds=61)
    )
    cache.clear()
    replacement = api_client.post(endpoint, {"email": REGISTRATION["email"]}, format="json")
    assert replacement.status_code == 202
    first_challenge.refresh_from_db()
    assert first_challenge.cancelled_at is None
    assert verification_token(first_challenge) == first_token
    assert EmailVerificationChallenge.objects.filter(user__email=REGISTRATION["email"]).count() == 1
    assert OutboxEvent.objects.filter(event_type="user.email_verification").count() == 2

    assert process_one_outbox_event()
    assert process_one_outbox_event()
    links = [
        line
        for message in mail.outbox
        for line in message.body.splitlines()
        if "/ucet/overeni-emailu/" in line
    ]
    assert len(links) == 2
    assert links[0] == links[1]
    assert mail.outbox[0].extra_headers["Message-ID"] != mail.outbox[1].extra_headers["Message-ID"]

    confirmed = api_client.post(
        reverse("email-verification-confirm"), {"token": first_token}, format="json"
    )
    repeated_copy = api_client.post(
        reverse("email-verification-confirm"),
        {"token": verification_token(first_challenge)},
        format="json",
    )
    assert confirmed.data == {"status": "verified"}
    assert repeated_copy.data == {"status": "already_verified"}


def test_verification_email_uses_outbox_stable_message_id_and_minimal_content(api_client):
    _register(api_client)
    challenge = _challenge()
    event = OutboxEvent.objects.get(event_type="user.email_verification")

    assert process_one_outbox_event()

    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == [REGISTRATION["email"]]
    assert REGISTRATION["email"] not in message.body
    assert REGISTRATION["first_name"] not in message.body
    assert str(challenge.user_id) not in message.body
    assert "/ucet/overeni-emailu/" in message.body
    assert message.extra_headers["Message-ID"] == f"<email-verification-{event.id}@hlasim.se>"
    assert len(message.alternatives) == 1


def test_verification_outbox_retries_and_deleted_account_is_terminal(api_client, monkeypatch):
    _register(api_client)
    event = OutboxEvent.objects.get(event_type="user.email_verification")

    def fail_smtp(*_args, **_kwargs):
        raise smtplib.SMTPServerDisconnected("provider timeout with private details")

    monkeypatch.setattr(EmailMultiAlternatives, "send", fail_smtp)
    for worker_name in {"deadline_sweeper", "outbox", "push_receipts"}:
        WorkerHeartbeat.objects.update_or_create(worker_name=worker_name)

    assert process_one_outbox_event()
    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PENDING
    assert event.attempts == 1
    assert "private details" not in event.last_error
    assert delivery_health()["retrying_verification_events"] == 1
    assert delivery_health()["healthy"] is False

    event.available_at = timezone.now() - timedelta(seconds=1)
    event.last_error = ""
    event.save(update_fields=["available_at", "last_error", "updated_at"])
    User.objects.get(email=REGISTRATION["email"]).delete()
    assert process_one_outbox_event()
    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert "deleted" in event.last_error


def test_web_registration_verification_and_stale_session_gate(client, settings):
    settings.ROOT_URLCONF = "core.web_urls"
    response = client.post(
        reverse("accounts:register"),
        {
            "email": REGISTRATION["email"],
            "first_name": REGISTRATION["first_name"],
            "last_name": REGISTRATION["last_name"],
            "password1": REGISTRATION["password"],
            "password2": REGISTRATION["password"],
            "terms": "on",
        },
    )
    assert response.status_code == 302
    assert response.url == reverse("accounts:verification-sent")
    assert "_auth_user_id" not in client.session

    user = User.objects.get(email=REGISTRATION["email"])
    client.force_login(user)
    assert client.get(reverse("core:dashboard")).status_code == 302

    challenge = _challenge()
    result = client.get(
        reverse("accounts:verify-email", kwargs={"token": verification_token(challenge)})
    )
    assert result.status_code == 200
    assert "E-mail je ověřený" in result.content.decode()

    logged_in = client.post(
        reverse("accounts:login"),
        {"username": REGISTRATION["email"], "password": REGISTRATION["password"]},
    )
    assert logged_in.status_code == 302
    assert logged_in.url == reverse("core:dashboard")
