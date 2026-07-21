import smtplib
from datetime import timedelta

import pytest
from django.core import mail
from django.core.mail import EmailMultiAlternatives
from django.utils import timezone

from core.health import delivery_health
from core.models import GuardianInvitation, OutboxEvent, WorkerHeartbeat
from core.push import MAX_EVENT_ATTEMPTS, process_one_outbox_event
from core.services import create_invitation


def _invitation(profile):
    invitation, raw_token = create_invitation(
        profile=profile,
        invited_by=profile.owner,
        email="  STRAZCE@Example.CZ ",
    )
    event = OutboxEvent.objects.get(
        event_type="guardian.invited",
        aggregate_id=invitation.id,
    )
    return invitation, raw_token, event


def _fresh_delivery_heartbeats():
    for worker_name in {
        "deadline_sweeper",
        "outbox_alerts",
        "outbox_email",
        "push_receipts",
        "safety_reconciliation",
    }:
        WorkerHeartbeat.objects.update_or_create(worker_name=worker_name)


@pytest.mark.django_db
def test_invitation_email_is_sent_to_normalized_recipient_without_secrets(profile):
    invitation, raw_token, event = _invitation(profile)
    event.payload = {
        "email": "attacker@example.cz",
        "profile_name": "NEVER INCLUDE THIS PROFILE",
        "location": {"latitude": 50.087, "longitude": 14.421},
    }
    event.save(update_fields=["payload", "updated_at"])

    assert process_one_outbox_event()

    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert len(mail.outbox) == 1
    message = mail.outbox[0]
    assert message.to == [invitation.normalized_email]
    assert message.to == ["strazce@example.cz"]
    assert message.from_email
    assert "Pozvánka" in message.subject
    assert f"/strazci/?invitation={invitation.id}" in message.body
    assert invitation.token_digest not in message.body
    assert raw_token not in message.body
    assert "attacker@example.cz" not in message.body
    assert "NEVER INCLUDE THIS PROFILE" not in message.body
    assert "50.087" not in message.body
    assert str(profile.id) not in message.body
    assert profile.name not in message.body
    assert message.extra_headers["Message-ID"] == (f"<guardian-invitation-{event.id}@hlasim.se>")
    html_body = message.alternatives[0].content
    assert f"invitation={invitation.id}" in html_body
    assert invitation.token_digest not in html_body
    assert raw_token not in html_body
    assert "112" in message.body and "155" in message.body


@pytest.mark.django_db
def test_invitation_message_id_uses_configured_sender_domain(profile, settings):
    settings.EMAIL_MESSAGE_ID_DOMAIN = "mail.hlasimse.cz"
    _invitation_record, _raw_token, event = _invitation(profile)

    assert process_one_outbox_event()

    assert mail.outbox[0].extra_headers["Message-ID"] == (
        f"<guardian-invitation-{event.id}@mail.hlasimse.cz>"
    )


@pytest.mark.django_db
def test_smtp_failure_retries_then_dead_letters_without_escaping_worker(profile, monkeypatch):
    _invitation_record, _raw_token, event = _invitation(profile)

    def fail_smtp(*_args, **_kwargs):
        raise smtplib.SMTPServerDisconnected("provider timeout with potentially sensitive text")

    monkeypatch.setattr(EmailMultiAlternatives, "send", fail_smtp)
    _fresh_delivery_heartbeats()

    assert process_one_outbox_event()
    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PENDING
    assert event.attempts == 1
    assert "SMTPServerDisconnected" in event.last_error
    assert "sensitive text" not in event.last_error
    assert delivery_health()["retrying_invitation_events"] == 1
    assert delivery_health()["healthy"] is False

    for expected_attempt in range(2, MAX_EVENT_ATTEMPTS + 1):
        event.available_at = timezone.now() - timedelta(seconds=1)
        event.save(update_fields=["available_at", "updated_at"])
        assert process_one_outbox_event()
        event.refresh_from_db()
        assert event.attempts == expected_attempt

    assert event.status == OutboxEvent.Status.FAILED
    assert "Dead letter" in event.last_error
    health = delivery_health()
    assert health["failed_invitation_events"] == 1
    assert health["failed_events"] == 1
    assert health["healthy"] is False


@pytest.mark.django_db
def test_deleted_invitation_is_a_terminal_noop(profile):
    invitation, _raw_token, event = _invitation(profile)
    invitation.delete()

    assert process_one_outbox_event()

    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert "deleted" in event.last_error
    assert mail.outbox == []


@pytest.mark.django_db
@pytest.mark.parametrize(
    "status",
    [GuardianInvitation.Status.REVOKED, GuardianInvitation.Status.EXPIRED],
)
def test_revoked_or_expired_invitation_is_a_terminal_noop(profile, status):
    invitation, _raw_token, event = _invitation(profile)
    invitation.status = status
    invitation.save(update_fields=["status", "updated_at"])

    assert process_one_outbox_event()

    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert status in event.last_error
    assert mail.outbox == []


@pytest.mark.django_db
def test_elapsed_pending_invitation_is_expired_without_email(profile):
    invitation, _raw_token, event = _invitation(profile)
    invitation.expires_at = timezone.now() - timedelta(seconds=1)
    invitation.save(update_fields=["expires_at", "updated_at"])

    assert process_one_outbox_event()

    invitation.refresh_from_db()
    event.refresh_from_db()
    assert invitation.status == GuardianInvitation.Status.EXPIRED
    assert event.status == OutboxEvent.Status.PROCESSED
    assert mail.outbox == []


@pytest.mark.django_db
def test_successful_invitation_delivery_keeps_health_green(profile):
    _invitation_record, _raw_token, event = _invitation(profile)
    _fresh_delivery_heartbeats()

    assert process_one_outbox_event()

    event.refresh_from_db()
    health = delivery_health()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert health["retrying_invitation_events"] == 0
    assert health["failed_invitation_events"] == 0
    assert health["unsupported_pending_events"] == 0
    assert health["healthy"] is True
