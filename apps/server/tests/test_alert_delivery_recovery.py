import io
import json
import uuid
from datetime import timedelta

import httpx
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from django.utils import timezone

from core.alert_delivery_recovery import (
    MAX_RECOVERY_REASON_LENGTH,
    AlertDeliveryRecoveryError,
    recover_dead_letter_alert,
)
from core.models import (
    AlertIncident,
    AlertRecipient,
    AuditEvent,
    DeliveryAttempt,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    User,
)
from core.push import process_one_outbox_event

pytestmark = pytest.mark.django_db


def _staff_operator():
    return User.objects.create_user(
        email="operator@example.cz",
        password="Safely-testing-123",
        is_staff=True,
    )


def _dead_letter(profile, guardian, *, event_type="alert.opened"):
    GuardianMembership.objects.create(profile=profile, guardian=guardian)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=10),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=guardian,
        user_id_snapshot=guardian.id,
    )
    device = PushDevice.objects.create(
        user=guardian,
        installation_id=uuid.uuid4(),
        expo_push_token=f"ExponentPushToken[{uuid.uuid4()}]",
        platform=PushDevice.Platform.ANDROID,
    )
    source = OutboxEvent.objects.create(
        event_type=event_type,
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"source:{uuid.uuid4()}",
        payload={
            "incident_id": str(incident.id),
            "recipient_user_ids": [str(guardian.id)],
        },
        status=OutboxEvent.Status.FAILED,
        attempts=5,
        processed_at=timezone.now(),
        last_error="No push destination accepted the notification",
    )
    attempt = DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=source,
        device=device,
        device_id_snapshot=device.id,
        destination_token_hash="0" * 64,
        platform_snapshot=device.platform,
        attempt_number=5,
        status=DeliveryAttempt.Status.DEAD_LETTER,
        response_data={"error": "provider timeout"},
    )
    return incident, source, attempt, device


def _recover(*, incident, source, operator, reason="INC-1234 provider recovery approved"):
    return recover_dead_letter_alert(
        event_id=source.id,
        incident_id=incident.id,
        operator_id=operator.id,
        reason=reason,
    )


def test_recovery_command_creates_audited_immutable_retry(profile, other_user):
    operator = _staff_operator()
    incident, source, attempt, _ = _dead_letter(profile, other_user)
    source_before = {
        "status": source.status,
        "attempts": source.attempts,
        "processed_at": source.processed_at,
        "last_error": source.last_error,
        "updated_at": source.updated_at,
    }
    attempt_before = {
        "status": attempt.status,
        "attempt_number": attempt.attempt_number,
        "response_data": attempt.response_data,
        "updated_at": attempt.updated_at,
    }
    stdout = io.StringIO()

    call_command(
        "recover_alert_delivery",
        event_id=source.id,
        incident_id=incident.id,
        operator_id=operator.id,
        reason="INC-1234 provider recovery approved",
        stdout=stdout,
    )

    output = json.loads(stdout.getvalue())
    retry = OutboxEvent.objects.get(pk=output["retry_event_id"])
    assert output == {
        "active_recipient_count": 1,
        "created": True,
        "retry_event_id": str(retry.id),
        "source_event_id": str(source.id),
    }
    assert retry.event_type == "alert.retry"
    assert retry.status == OutboxEvent.Status.PENDING
    assert retry.deduplication_key == f"alert-retry:{source.id}"
    assert retry.aggregate_id == incident.id
    assert retry.payload == {
        "incident_id": str(incident.id),
        "source_event_id": str(source.id),
        "deadline_generation": incident.deadline_generation,
        "recipient_user_ids": [str(other_user.id)],
    }

    audit = AuditEvent.objects.get(event_type="alert.delivery_recovery_requested")
    assert audit.actor == operator
    assert audit.aggregate_id == incident.id
    assert audit.metadata == {
        "source_event_id": str(source.id),
        "retry_event_id": str(retry.id),
        "source_event_type": "alert.opened",
        "active_recipient_count": 1,
        "reason": "INC-1234 provider recovery approved",
    }

    source.refresh_from_db()
    attempt.refresh_from_db()
    assert {
        "status": source.status,
        "attempts": source.attempts,
        "processed_at": source.processed_at,
        "last_error": source.last_error,
        "updated_at": source.updated_at,
    } == source_before
    assert {
        "status": attempt.status,
        "attempt_number": attempt.attempt_number,
        "response_data": attempt.response_data,
        "updated_at": attempt.updated_at,
    } == attempt_before


def test_recovery_is_idempotent_per_failed_source_event(profile, other_user):
    operator = _staff_operator()
    incident, source, _, _ = _dead_letter(profile, other_user)

    first = _recover(incident=incident, source=source, operator=operator)
    second = _recover(incident=incident, source=source, operator=operator)

    assert first.created is True
    assert second.created is False
    assert second.retry_event.id == first.retry_event.id
    assert OutboxEvent.objects.filter(deduplication_key=f"alert-retry:{source.id}").count() == 1
    assert (
        AuditEvent.objects.filter(
            event_type="alert.delivery_recovery_requested",
            aggregate_id=incident.id,
        ).count()
        == 1
    )


def test_retry_uses_fresh_attempt_and_processor_rechecks_active_guardian(profile, other_user):
    operator = _staff_operator()
    incident, source, source_attempt, device = _dead_letter(profile, other_user)
    recovery = _recover(incident=incident, source=source, operator=operator)

    def accepted(request):
        message = json.loads(request.content)[0]
        assert message["data"]["event_id"] == str(recovery.retry_event.id)
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "fresh-ticket"}]})

    assert process_one_outbox_event(
        event_types={"alert.retry"},
        client=httpx.Client(transport=httpx.MockTransport(accepted)),
    )

    retry_attempt = DeliveryAttempt.objects.get(outbox_event=recovery.retry_event)
    assert retry_attempt.id != source_attempt.id
    assert retry_attempt.device_id_snapshot == device.id
    assert retry_attempt.attempt_number == 1
    assert retry_attempt.status == DeliveryAttempt.Status.TICKET_RECEIVED
    source_attempt.refresh_from_db()
    assert source_attempt.status == DeliveryAttempt.Status.DEAD_LETTER


def test_retry_is_not_sent_if_guardian_is_revoked_after_recovery(profile, other_user):
    operator = _staff_operator()
    incident, source, _, _ = _dead_letter(profile, other_user)
    recovery = _recover(incident=incident, source=source, operator=operator)
    GuardianMembership.objects.filter(profile=profile, guardian=other_user).update(
        status=GuardianMembership.Status.REVOKED
    )

    def must_not_send(_request):
        pytest.fail("A revoked guardian must not receive a manually recovered alert")

    assert process_one_outbox_event(
        event_types={"alert.retry"},
        client=httpx.Client(transport=httpx.MockTransport(must_not_send)),
    )

    recovery.retry_event.refresh_from_db()
    assert recovery.retry_event.status == OutboxEvent.Status.PROCESSED
    assert recovery.retry_event.last_error == "No recipient remains an active guardian"
    assert not DeliveryAttempt.objects.filter(outbox_event=recovery.retry_event).exists()


def test_recovery_refuses_mismatched_incident_identity(profile, other_user):
    operator = _staff_operator()
    incident, source, _, _ = _dead_letter(profile, other_user)
    source.aggregate_id = uuid.uuid4()
    source.save(update_fields=["aggregate_id"])

    with pytest.raises(AlertDeliveryRecoveryError, match="do not match"):
        recover_dead_letter_alert(
            event_id=source.id,
            incident_id=incident.id,
            operator_id=operator.id,
            reason="INC-1234 provider recovery approved",
        )

    assert not OutboxEvent.objects.filter(event_type="alert.retry").exists()
    assert incident.status == AlertIncident.Status.OPEN


def test_recovery_refuses_non_dead_letter_failure(profile, other_user):
    operator = _staff_operator()
    incident, source, attempt, _ = _dead_letter(profile, other_user)
    source.last_error = "Expo configuration failure: InvalidCredentials"
    source.save(update_fields=["last_error"])
    attempt.status = DeliveryAttempt.Status.PERMANENT_FAILURE
    attempt.save(update_fields=["status"])

    with pytest.raises(AlertDeliveryRecoveryError, match="not an explicit dead letter"):
        _recover(incident=incident, source=source, operator=operator)


def test_recovery_refuses_dead_letter_when_same_recipient_has_accepted_destination(
    profile, other_user
):
    operator = _staff_operator()
    incident, source, _, _ = _dead_letter(profile, other_user)
    accepted_device = PushDevice.objects.create(
        user=other_user,
        installation_id=uuid.uuid4(),
        expo_push_token=f"ExponentPushToken[{uuid.uuid4()}]",
        platform=PushDevice.Platform.IOS,
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=source,
        device=accepted_device,
        device_id_snapshot=accepted_device.id,
        destination_token_hash="1" * 64,
        platform_snapshot=PushDevice.Platform.IOS,
        attempt_number=1,
        status=DeliveryAttempt.Status.PROVIDER_ACCEPTED,
    )

    with pytest.raises(AlertDeliveryRecoveryError, match="unaccepted dead-letter"):
        _recover(incident=incident, source=source, operator=operator)


def test_recovery_targets_only_unaccepted_recipient_from_partial_delivery(profile, other_user):
    accepted_guardian = User.objects.create_user(
        email="accepted-guardian@example.cz", password="Safely-testing-123"
    )
    GuardianMembership.objects.create(profile=profile, guardian=accepted_guardian)
    operator = _staff_operator()
    incident, source, _, _ = _dead_letter(profile, other_user)
    AlertRecipient.objects.create(
        incident=incident,
        user=accepted_guardian,
        user_id_snapshot=accepted_guardian.id,
    )
    accepted_device = PushDevice.objects.create(
        user=accepted_guardian,
        installation_id=uuid.uuid4(),
        expo_push_token=f"ExponentPushToken[{uuid.uuid4()}]",
        platform=PushDevice.Platform.IOS,
    )
    DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=source,
        device=accepted_device,
        device_id_snapshot=accepted_device.id,
        destination_token_hash="1" * 64,
        platform_snapshot=accepted_device.platform,
        attempt_number=1,
        status=DeliveryAttempt.Status.PROVIDER_ACCEPTED,
    )
    source.payload["recipient_user_ids"].append(str(accepted_guardian.id))
    source.status = OutboxEvent.Status.PROCESSED
    source.last_error = "Partial delivery: 1 destination(s) failed permanently"
    source.save(update_fields=["payload", "status", "last_error", "updated_at"])

    recovery = _recover(incident=incident, source=source, operator=operator)

    assert recovery.retry_event.payload["recipient_user_ids"] == [str(other_user.id)]
    assert recovery.active_recipient_count == 1


def test_recovery_ignores_anonymized_attempt_from_deleted_recipient(profile, other_user):
    operator = _staff_operator()
    incident, source, _, _ = _dead_letter(profile, other_user)
    DeliveryAttempt.objects.create(
        incident=incident,
        outbox_event=source,
        device=None,
        device_id_snapshot=None,
        platform_snapshot=PushDevice.Platform.IOS,
        attempt_number=5,
        status=DeliveryAttempt.Status.DEAD_LETTER,
        account_erasure_tombstone=True,
    )

    recovery = _recover(incident=incident, source=source, operator=operator)

    assert recovery.created is True
    assert recovery.retry_event.payload["recipient_user_ids"] == [str(other_user.id)]


def test_recovery_refuses_non_staff_operator_and_revoked_guardian(profile, other_user):
    incident, source, _, _ = _dead_letter(profile, other_user)

    with pytest.raises(AlertDeliveryRecoveryError, match="active staff"):
        _recover(incident=incident, source=source, operator=other_user)

    operator = _staff_operator()
    GuardianMembership.objects.filter(profile=profile, guardian=other_user).update(
        status=GuardianMembership.Status.REVOKED
    )
    with pytest.raises(AlertDeliveryRecoveryError, match="active guardian"):
        _recover(incident=incident, source=source, operator=operator)


@pytest.mark.parametrize(
    "reason",
    ["too short", "x" * (MAX_RECOVERY_REASON_LENGTH + 1), "contact operator@example.cz"],
)
def test_recovery_refuses_unbounded_or_unsafe_reason(profile, other_user, reason):
    operator = _staff_operator()
    incident, source, _, _ = _dead_letter(profile, other_user)

    with pytest.raises(AlertDeliveryRecoveryError):
        _recover(incident=incident, source=source, operator=operator, reason=reason)


def test_command_refuses_non_failed_event(profile, other_user):
    operator = _staff_operator()
    incident, source, _, _ = _dead_letter(profile, other_user)
    source.status = OutboxEvent.Status.PENDING
    source.save(update_fields=["status"])

    with pytest.raises(CommandError, match="not terminal"):
        call_command(
            "recover_alert_delivery",
            event_id=source.id,
            incident_id=incident.id,
            operator_id=operator.id,
            reason="INC-1234 provider recovery approved",
        )
