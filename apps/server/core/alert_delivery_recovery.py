import uuid
from dataclasses import dataclass

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import transaction

from .audit import record_audit_event, validate_audit_metadata
from .models import AlertIncident, DeliveryAttempt, GuardianMembership, OutboxEvent

MIN_RECOVERY_REASON_LENGTH = 12
MAX_RECOVERY_REASON_LENGTH = 200
RECOVERABLE_ALERT_EVENT_TYPES = {"alert.opened", "alert.retry"}
_DELIVERY_SUCCESS_STATUSES = {
    DeliveryAttempt.Status.LEGACY_DELIVERED,
    DeliveryAttempt.Status.TICKET_RECEIVED,
    DeliveryAttempt.Status.RECEIPT_PROCESSING,
    DeliveryAttempt.Status.PROVIDER_ACCEPTED,
}


class AlertDeliveryRecoveryError(ValueError):
    """The requested manual recovery is unsafe or does not identify one exact failure."""


@dataclass(frozen=True)
class AlertDeliveryRecoveryResult:
    retry_event: OutboxEvent
    created: bool
    active_recipient_count: int


def _validated_reason(reason: str) -> str:
    normalized = reason.strip()
    if not MIN_RECOVERY_REASON_LENGTH <= len(normalized) <= MAX_RECOVERY_REASON_LENGTH:
        raise AlertDeliveryRecoveryError(
            "Recovery reason must contain between "
            f"{MIN_RECOVERY_REASON_LENGTH} and {MAX_RECOVERY_REASON_LENGTH} characters."
        )
    try:
        validate_audit_metadata({"reason": normalized})
    except ValidationError as exc:
        raise AlertDeliveryRecoveryError("Recovery reason is not safe for the audit log.") from exc
    return normalized


def _snapshot_recipient_ids(event: OutboxEvent, incident: AlertIncident) -> list[uuid.UUID]:
    raw_ids = event.payload.get("recipient_user_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        raise AlertDeliveryRecoveryError(
            "Source event has no explicit non-empty recipient snapshot; recovery is ambiguous."
        )

    recipient_ids: list[uuid.UUID] = []
    for raw_id in raw_ids:
        try:
            recipient_id = uuid.UUID(str(raw_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise AlertDeliveryRecoveryError(
                "Source event contains an invalid recipient snapshot; recovery is ambiguous."
            ) from exc
        if recipient_id in recipient_ids:
            raise AlertDeliveryRecoveryError(
                "Source event contains duplicate recipient identities; recovery is ambiguous."
            )
        recipient_ids.append(recipient_id)

    incident_snapshot_ids = set(incident.recipients.values_list("user_id_snapshot", flat=True))
    if any(recipient_id not in incident_snapshot_ids for recipient_id in recipient_ids):
        raise AlertDeliveryRecoveryError(
            "Source event recipients do not match the incident snapshot; recovery is ambiguous."
        )
    return recipient_ids


def _dead_letter_recipient_ids(
    event: OutboxEvent, snapshot_recipient_ids: list[uuid.UUID]
) -> list[uuid.UUID]:
    latest_attempts_by_device: dict[uuid.UUID, DeliveryAttempt] = {}
    attempts = (
        event.delivery_attempts.filter(account_erasure_tombstone=False)
        .select_related("device")
        .order_by("device_id_snapshot", "attempt_number")
    )
    for attempt in attempts:
        if attempt.device_id_snapshot is not None:
            latest_attempts_by_device[attempt.device_id_snapshot] = attempt
    latest_attempts = list(latest_attempts_by_device.values())
    has_dead_letter_attempt = any(
        attempt.status == DeliveryAttempt.Status.DEAD_LETTER for attempt in latest_attempts
    )
    has_dead_letter_event = event.last_error.lower().startswith("dead letter")
    if not has_dead_letter_attempt and not has_dead_letter_event:
        raise AlertDeliveryRecoveryError("Source event is not an explicit dead letter.")

    # Event-level dead letters can occur before any destination exists (for example,
    # after repeated claims with no registered device). In that case the immutable
    # recipient snapshot is the only safe retry scope.
    if not latest_attempts:
        return snapshot_recipient_ids

    successful_recipient_ids: set[uuid.UUID] = set()
    dead_letter_recipient_ids: set[uuid.UUID] = set()
    for attempt in latest_attempts:
        if attempt.status not in {*_DELIVERY_SUCCESS_STATUSES, DeliveryAttempt.Status.DEAD_LETTER}:
            continue
        if attempt.device is None:
            raise AlertDeliveryRecoveryError(
                "A terminal delivery attempt no longer identifies its recipient; "
                "recovery is ambiguous."
            )
        if attempt.status in _DELIVERY_SUCCESS_STATUSES:
            successful_recipient_ids.add(attempt.device.user_id)
        else:
            dead_letter_recipient_ids.add(attempt.device.user_id)

    retry_recipient_ids = [
        recipient_id
        for recipient_id in snapshot_recipient_ids
        if recipient_id in dead_letter_recipient_ids
        and recipient_id not in successful_recipient_ids
    ]
    if not retry_recipient_ids:
        raise AlertDeliveryRecoveryError(
            "No snapshotted recipient has an unaccepted dead-letter outcome to recover."
        )
    return retry_recipient_ids


@transaction.atomic
def recover_dead_letter_alert(
    *,
    event_id: uuid.UUID,
    incident_id: uuid.UUID,
    operator_id: uuid.UUID,
    reason: str,
) -> AlertDeliveryRecoveryResult:
    """Create one immutable, audited retry event for one exact alert dead letter."""
    normalized_reason = _validated_reason(reason)

    operator = get_user_model().objects.select_for_update().filter(pk=operator_id).first()
    if operator is None:
        raise AlertDeliveryRecoveryError("Operator does not exist.")
    if not operator.is_active or not operator.is_staff:
        raise AlertDeliveryRecoveryError("Operator must be an active staff user.")

    incident = (
        AlertIncident.objects.select_for_update()
        .select_related("profile")
        .filter(pk=incident_id)
        .first()
    )
    if incident is None:
        raise AlertDeliveryRecoveryError("Incident does not exist.")

    source_event = OutboxEvent.objects.select_for_update().filter(pk=event_id).first()
    if source_event is None:
        raise AlertDeliveryRecoveryError("Source event does not exist.")
    if source_event.aggregate_type != "alert_incident" or source_event.aggregate_id != incident.id:
        raise AlertDeliveryRecoveryError(
            "Source event and explicit incident identity do not match."
        )
    if source_event.event_type not in RECOVERABLE_ALERT_EVENT_TYPES:
        raise AlertDeliveryRecoveryError(
            "Only failed alert.opened or alert.retry events can be recovered."
        )
    if source_event.status not in {OutboxEvent.Status.FAILED, OutboxEvent.Status.PROCESSED}:
        raise AlertDeliveryRecoveryError("Source event is not terminal.")
    if incident.status != AlertIncident.Status.OPEN:
        raise AlertDeliveryRecoveryError(
            "Incident is no longer open; an opened-alert retry would be obsolete."
        )

    snapshot_recipient_ids = _snapshot_recipient_ids(source_event, incident)
    recoverable_recipient_ids = _dead_letter_recipient_ids(source_event, snapshot_recipient_ids)
    active_recipient_ids = set(
        GuardianMembership.objects.filter(
            profile_id=incident.profile_id,
            guardian_id__in=recoverable_recipient_ids,
            status=GuardianMembership.Status.ACTIVE,
        ).values_list("guardian_id", flat=True)
    )
    authorized_recipient_ids = [
        recipient_id
        for recipient_id in recoverable_recipient_ids
        if recipient_id in active_recipient_ids
    ]
    if not authorized_recipient_ids:
        raise AlertDeliveryRecoveryError("No snapshotted recipient remains an active guardian.")

    deduplication_key = f"alert-retry:{source_event.id}"
    retry_event, created = OutboxEvent.objects.get_or_create(
        deduplication_key=deduplication_key,
        defaults={
            "event_type": "alert.retry",
            "aggregate_type": "alert_incident",
            "aggregate_id": incident.id,
            "payload": {
                "incident_id": str(incident.id),
                "source_event_id": str(source_event.id),
                "deadline_generation": incident.deadline_generation,
                "recipient_user_ids": [
                    str(recipient_id) for recipient_id in authorized_recipient_ids
                ],
            },
        },
    )
    if not created and (
        retry_event.event_type != "alert.retry"
        or retry_event.aggregate_type != "alert_incident"
        or retry_event.aggregate_id != incident.id
        or retry_event.payload.get("incident_id") != str(incident.id)
        or retry_event.payload.get("source_event_id") != str(source_event.id)
        or retry_event.payload.get("deadline_generation") != incident.deadline_generation
    ):
        raise AlertDeliveryRecoveryError(
            "The recovery idempotency key is already used by a conflicting event."
        )
    if not created:
        retry_recipient_ids = _snapshot_recipient_ids(retry_event, incident)
        if retry_recipient_ids != authorized_recipient_ids:
            raise AlertDeliveryRecoveryError(
                "The recovery idempotency key is already used by a conflicting event."
            )

    if created:
        record_audit_event(
            event_type="alert.delivery_recovery_requested",
            aggregate_type="alert_incident",
            aggregate_id=incident.id,
            actor=operator,
            metadata={
                "source_event_id": str(source_event.id),
                "retry_event_id": str(retry_event.id),
                "source_event_type": source_event.event_type,
                "active_recipient_count": len(authorized_recipient_ids),
                "reason": normalized_reason,
            },
        )

    return AlertDeliveryRecoveryResult(
        retry_event=retry_event,
        created=created,
        active_recipient_count=len(authorized_recipient_ids),
    )
