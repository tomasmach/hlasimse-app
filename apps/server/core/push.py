import hashlib
import random
import uuid
from datetime import UTC, datetime, timedelta
from email.utils import parsedate_to_datetime

import httpx
from django.conf import settings
from django.db import connection, transaction
from django.db.models import Case, IntegerField, Q, Value, When
from django.utils import timezone

from .email_delivery import (
    InvitationEmailDeliveryError,
    VerificationEmailDeliveryError,
    send_guardian_invitation_email,
    send_verification_email,
)
from .models import (
    AlertIncident,
    DeliveryAttempt,
    EmailVerificationChallenge,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    WorkerHeartbeat,
)
from .services import deactivate_push_device

ALERT_EVENT_TYPES = {"alert.opened", "alert.resolved", "alert.retry"}
EMAIL_EVENT_TYPES = {"guardian.invited", "user.email_verification"}
PROCESSABLE_EVENT_TYPES = ALERT_EVENT_TYPES | EMAIL_EVENT_TYPES
PERMANENT_DEVICE_ERRORS = {"DeviceNotRegistered", "MessageTooBig"}
GLOBAL_CONFIGURATION_ERRORS = {"InvalidCredentials"}
MAX_DELIVERY_ATTEMPTS = 5
MAX_EVENT_ATTEMPTS = 8
MAX_ACTIVE_DEVICES_PER_RECIPIENT = 5
STALE_PROCESSING_AFTER = timedelta(seconds=90)
RECEIPT_MAX_AGE = timedelta(hours=24)
MAX_BACKOFF = timedelta(hours=4)


def record_worker_heartbeat(worker_name: str, **details) -> None:
    WorkerHeartbeat.objects.update_or_create(
        worker_name=worker_name,
        defaults={"last_seen_at": timezone.now(), "details": details},
    )


def _headers() -> dict[str, str]:
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    return headers


def build_alert_message(
    *, incident: AlertIncident, device: PushDevice, event_type: str = "alert.opened"
) -> dict:
    # Location is intentionally absent: lock-screen push payloads are not a private channel.
    if event_type == "alert.resolved":
        title = "Přihlášení obnoveno"
        body = f"{incident.profile.name} se znovu přihlásil/a."
        data_type = "alert_resolved"
    else:
        title = "Zmeškané přihlášení"
        body = f"{incident.profile.name} se nepřihlásil/a včas."
        data_type = "alert_incident"
    message = {
        "to": device.expo_push_token,
        "title": title,
        "body": body,
        "sound": "default",
        "priority": "high",
        "data": {
            "schema_version": 1,
            "type": data_type,
            "incident_id": str(incident.id),
            "profile_id": str(incident.profile_id),
            "deadline_generation": incident.deadline_generation,
            "route": f"/incident/{incident.id}",
        },
    }
    if device.platform == PushDevice.Platform.ANDROID:
        message["channelId"] = "alerts"
    return message


def _retry_after_seconds(response: httpx.Response | None) -> float | None:
    if response is None:
        return None
    raw_value = response.headers.get("Retry-After")
    if not raw_value:
        return None
    try:
        return max(float(raw_value), 0.0)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(raw_value)
        except TypeError, ValueError, OverflowError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=UTC)
        return max((parsed - datetime.now(UTC)).total_seconds(), 0.0)


def _backoff(attempt_number: int, *, retry_after_seconds: float | None = None) -> timedelta:
    exponent = max(attempt_number - 1, 0)
    base_seconds = min(30 * (2 ** min(exponent, 9)), int(MAX_BACKOFF.total_seconds()))
    jittered_seconds = base_seconds * random.uniform(0.8, 1.2)
    if retry_after_seconds is not None:
        jittered_seconds = max(jittered_seconds, retry_after_seconds)
    return min(timedelta(seconds=jittered_seconds), MAX_BACKOFF)


def _mark_event_processed(event: OutboxEvent, *, note: str = "") -> None:
    event.status = OutboxEvent.Status.PROCESSED
    event.processed_at = timezone.now()
    event.locked_at = None
    event.last_error = note[:2000]
    event.save(update_fields=["status", "processed_at", "locked_at", "last_error", "updated_at"])


def _mark_event_failed(event: OutboxEvent, error: str) -> None:
    event.status = OutboxEvent.Status.FAILED
    event.processed_at = timezone.now()
    event.locked_at = None
    event.last_error = error[:2000]
    event.save(update_fields=["status", "processed_at", "locked_at", "last_error", "updated_at"])


def _schedule_event_retry(
    event: OutboxEvent,
    error: str,
    *,
    retry_after_seconds: float | None = None,
    available_at=None,
) -> bool:
    if event.attempts >= MAX_EVENT_ATTEMPTS:
        _mark_event_failed(event, f"Dead letter after {event.attempts} claims: {error}")
        return False
    event.status = OutboxEvent.Status.PENDING
    event.available_at = available_at or (
        timezone.now() + _backoff(event.attempts, retry_after_seconds=retry_after_seconds)
    )
    event.last_error = error[:2000]
    event.locked_at = None
    event.processed_at = None
    event.save(
        update_fields=[
            "status",
            "available_at",
            "last_error",
            "locked_at",
            "processed_at",
            "updated_at",
        ]
    )
    return True


def recover_stale_outbox_events(*, event_types: set[str] | None = None) -> int:
    stale_before = timezone.now() - STALE_PROCESSING_AFTER
    queryset = OutboxEvent.objects.filter(
        status=OutboxEvent.Status.PROCESSING,
        locked_at__lt=stale_before,
        attempts__gte=MAX_EVENT_ATTEMPTS,
    )
    if event_types is not None:
        queryset = queryset.filter(event_type__in=event_types)
    return queryset.update(
        status=OutboxEvent.Status.FAILED,
        locked_at=None,
        processed_at=timezone.now(),
        last_error="Dead letter: stale processing lock exceeded maximum claims",
        updated_at=timezone.now(),
    )


def claim_outbox_event(*, event_types: set[str] | None = None) -> OutboxEvent | None:
    selected_event_types = event_types or PROCESSABLE_EVENT_TYPES
    stale_before = timezone.now() - STALE_PROCESSING_AFTER
    with transaction.atomic():
        queryset = OutboxEvent.objects.select_for_update(
            skip_locked=connection.vendor == "postgresql"
        )
        event = (
            queryset.filter(
                event_type__in=selected_event_types,
                attempts__lt=MAX_EVENT_ATTEMPTS,
            )
            .filter(
                Q(status=OutboxEvent.Status.PENDING, available_at__lte=timezone.now())
                | Q(status=OutboxEvent.Status.PROCESSING, locked_at__lt=stale_before)
            )
            .annotate(
                queue_priority=Case(
                    When(event_type__in=ALERT_EVENT_TYPES, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                )
            )
            .order_by("queue_priority", "available_at", "created_at")
            .first()
        )
        if event is None:
            return None
        event.status = OutboxEvent.Status.PROCESSING
        event.locked_at = timezone.now()
        event.attempts += 1
        event.save(update_fields=["status", "locked_at", "attempts", "updated_at"])
        return event


def _recipient_ids(event: OutboxEvent, incident: AlertIncident) -> list[uuid.UUID]:
    payload_ids = event.payload.get("recipient_user_ids")
    if payload_ids is not None:
        recipient_ids = []
        for raw_id in payload_ids:
            try:
                recipient_ids.append(uuid.UUID(str(raw_id)))
            except TypeError, ValueError, AttributeError:
                continue
        return list(dict.fromkeys(recipient_ids))
    # Compatibility for events created before recipient IDs were copied into the payload.
    return list(
        incident.recipients.order_by("created_at").values_list("user_id_snapshot", flat=True)
    )


def _active_guardian_recipient_ids(
    event: OutboxEvent, incident: AlertIncident
) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    snapshot_ids = _recipient_ids(event, incident)
    active_ids = set(
        GuardianMembership.objects.filter(
            profile_id=incident.profile_id,
            guardian_id__in=snapshot_ids,
            status=GuardianMembership.Status.ACTIVE,
        ).values_list("guardian_id", flat=True)
    )
    active_snapshot_ids = [
        recipient_id for recipient_id in snapshot_ids if recipient_id in active_ids
    ]
    return snapshot_ids, active_snapshot_ids


def _invalidate_ineligible_attempts(
    *, event: OutboxEvent, active_recipient_ids: list[uuid.UUID]
) -> int:
    attempts = DeliveryAttempt.objects.filter(
        outbox_event=event,
        status__in=[
            DeliveryAttempt.Status.QUEUED,
            DeliveryAttempt.Status.RETRYABLE_FAILURE,
        ],
    )
    if active_recipient_ids:
        attempts = attempts.exclude(device__user_id__in=active_recipient_ids)
    return attempts.update(
        status=DeliveryAttempt.Status.PERMANENT_FAILURE,
        response_data={"error": "Recipient no longer has an active guardian membership"},
        next_retry_at=None,
        updated_at=timezone.now(),
    )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _mark_attempt_retryable(
    attempt: DeliveryAttempt,
    response_data: dict,
    *,
    retry_after_seconds: float | None = None,
) -> bool:
    attempt.response_data = response_data
    if attempt.attempt_number >= MAX_DELIVERY_ATTEMPTS:
        attempt.status = DeliveryAttempt.Status.DEAD_LETTER
        attempt.next_retry_at = None
        retryable = False
    else:
        attempt.status = DeliveryAttempt.Status.RETRYABLE_FAILURE
        attempt.next_retry_at = timezone.now() + _backoff(
            attempt.attempt_number, retry_after_seconds=retry_after_seconds
        )
        retryable = True
    attempt.save(update_fields=["status", "response_data", "next_retry_at", "updated_at"])
    return retryable


def _prepare_delivery_attempts(
    *, event: OutboxEvent, incident: AlertIncident, recipient_ids: list[uuid.UUID]
) -> tuple[list[tuple[DeliveryAttempt, PushDevice, dict]], int]:
    devices: list[PushDevice] = []
    for recipient_id in recipient_ids:
        devices.extend(
            PushDevice.objects.filter(user_id=recipient_id, active=True).order_by(
                "-last_seen_at", "-created_at"
            )[:MAX_ACTIVE_DEVICES_PER_RECIPIENT]
        )
    queued: list[tuple[DeliveryAttempt, PushDevice, dict]] = []
    now = timezone.now()
    with transaction.atomic():
        for device in devices:
            latest = (
                DeliveryAttempt.objects.filter(
                    outbox_event=event,
                    device_id_snapshot=device.id,
                )
                .order_by("-attempt_number")
                .first()
            )
            if latest and latest.status in {
                DeliveryAttempt.Status.LEGACY_DELIVERED,
                DeliveryAttempt.Status.PROVIDER_ACCEPTED,
                DeliveryAttempt.Status.TICKET_RECEIVED,
                DeliveryAttempt.Status.RECEIPT_PROCESSING,
                DeliveryAttempt.Status.PERMANENT_FAILURE,
                DeliveryAttempt.Status.DEAD_LETTER,
            }:
                continue
            if latest and latest.status == DeliveryAttempt.Status.QUEUED:
                _mark_attempt_retryable(
                    latest,
                    {"error": "Worker was interrupted before ticket state was recorded"},
                )
                latest.refresh_from_db()
            if latest and latest.next_retry_at and latest.next_retry_at > now:
                continue
            attempt_number = latest.attempt_number + 1 if latest else 1
            if attempt_number > MAX_DELIVERY_ATTEMPTS:
                continue
            attempt = DeliveryAttempt.objects.create(
                incident=incident,
                outbox_event=event,
                device=device,
                device_id_snapshot=device.id,
                destination_token_hash=_token_hash(device.expo_push_token),
                platform_snapshot=device.platform,
                attempt_number=attempt_number,
            )
            message = build_alert_message(
                incident=incident,
                device=device,
                event_type=event.event_type,
            )
            message["data"]["event_id"] = str(event.id)
            queued.append((attempt, device, message))
    return queued, len(devices)


def _latest_attempts(event: OutboxEvent) -> list[DeliveryAttempt]:
    latest_by_device: dict[uuid.UUID, DeliveryAttempt] = {}
    attempts = DeliveryAttempt.objects.filter(outbox_event=event).order_by(
        "device_id_snapshot", "attempt_number"
    )
    for attempt in attempts:
        if attempt.device_id_snapshot is not None:
            latest_by_device[attempt.device_id_snapshot] = attempt
    return list(latest_by_device.values())


def _finish_event_from_attempts(event: OutboxEvent) -> None:
    if event.status == OutboxEvent.Status.FAILED and event.last_error.startswith(
        "Expo configuration failure"
    ):
        return
    attempts = _latest_attempts(event)
    retryable = [
        attempt
        for attempt in attempts
        if attempt.status
        in {DeliveryAttempt.Status.RETRYABLE_FAILURE, DeliveryAttempt.Status.QUEUED}
    ]
    if retryable:
        retry_dates = [attempt.next_retry_at for attempt in retryable if attempt.next_retry_at]
        _schedule_event_retry(
            event,
            "One or more push deliveries remain retryable",
            available_at=min(retry_dates) if retry_dates else None,
        )
        return
    successful = [
        attempt
        for attempt in attempts
        if attempt.status
        in {
            DeliveryAttempt.Status.LEGACY_DELIVERED,
            DeliveryAttempt.Status.TICKET_RECEIVED,
            DeliveryAttempt.Status.RECEIPT_PROCESSING,
            DeliveryAttempt.Status.PROVIDER_ACCEPTED,
        }
    ]
    terminal_failures = [
        attempt
        for attempt in attempts
        if attempt.status
        in {DeliveryAttempt.Status.PERMANENT_FAILURE, DeliveryAttempt.Status.DEAD_LETTER}
    ]
    if successful:
        note = ""
        if terminal_failures:
            note = f"Partial delivery: {len(terminal_failures)} destination(s) failed permanently"
        _mark_event_processed(event, note=note)
    elif terminal_failures:
        _mark_event_failed(event, "No push destination accepted the notification")
    else:
        _mark_event_failed(event, "No delivery outcome was recorded")


def _global_expo_error(payload: dict) -> str | None:
    for error in payload.get("errors") or []:
        code = error.get("code") or (error.get("details") or {}).get("error")
        if code in GLOBAL_CONFIGURATION_ERRORS:
            return code
    return None


def process_one_outbox_event(
    *,
    client: httpx.Client | None = None,
    event_types: set[str] | None = None,
    worker_name: str = "outbox",
) -> bool:
    recovered = recover_stale_outbox_events(event_types=event_types)
    event = claim_outbox_event(event_types=event_types)
    if event is None:
        return recovered > 0
    record_worker_heartbeat(worker_name, event_id=str(event.id), event_type=event.event_type)

    if event.event_type == "guardian.invited":
        invitation = GuardianInvitation.objects.filter(pk=event.aggregate_id).first()
        if invitation is None:
            _mark_event_processed(event, note="Invitation was deleted before email delivery")
            return True
        if (
            invitation.status == GuardianInvitation.Status.PENDING
            and invitation.expires_at <= timezone.now()
        ):
            GuardianInvitation.objects.filter(
                pk=invitation.pk,
                status=GuardianInvitation.Status.PENDING,
            ).update(status=GuardianInvitation.Status.EXPIRED, updated_at=timezone.now())
            _mark_event_processed(event, note="Invitation expired before email delivery")
            return True
        if invitation.status != GuardianInvitation.Status.PENDING:
            _mark_event_processed(
                event,
                note=f"Invitation became terminal before email delivery: {invitation.status}",
            )
            return True
        try:
            send_guardian_invitation_email(invitation=invitation, event=event)
        except InvitationEmailDeliveryError as exc:
            _schedule_event_retry(event, str(exc))
        else:
            _mark_event_processed(event, note="Guardian invitation email accepted by SMTP")
        return True

    if event.event_type == "user.email_verification":
        challenge = (
            EmailVerificationChallenge.objects.select_related("user")
            .filter(pk=event.aggregate_id)
            .first()
        )
        if challenge is None:
            _mark_event_processed(event, note="Verification was deleted before email delivery")
            return True
        now = timezone.now()
        if challenge.user.email_verified_at is not None or challenge.used_at is not None:
            _mark_event_processed(event, note="Email was already verified")
            return True
        if challenge.cancelled_at is not None:
            _mark_event_processed(event, note="Verification was replaced before email delivery")
            return True
        if challenge.expires_at <= now:
            EmailVerificationChallenge.objects.filter(
                pk=challenge.pk,
                used_at__isnull=True,
                cancelled_at__isnull=True,
            ).update(cancelled_at=now, updated_at=now)
            _mark_event_processed(event, note="Verification expired before email delivery")
            return True
        try:
            send_verification_email(challenge=challenge, event=event)
        except VerificationEmailDeliveryError as exc:
            _schedule_event_retry(event, str(exc))
        else:
            _mark_event_processed(event, note="Verification email accepted by SMTP")
        return True

    if event.event_type == "alert.resolved":
        predecessor = (
            OutboxEvent.objects.filter(
                aggregate_id=event.aggregate_id,
                event_type__in=["alert.opened", "alert.retry"],
                status__in=[OutboxEvent.Status.PENDING, OutboxEvent.Status.PROCESSING],
            )
            .order_by("created_at")
            .first()
        )
        if predecessor is not None:
            wait_until = max(predecessor.available_at, timezone.now() + timedelta(seconds=30))
            _schedule_event_retry(
                event,
                "Waiting for the corresponding opened alert to reach a terminal state",
                available_at=wait_until,
            )
            return True

    incident = AlertIncident.objects.select_related("profile").filter(pk=event.aggregate_id).first()
    if incident is None:
        _mark_event_failed(event, "Alert incident does not exist")
        return True
    snapshot_ids, recipient_ids = _active_guardian_recipient_ids(event, incident)
    if not snapshot_ids:
        _mark_event_processed(event, note="Incident has no guardian recipient snapshot")
        return True
    _invalidate_ineligible_attempts(event=event, active_recipient_ids=recipient_ids)
    if not recipient_ids:
        _mark_event_processed(event, note="No recipient remains an active guardian")
        return True
    queued, active_device_count = _prepare_delivery_attempts(
        event=event,
        incident=incident,
        recipient_ids=recipient_ids,
    )
    if not queued:
        latest = _latest_attempts(event)
        has_retryable = any(
            attempt.status == DeliveryAttempt.Status.RETRYABLE_FAILURE for attempt in latest
        )
        if has_retryable:
            retry_dates = [attempt.next_retry_at for attempt in latest if attempt.next_retry_at]
            _schedule_event_retry(
                event,
                "Push destinations are waiting for retry",
                available_at=min(retry_dates) if retry_dates else None,
            )
        elif active_device_count == 0 and not latest:
            _schedule_event_retry(event, "Recipient snapshot has no active push devices")
        else:
            _finish_event_from_attempts(event)
        return True

    owns_client = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0))
    try:
        response = client.post(
            settings.EXPO_PUSH_URL,
            headers=_headers(),
            json=[message for _, _, message in queued],
        )
        response.raise_for_status()
        payload = response.json()
        global_error = _global_expo_error(payload)
        if global_error:
            raise ExpoConfigurationError(global_error)
        data = payload.get("data", [])
        if isinstance(data, dict):
            data = [data]
        if len(data) != len(queued):
            raise ValueError("Expo returned a different number of tickets than messages")
    except ExpoConfigurationError as exc:
        for attempt, _, _ in queued:
            attempt.status = DeliveryAttempt.Status.PERMANENT_FAILURE
            attempt.response_data = {"error": str(exc)}
            attempt.save(update_fields=["status", "response_data", "updated_at"])
        _mark_event_failed(event, f"Expo configuration failure: {exc}")
        return True
    except (httpx.HTTPError, ValueError) as exc:
        retry_after = _retry_after_seconds(getattr(exc, "response", None))
        retryable = False
        for attempt, _, _ in queued:
            retryable = (
                _mark_attempt_retryable(
                    attempt,
                    {"error": str(exc), "kind": type(exc).__name__},
                    retry_after_seconds=retry_after,
                )
                or retryable
            )
        if retryable:
            retry_dates = [
                attempt.next_retry_at for attempt, _, _ in queued if attempt.next_retry_at
            ]
            _schedule_event_retry(
                event,
                str(exc),
                retry_after_seconds=retry_after,
                available_at=min(retry_dates) if retry_dates else None,
            )
        else:
            _mark_event_failed(event, f"All destinations exhausted retries: {exc}")
        return True
    finally:
        if owns_client:
            client.close()

    retry_needed = False
    invalid_credentials = False
    with transaction.atomic():
        for (attempt, device, _), ticket in zip(queued, data, strict=True):
            if not isinstance(ticket, dict):
                retry_needed = (
                    _mark_attempt_retryable(attempt, {"error": "Malformed Expo ticket"})
                    or retry_needed
                )
                continue
            if ticket.get("status") == "ok" and ticket.get("id"):
                attempt.status = DeliveryAttempt.Status.TICKET_RECEIVED
                attempt.expo_ticket_id = ticket["id"]
                attempt.response_data = ticket
                attempt.next_retry_at = None
                attempt.save(
                    update_fields=[
                        "status",
                        "expo_ticket_id",
                        "response_data",
                        "next_retry_at",
                        "updated_at",
                    ]
                )
                continue
            code = (ticket.get("details") or {}).get("error", "UnknownExpoError")
            if code in GLOBAL_CONFIGURATION_ERRORS:
                invalid_credentials = True
                attempt.status = DeliveryAttempt.Status.PERMANENT_FAILURE
                attempt.next_retry_at = None
                attempt.response_data = ticket
                attempt.save(
                    update_fields=["status", "next_retry_at", "response_data", "updated_at"]
                )
            elif code in PERMANENT_DEVICE_ERRORS:
                attempt.status = DeliveryAttempt.Status.PERMANENT_FAILURE
                attempt.next_retry_at = None
                attempt.response_data = ticket
                attempt.save(
                    update_fields=["status", "next_retry_at", "response_data", "updated_at"]
                )
                if code == "DeviceNotRegistered":
                    deactivate_push_device(device=device, actor=None)
            else:
                retry_needed = _mark_attempt_retryable(attempt, ticket) or retry_needed
        if invalid_credentials:
            _mark_event_failed(event, "Expo configuration failure: InvalidCredentials")
        elif retry_needed:
            retry_dates = [
                attempt.next_retry_at for attempt, _, _ in queued if attempt.next_retry_at
            ]
            _schedule_event_retry(
                event,
                "One or more Expo tickets failed transiently",
                available_at=min(retry_dates) if retry_dates else None,
            )
        else:
            _finish_event_from_attempts(event)
    return True


def process_one_alert_event(*, client: httpx.Client | None = None) -> bool:
    """Backward-compatible name used by existing deployment scripts."""
    return process_one_outbox_event(client=client)


def _claim_receipt_attempts(limit: int) -> list[DeliveryAttempt]:
    stale_before = timezone.now() - STALE_PROCESSING_AFTER
    with transaction.atomic():
        queryset = DeliveryAttempt.objects.select_for_update(
            skip_locked=connection.vendor == "postgresql"
        )
        attempts = list(
            queryset.filter(expo_ticket_id__gt="")
            .filter(
                Q(status=DeliveryAttempt.Status.TICKET_RECEIVED)
                | Q(
                    status=DeliveryAttempt.Status.RECEIPT_PROCESSING,
                    updated_at__lt=stale_before,
                )
            )
            .order_by("created_at")[:limit]
        )
        now = timezone.now()
        for attempt in attempts:
            attempt.status = DeliveryAttempt.Status.RECEIPT_PROCESSING
            attempt.updated_at = now
        DeliveryAttempt.objects.bulk_update(attempts, ["status", "updated_at"])
        return attempts


def _restore_receipt_claims(attempts: list[DeliveryAttempt]) -> None:
    DeliveryAttempt.objects.filter(id__in=[attempt.id for attempt in attempts]).update(
        status=DeliveryAttempt.Status.TICKET_RECEIVED,
        updated_at=timezone.now(),
    )


def fetch_push_receipts(*, client: httpx.Client | None = None, limit: int = 1000) -> int:
    attempts = _claim_receipt_attempts(limit)
    record_worker_heartbeat("push_receipts", tickets_claimed=len(attempts))
    if not attempts:
        return 0
    owns_client = client is None
    client = client or httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0))
    try:
        response = client.post(
            settings.EXPO_RECEIPTS_URL,
            headers=_headers(),
            json={"ids": [attempt.expo_ticket_id for attempt in attempts]},
        )
        response.raise_for_status()
        payload = response.json()
        global_error = _global_expo_error(payload)
        if global_error:
            raise ExpoConfigurationError(global_error)
        receipts = payload.get("data", {})
        if not isinstance(receipts, dict):
            raise ValueError("Expo receipt response data is not an object")
    except ExpoConfigurationError as exc:
        event_ids = {attempt.outbox_event_id for attempt in attempts if attempt.outbox_event_id}
        with transaction.atomic():
            DeliveryAttempt.objects.filter(id__in=[attempt.id for attempt in attempts]).update(
                status=DeliveryAttempt.Status.PERMANENT_FAILURE,
                response_data={"error": str(exc)},
                next_retry_at=None,
                updated_at=timezone.now(),
            )
            for event_id in event_ids:
                event = OutboxEvent.objects.select_for_update().get(pk=event_id)
                _mark_event_failed(event, f"Expo configuration failure: {exc} receipt response")
        return len(attempts)
    except Exception:
        _restore_receipt_claims(attempts)
        raise
    finally:
        if owns_client:
            client.close()

    processed = 0
    event_ids_to_finish: set[uuid.UUID] = set()
    event_ids_to_retry: set[uuid.UUID] = set()
    event_ids_invalid_credentials: set[uuid.UUID] = set()
    now = timezone.now()
    with transaction.atomic():
        for attempt in attempts:
            receipt = receipts.get(attempt.expo_ticket_id)
            if receipt is None:
                if attempt.created_at < now - RECEIPT_MAX_AGE:
                    attempt.status = DeliveryAttempt.Status.DEAD_LETTER
                    attempt.response_data = {"error": "Expo receipt did not arrive within 24 hours"}
                    if attempt.outbox_event_id:
                        event_ids_to_finish.add(attempt.outbox_event_id)
                else:
                    attempt.status = DeliveryAttempt.Status.TICKET_RECEIVED
                attempt.save(update_fields=["status", "response_data", "updated_at"])
                continue
            processed += 1
            if receipt.get("status") == "ok":
                # Expo's successful receipt only proves handoff to APNs/FCM. It
                # does not prove that a guardian's device displayed the push.
                attempt.status = DeliveryAttempt.Status.PROVIDER_ACCEPTED
                attempt.next_retry_at = None
                if attempt.outbox_event_id:
                    event_ids_to_finish.add(attempt.outbox_event_id)
            else:
                code = (receipt.get("details") or {}).get("error", "UnknownExpoError")
                if code in GLOBAL_CONFIGURATION_ERRORS:
                    attempt.status = DeliveryAttempt.Status.PERMANENT_FAILURE
                    attempt.next_retry_at = None
                    if attempt.outbox_event_id:
                        event_ids_invalid_credentials.add(attempt.outbox_event_id)
                elif code in PERMANENT_DEVICE_ERRORS:
                    attempt.status = DeliveryAttempt.Status.PERMANENT_FAILURE
                    attempt.next_retry_at = None
                    if code == "DeviceNotRegistered" and attempt.device_id:
                        device = PushDevice.objects.filter(pk=attempt.device_id).first()
                        if device is not None:
                            deactivate_push_device(device=device, actor=None)
                    if attempt.outbox_event_id:
                        event_ids_to_finish.add(attempt.outbox_event_id)
                else:
                    retryable = _mark_attempt_retryable(attempt, receipt)
                    if attempt.outbox_event_id:
                        (event_ids_to_retry if retryable else event_ids_to_finish).add(
                            attempt.outbox_event_id
                        )
                    continue
            attempt.response_data = receipt
            attempt.save(update_fields=["status", "response_data", "next_retry_at", "updated_at"])

        for event_id in event_ids_invalid_credentials:
            event = OutboxEvent.objects.select_for_update().get(pk=event_id)
            _mark_event_failed(event, "Expo configuration failure: InvalidCredentials receipt")
        for event_id in event_ids_to_retry - event_ids_invalid_credentials:
            event = OutboxEvent.objects.select_for_update().get(pk=event_id)
            retry_dates = list(
                DeliveryAttempt.objects.filter(
                    outbox_event=event,
                    status=DeliveryAttempt.Status.RETRYABLE_FAILURE,
                    next_retry_at__isnull=False,
                ).values_list("next_retry_at", flat=True)
            )
            _schedule_event_retry(
                event,
                "Expo receipt reported a transient delivery failure",
                available_at=min(retry_dates) if retry_dates else None,
            )
        for event_id in event_ids_to_finish - event_ids_to_retry - event_ids_invalid_credentials:
            event = OutboxEvent.objects.select_for_update().get(pk=event_id)
            _finish_event_from_attempts(event)
    return processed


class ExpoConfigurationError(RuntimeError):
    pass
