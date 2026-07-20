import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import httpx
import pytest
from django.core.management import call_command
from django.db import close_old_connections, connection, connections
from django.utils import timezone

from core.health import delivery_health
from core.management.commands import fetch_push_receipts as receipt_command
from core.models import (
    AlertIncident,
    AlertRecipient,
    AuditEvent,
    CheckIn,
    DeliveryAttempt,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    WorkerHeartbeat,
)
from core.push import (
    EMAIL_EVENT_TYPES,
    MAX_DELIVERY_ATTEMPTS,
    MAX_EVENT_ATTEMPTS,
    STALE_PROCESSING_AFTER,
    build_alert_message,
    claim_outbox_event,
    fetch_push_receipts,
    process_one_outbox_event,
)

pytestmark = pytest.mark.django_db


def _create_incident_event(profile, recipient, *, event_type="alert.opened", incident=None):
    GuardianMembership.objects.get_or_create(profile=profile, guardian=recipient)
    incident = incident or AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.get_or_create(
        incident=incident,
        user=recipient,
        user_id_snapshot=recipient.id,
    )
    event = OutboxEvent.objects.create(
        event_type=event_type,
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"{event_type}:{incident.id}:{uuid.uuid4()}",
        payload={
            "incident_id": str(incident.id),
            "recipient_user_ids": [str(recipient.id)],
        },
    )
    return incident, event


def _device(user, suffix="one"):
    return PushDevice.objects.create(
        user=user,
        installation_id=uuid.uuid4(),
        expo_push_token=f"ExponentPushToken[{suffix}]",
        platform=PushDevice.Platform.ANDROID,
    )


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def _tickets(*tickets):
    def handler(request):
        assert request.url.path.endswith("/push/send")
        return httpx.Response(200, json={"data": list(tickets)})

    return _client(handler)


def test_alert_push_payload_never_contains_location(profile, other_user):
    device = _device(other_user)
    CheckIn.objects.create(
        profile=profile,
        idempotency_key="with-sensitive-location",
        accepted_at=timezone.now() - timedelta(days=2),
        latitude="50.075500",
        longitude="14.437800",
        deadline_generation=profile.deadline_generation,
    )
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )

    encoded = json.dumps(build_alert_message(incident=incident, device=device)).lower()

    assert "latitude" not in encoded
    assert "longitude" not in encoded
    assert "50.075500" not in encoded
    assert "14.437800" not in encoded
    assert other_user.email not in encoded


def test_alert_push_payload_has_versioned_incident_route(profile, other_user):
    device = _device(other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )

    payload = build_alert_message(incident=incident, device=device)["data"]

    assert payload == {
        "schema_version": 1,
        "type": "alert_incident",
        "incident_id": str(incident.id),
        "profile_id": str(profile.id),
        "deadline_generation": incident.deadline_generation,
        "route": f"/incident/{incident.id}",
    }
    assert "alert_id" not in payload


def test_android_alert_push_uses_alerts_notification_channel(profile, other_user):
    device = _device(other_user)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )

    message = build_alert_message(incident=incident, device=device)

    assert message["channelId"] == "alerts"


def test_alert_delivers_to_recipient_with_active_guardian_membership(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    device = _device(other_user)

    assert process_one_outbox_event(client=_tickets({"status": "ok", "id": "ticket-snapshot"}))

    attempt = DeliveryAttempt.objects.get(outbox_event=event)
    assert attempt.device_id_snapshot == device.id
    assert attempt.destination_token_hash
    assert attempt.status == DeliveryAttempt.Status.TICKET_RECEIVED


def test_pending_alert_is_not_sent_after_guardian_membership_is_revoked(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    _device(other_user)
    GuardianMembership.objects.filter(profile=profile, guardian=other_user).update(
        status=GuardianMembership.Status.REVOKED
    )

    def must_not_send(_request):
        pytest.fail("A removed guardian must not receive a pending incident")

    assert process_one_outbox_event(client=_client(must_not_send))

    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert event.last_error == "No recipient remains an active guardian"
    assert not DeliveryAttempt.objects.filter(outbox_event=event).exists()


def test_alert_retry_is_not_sent_after_guardian_membership_is_revoked(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    _device(other_user)
    assert process_one_outbox_event(
        client=_tickets({"status": "error", "details": {"error": "MessageRateExceeded"}})
    )
    first_attempt = DeliveryAttempt.objects.get(outbox_event=event)
    first_attempt.next_retry_at = timezone.now() - timedelta(seconds=1)
    first_attempt.save(update_fields=["next_retry_at"])
    event.available_at = timezone.now() - timedelta(seconds=1)
    event.save(update_fields=["available_at"])
    GuardianMembership.objects.filter(profile=profile, guardian=other_user).update(
        status=GuardianMembership.Status.REVOKED
    )

    def must_not_retry(_request):
        pytest.fail("A removed guardian must not receive an incident retry")

    assert process_one_outbox_event(client=_client(must_not_retry))

    event.refresh_from_db()
    first_attempt.refresh_from_db()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert event.last_error == "No recipient remains an active guardian"
    assert first_attempt.status == DeliveryAttempt.Status.PERMANENT_FAILURE
    assert first_attempt.response_data == {
        "error": "Recipient no longer has an active guardian membership"
    }
    assert DeliveryAttempt.objects.filter(outbox_event=event).count() == 1


def test_send_timeout_is_retryable_and_claim_is_not_duplicated(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    _device(other_user)

    def timeout(request):
        raise httpx.ReadTimeout("send timed out", request=request)

    assert process_one_outbox_event(client=_client(timeout))
    event.refresh_from_db()
    attempt = DeliveryAttempt.objects.get(outbox_event=event)
    assert event.status == OutboxEvent.Status.PENDING
    assert attempt.status == DeliveryAttempt.Status.RETRYABLE_FAILURE
    assert attempt.next_retry_at > timezone.now()

    event.available_at = timezone.now()
    event.save(update_fields=["available_at"])
    assert claim_outbox_event() is not None
    assert claim_outbox_event() is None


def test_http_retry_after_is_respected(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    _device(other_user)

    def throttled(request):
        return httpx.Response(429, headers={"Retry-After": "120"}, request=request)

    before = timezone.now()
    assert process_one_outbox_event(client=_client(throttled))
    attempt = DeliveryAttempt.objects.get(outbox_event=event)
    assert attempt.next_retry_at >= before + timedelta(seconds=119)


def test_partial_multi_device_failure_keeps_success_and_deactivates_bad_device(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    first = _device(other_user, "first")
    second = _device(other_user, "second")

    client = _tickets(
        {"status": "ok", "id": "ticket-good"},
        {"status": "error", "details": {"error": "DeviceNotRegistered"}},
    )
    assert process_one_outbox_event(client=client)

    event.refresh_from_db()
    first.refresh_from_db()
    second.refresh_from_db()
    attempts = list(DeliveryAttempt.objects.filter(outbox_event=event).order_by("created_at"))
    assert event.status == OutboxEvent.Status.PROCESSED
    assert "Partial delivery" in event.last_error
    assert attempts[0].status == DeliveryAttempt.Status.TICKET_RECEIVED
    assert attempts[1].status == DeliveryAttempt.Status.PERMANENT_FAILURE
    assert first.active is False
    assert second.active is True
    deactivation = AuditEvent.objects.get(event_type="device.deactivated", aggregate_id=first.id)
    assert deactivation.actor is None
    assert deactivation.actor_kind == AuditEvent.ActorKind.SYSTEM


def test_legacy_over_cap_account_is_limited_to_five_push_destinations(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    for number in range(6):
        _device(other_user, suffix=f"legacy-over-cap-{number}")

    tickets = [{"status": "ok", "id": f"ticket-capped-{number}"} for number in range(5)]

    assert process_one_outbox_event(client=_tickets(*tickets))
    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PROCESSED
    assert DeliveryAttempt.objects.filter(outbox_event=event).count() == 5


def test_retry_is_deduplicated_by_event_and_device(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    device = _device(other_user)
    transient = _tickets({"status": "error", "details": {"error": "MessageRateExceeded"}})
    assert process_one_outbox_event(client=transient)

    first = DeliveryAttempt.objects.get(outbox_event=event, attempt_number=1)
    first.next_retry_at = timezone.now() - timedelta(seconds=1)
    first.save(update_fields=["next_retry_at"])
    event.available_at = timezone.now() - timedelta(seconds=1)
    event.save(update_fields=["available_at"])

    assert process_one_outbox_event(client=_tickets({"status": "ok", "id": "ticket-retry"}))
    attempts = list(DeliveryAttempt.objects.filter(outbox_event=event).order_by("attempt_number"))
    assert [attempt.attempt_number for attempt in attempts] == [1, 2]
    assert {attempt.device_id_snapshot for attempt in attempts} == {device.id}

    assert process_one_outbox_event(client=_tickets()) is False
    assert DeliveryAttempt.objects.filter(outbox_event=event).count() == 2


def test_resolved_event_is_a_separate_delivery_for_same_incident_and_device(profile, other_user):
    incident, opened = _create_incident_event(profile, other_user)
    _, resolved = _create_incident_event(
        profile, other_user, event_type="alert.resolved", incident=incident
    )
    _device(other_user)
    messages = []

    def capture(request):
        messages.extend(json.loads(request.content))
        return httpx.Response(200, json={"data": [{"status": "ok", "id": str(uuid.uuid4())}]})

    client = _client(capture)
    assert process_one_outbox_event(client=client)
    assert process_one_outbox_event(client=client)

    assert DeliveryAttempt.objects.filter(outbox_event=opened, attempt_number=1).exists()
    assert DeliveryAttempt.objects.filter(outbox_event=resolved, attempt_number=1).exists()
    assert [message["data"]["type"] for message in messages] == [
        "alert_incident",
        "alert_resolved",
    ]


def test_resolved_event_waits_while_opened_alert_is_retrying(profile, other_user):
    incident, opened = _create_incident_event(profile, other_user)
    _, resolved = _create_incident_event(
        profile, other_user, event_type="alert.resolved", incident=incident
    )
    _device(other_user)

    assert process_one_outbox_event(
        client=_tickets({"status": "error", "details": {"error": "MessageRateExceeded"}})
    )
    assert process_one_outbox_event(client=_tickets())
    opened.refresh_from_db()
    resolved.refresh_from_db()
    assert opened.status == OutboxEvent.Status.PENDING
    assert resolved.status == OutboxEvent.Status.PENDING
    assert "Waiting for" in resolved.last_error
    assert not DeliveryAttempt.objects.filter(outbox_event=resolved).exists()


def test_no_device_is_observable_and_event_eventually_dead_letters(profile, other_user):
    _, event = _create_incident_event(profile, other_user)

    assert process_one_outbox_event()
    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.PENDING
    assert "no active push devices" in event.last_error
    assert delivery_health()["retrying_alert_events"] == 1

    event.attempts = MAX_EVENT_ATTEMPTS - 1
    event.available_at = timezone.now() - timedelta(seconds=1)
    event.save(update_fields=["attempts", "available_at"])
    assert process_one_outbox_event()
    event.refresh_from_db()
    assert event.status == OutboxEvent.Status.FAILED
    assert "Dead letter" in event.last_error


def test_delivery_attempts_stop_at_maximum(profile, other_user):
    incident, event = _create_incident_event(profile, other_user)
    device = _device(other_user)
    for attempt_number in range(1, MAX_DELIVERY_ATTEMPTS):
        DeliveryAttempt.objects.create(
            incident=incident,
            outbox_event=event,
            device=device,
            device_id_snapshot=device.id,
            destination_token_hash="hash",
            platform_snapshot=device.platform,
            attempt_number=attempt_number,
            status=DeliveryAttempt.Status.RETRYABLE_FAILURE,
            next_retry_at=timezone.now() - timedelta(seconds=1),
        )

    def timeout(request):
        raise httpx.ReadTimeout("still unavailable", request=request)

    assert process_one_outbox_event(client=_client(timeout))
    event.refresh_from_db()
    final = DeliveryAttempt.objects.get(outbox_event=event, attempt_number=MAX_DELIVERY_ATTEMPTS)
    assert final.status == DeliveryAttempt.Status.DEAD_LETTER
    assert event.status == OutboxEvent.Status.FAILED


def test_successful_receipt_records_provider_acceptance_not_device_delivery(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    _device(other_user)
    assert process_one_outbox_event(client=_tickets({"status": "ok", "id": "ticket-delivered"}))

    def receipt(request):
        assert json.loads(request.content) == {"ids": ["ticket-delivered"]}
        return httpx.Response(
            200,
            json={"data": {"ticket-delivered": {"status": "ok"}}},
        )

    assert fetch_push_receipts(client=_client(receipt)) == 1
    assert (
        DeliveryAttempt.objects.get(outbox_event=event).status
        == DeliveryAttempt.Status.PROVIDER_ACCEPTED
    )


def test_transient_receipt_reopens_original_event_for_same_device(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    _device(other_user)
    assert process_one_outbox_event(client=_tickets({"status": "ok", "id": "ticket-transient"}))

    client = _client(
        lambda request: httpx.Response(
            200,
            json={
                "data": {
                    "ticket-transient": {
                        "status": "error",
                        "details": {"error": "MessageRateExceeded"},
                    }
                }
            },
        )
    )
    assert fetch_push_receipts(client=client) == 1
    event.refresh_from_db()
    attempt = DeliveryAttempt.objects.get(outbox_event=event)
    assert event.status == OutboxEvent.Status.PENDING
    assert attempt.status == DeliveryAttempt.Status.RETRYABLE_FAILURE
    assert not OutboxEvent.objects.filter(event_type="alert.retry").exists()


def test_receipt_timeout_restores_claim_for_next_poll(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    _device(other_user)
    assert process_one_outbox_event(client=_tickets({"status": "ok", "id": "ticket-timeout"}))

    def timeout(request):
        raise httpx.ReadTimeout("receipt timed out", request=request)

    with pytest.raises(httpx.ReadTimeout):
        fetch_push_receipts(client=_client(timeout))
    assert (
        DeliveryAttempt.objects.get(outbox_event=event).status
        == DeliveryAttempt.Status.TICKET_RECEIVED
    )


def test_receipt_watch_survives_timeout_with_observable_backoff(monkeypatch):
    calls = 0
    observed_during_sleep = []

    def fetch(*, limit):
        nonlocal calls
        calls += 1
        if calls == 1:
            request = httpx.Request("POST", "https://exp.host/receipts")
            raise httpx.ReadTimeout("temporary receipt outage", request=request)
        return 0

    def observe_sleep(seconds):
        heartbeat = WorkerHeartbeat.objects.get(worker_name="push_receipts")
        observed_during_sleep.append((seconds, heartbeat.details.copy()))

    monkeypatch.setattr(receipt_command, "fetch_push_receipts", fetch)
    monkeypatch.setattr(
        "core.worker_runtime.GracefulStop.wait",
        lambda _self, seconds: observe_sleep(seconds),
    )

    call_command(
        "fetch_push_receipts",
        "--watch",
        "--max-cycles",
        "2",
        "--error-backoff",
        "7",
    )

    assert calls == 2
    assert observed_during_sleep == [
        (
            7.0,
            {
                "healthy": False,
                "consecutive_errors": 1,
                "last_error": "temporary receipt outage",
            },
        )
    ]
    assert WorkerHeartbeat.objects.get(worker_name="push_receipts").details["healthy"] is True


def test_invalid_credentials_fails_whole_event_without_disabling_device(profile, other_user):
    _, event = _create_incident_event(profile, other_user)
    device = _device(other_user)
    assert process_one_outbox_event(
        client=_tickets({"status": "error", "details": {"error": "InvalidCredentials"}})
    )
    event.refresh_from_db()
    device.refresh_from_db()
    assert event.status == OutboxEvent.Status.FAILED
    assert "InvalidCredentials" in event.last_error
    assert device.active is True


def test_global_invalid_credentials_receipt_response_dead_letters_claimed_tickets(
    profile, other_user
):
    _, event = _create_incident_event(profile, other_user)
    _device(other_user)
    assert process_one_outbox_event(
        client=_tickets({"status": "ok", "id": "ticket-global-credentials"})
    )

    client = _client(
        lambda request: httpx.Response(
            200,
            json={"errors": [{"code": "InvalidCredentials"}], "data": {}},
        )
    )
    assert fetch_push_receipts(client=client) == 1
    event.refresh_from_db()
    attempt = DeliveryAttempt.objects.get(outbox_event=event)
    assert event.status == OutboxEvent.Status.FAILED
    assert attempt.status == DeliveryAttempt.Status.PERMANENT_FAILURE


def test_stale_processing_event_is_reclaimed_and_exhausted_stale_event_is_failed(
    profile, other_user
):
    _, recoverable = _create_incident_event(profile, other_user)
    _device(other_user)
    stale_at = timezone.now() - STALE_PROCESSING_AFTER - timedelta(seconds=1)
    recoverable.status = OutboxEvent.Status.PROCESSING
    recoverable.locked_at = stale_at
    recoverable.attempts = 1
    recoverable.save(update_fields=["status", "locked_at", "attempts"])

    assert process_one_outbox_event(client=_tickets({"status": "ok", "id": "ticket-recovered"}))
    recoverable.refresh_from_db()
    assert recoverable.attempts == 2
    assert recoverable.status == OutboxEvent.Status.PROCESSED

    exhausted = OutboxEvent.objects.create(
        event_type="guardian.invited",
        aggregate_type="guardian_invitation",
        aggregate_id=uuid.uuid4(),
        deduplication_key=f"exhausted:{uuid.uuid4()}",
        status=OutboxEvent.Status.PROCESSING,
        locked_at=stale_at,
        attempts=MAX_EVENT_ATTEMPTS,
    )
    assert process_one_outbox_event()
    exhausted.refresh_from_db()
    assert exhausted.status == OutboxEvent.Status.FAILED


def test_alert_queue_isolated_from_email_and_alerts_have_priority(profile, other_user):
    invitation = OutboxEvent.objects.create(
        event_type="guardian.invited",
        aggregate_type="guardian_invitation",
        aggregate_id=uuid.uuid4(),
        deduplication_key=f"invite:{uuid.uuid4()}",
    )

    _, alert = _create_incident_event(
        profile=profile,
        recipient=other_user,
    )

    assert claim_outbox_event().id == alert.id
    invitation.refresh_from_db()
    assert invitation.status == OutboxEvent.Status.PENDING
    assert process_one_outbox_event(event_types=EMAIL_EVENT_TYPES, worker_name="outbox_email")
    invitation.refresh_from_db()
    assert invitation.status == OutboxEvent.Status.PROCESSED
    assert "deleted" in invitation.last_error
    assert delivery_health()["unsupported_pending_events"] == 0


def test_delivery_health_requires_fresh_workers_and_no_delivery_failures():
    for worker_name in {
        "deadline_sweeper",
        "outbox_alerts",
        "outbox_email",
        "push_receipts",
        "safety_reconciliation",
    }:
        WorkerHeartbeat.objects.create(worker_name=worker_name)
    assert delivery_health()["healthy"] is True

    heartbeat = WorkerHeartbeat.objects.get(worker_name="outbox_alerts")
    heartbeat.last_seen_at = timezone.now() - timedelta(minutes=6)
    heartbeat.save(update_fields=["last_seen_at"])
    health = delivery_health()
    assert health["healthy"] is False
    assert health["stale_workers"] == ["outbox_alerts"]

    heartbeat.last_seen_at = timezone.now()
    heartbeat.details = {"healthy": False, "last_error": "provider unavailable"}
    heartbeat.save(update_fields=["last_seen_at", "details"])
    assert delivery_health()["failing_workers"] == ["outbox_alerts"]


@pytest.mark.django_db(transaction=True)
def test_postgresql_concurrent_workers_claim_event_once():
    if connection.vendor != "postgresql":
        pytest.skip("Concurrent skip-locked claim requires PostgreSQL")
    event = OutboxEvent.objects.create(
        event_type="guardian.invited",
        aggregate_type="guardian_invitation",
        aggregate_id=uuid.uuid4(),
        deduplication_key=f"concurrent-claim:{uuid.uuid4()}",
    )
    barrier = Barrier(2)

    def claim(_number):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            claimed = claim_outbox_event()
            return str(claimed.id) if claimed else None
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(claim, (0, 1)))

    assert results.count(str(event.id)) == 1
    assert results.count(None) == 1
