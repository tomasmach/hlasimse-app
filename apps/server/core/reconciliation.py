import uuid
from collections import Counter
from dataclasses import asdict, dataclass

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from .audit import record_audit_event
from .models import (
    AlertIncident,
    AlertRecipient,
    CheckInProfile,
    GuardianMembership,
    OutboxEvent,
)
from .services import _materialize_due_incident_locked, _recipient_payload


@dataclass(frozen=True)
class ReconciliationIssue:
    code: str
    aggregate_type: str
    aggregate_id: str
    repairable: bool
    detail: str


@dataclass(frozen=True)
class ReconciliationReport:
    issues: tuple[ReconciliationIssue, ...]
    repairs: tuple[str, ...]

    def as_dict(self) -> dict:
        return {
            "issue_count": len(self.issues),
            "issues_by_code": dict(sorted(Counter(item.code for item in self.issues).items())),
            "issues": [asdict(item) for item in self.issues],
            "repair_count": len(self.repairs),
            "repairs": list(self.repairs),
        }


def _issue(*, code, aggregate_type, aggregate_id, repairable, detail):
    return ReconciliationIssue(
        code=code,
        aggregate_type=aggregate_type,
        aggregate_id=str(aggregate_id),
        repairable=repairable,
        detail=detail,
    )


def _recipient_ids_from_event(event: OutboxEvent) -> set[uuid.UUID] | None:
    raw_ids = event.payload.get("recipient_user_ids")
    if not isinstance(raw_ids, list):
        return None
    try:
        return {uuid.UUID(str(raw_id)) for raw_id in raw_ids}
    except TypeError, ValueError, AttributeError:
        return None


def _create_missing_outbox_event(*, incident_id, event_type: str) -> bool:
    with transaction.atomic():
        incident = (
            AlertIncident.objects.select_for_update().select_related("profile").get(pk=incident_id)
        )
        if event_type == "alert.resolved" and (
            incident.status != AlertIncident.Status.RESOLVED
            or incident.resolved_by_check_in_id is None
        ):
            return False
        prefix = "alert-opened" if event_type == "alert.opened" else "alert-resolved"
        deduplication_key = (
            f"{prefix}:{incident.profile_id}:{incident.deadline_generation}"
            if event_type == "alert.opened"
            else f"{prefix}:{incident.id}"
        )
        payload = {
            "incident_id": str(incident.id),
            "profile_id": str(incident.profile_id),
            **_recipient_payload(incident),
        }
        if event_type == "alert.opened":
            payload["deadline_generation"] = incident.deadline_generation
        else:
            payload["check_in_id"] = str(incident.resolved_by_check_in_id)
        _event, created = OutboxEvent.objects.get_or_create(
            deduplication_key=deduplication_key,
            defaults={
                "event_type": event_type,
                "aggregate_type": "alert_incident",
                "aggregate_id": incident.id,
                "payload": payload,
            },
        )
        if created:
            record_audit_event(
                event_type="reconciliation.repaired",
                aggregate_type="alert_incident",
                aggregate_id=incident.id,
                metadata={"repair_code": f"missing_{event_type.replace('.', '_')}_outbox"},
            )
        return created


def _restore_recipient_snapshots(*, incident_id, recipient_ids: set[uuid.UUID]) -> int:
    with transaction.atomic():
        incident = AlertIncident.objects.select_for_update().get(pk=incident_id)
        existing_ids = set(
            AlertRecipient.objects.filter(incident=incident).values_list(
                "user_id_snapshot", flat=True
            )
        )
        missing_ids = recipient_ids - existing_ids
        if not missing_ids:
            return 0
        current_guardian_ids = set(
            GuardianMembership.objects.filter(
                profile_id=incident.profile_id,
                guardian_id__in=missing_ids,
            ).values_list("guardian_id", flat=True)
        )
        AlertRecipient.objects.bulk_create(
            [
                AlertRecipient(
                    incident=incident,
                    user_id=recipient_id if recipient_id in current_guardian_ids else None,
                    user_id_snapshot=recipient_id,
                )
                for recipient_id in missing_ids
            ],
            ignore_conflicts=True,
        )
        restored = len(missing_ids)
        record_audit_event(
            event_type="reconciliation.repaired",
            aggregate_type="alert_incident",
            aggregate_id=incident.id,
            metadata={"repair_code": "recipient_snapshots_from_outbox", "row_count": restored},
        )
        return restored


def _repair_expired_profile(*, profile_id, now) -> bool:
    with transaction.atomic():
        profile = CheckInProfile.objects.select_for_update().get(pk=profile_id)
        if AlertIncident.objects.filter(profile=profile, status=AlertIncident.Status.OPEN).exists():
            return False
        _incident, created, _event_created = _materialize_due_incident_locked(
            profile=profile,
            now=now,
        )
        return created


def reconcile_domain_state(*, repair: bool = False, now=None) -> ReconciliationReport:
    """Detect safety-domain gaps and optionally apply conservative deterministic repairs.

    Repairs never close incidents, choose between conflicting recipient histories, or
    overwrite an existing outbox event. They may materialize an otherwise unambiguous
    expired generation, recreate a missing outbox event from immutable incident
    snapshots, or restore recipient snapshots from an existing opened-event payload.
    """
    now = now or timezone.now()
    issues: list[ReconciliationIssue] = []
    repairs: list[str] = []

    expired_profiles = CheckInProfile.objects.filter(
        archived_at__isnull=True,
        enabled=True,
        is_paused=False,
        next_deadline_at__isnull=False,
        next_deadline_at__lte=now,
    ).order_by("next_deadline_at", "id")
    for profile in expired_profiles:
        generation_incident = AlertIncident.objects.filter(
            profile=profile,
            deadline_generation=profile.deadline_generation,
        ).first()
        if generation_incident is None:
            has_other_open = AlertIncident.objects.filter(
                profile=profile,
                status=AlertIncident.Status.OPEN,
            ).exists()
            can_repair = not has_other_open
            issues.append(
                _issue(
                    code="expired_profile_missing_incident",
                    aggregate_type="check_in_profile",
                    aggregate_id=profile.id,
                    repairable=can_repair,
                    detail=(
                        "Current expired generation has no incident."
                        if can_repair
                        else (
                            "Current expired generation has no incident while another incident "
                            "is open."
                        )
                    ),
                )
            )
            if repair and can_repair and _repair_expired_profile(profile_id=profile.id, now=now):
                repairs.append(f"materialized_incident:{profile.id}")
        elif generation_incident.status != AlertIncident.Status.OPEN:
            issues.append(
                _issue(
                    code="expired_generation_incident_not_open",
                    aggregate_type="alert_incident",
                    aggregate_id=generation_incident.id,
                    repairable=False,
                    detail="The current expired generation points to a resolved incident.",
                )
            )

    duplicate_open_profiles = (
        CheckInProfile.objects.annotate(
            open_count=Count("incidents", filter=Q(incidents__status=AlertIncident.Status.OPEN))
        )
        .filter(open_count__gt=1)
        .values_list("id", "open_count")
    )
    for profile_id, open_count in duplicate_open_profiles:
        issues.append(
            _issue(
                code="multiple_open_incidents",
                aggregate_type="check_in_profile",
                aggregate_id=profile_id,
                repairable=False,
                detail=f"Profile has {open_count} open incidents; operator review is required.",
            )
        )

    for incident in AlertIncident.objects.select_related("profile", "resolved_by_check_in"):
        if incident.status == AlertIncident.Status.OPEN and (
            incident.resolved_at is not None or incident.resolved_by_check_in_id is not None
        ):
            issues.append(
                _issue(
                    code="open_incident_has_resolution_fields",
                    aggregate_type="alert_incident",
                    aggregate_id=incident.id,
                    repairable=False,
                    detail="Open incident contains resolution evidence.",
                )
            )
        if incident.status == AlertIncident.Status.RESOLVED:
            if incident.resolved_at is None or incident.resolved_by_check_in_id is None:
                issues.append(
                    _issue(
                        code="resolved_incident_missing_evidence",
                        aggregate_type="alert_incident",
                        aggregate_id=incident.id,
                        repairable=False,
                        detail="Resolved incident lacks its timestamp or confirmed check-in.",
                    )
                )
            elif incident.resolved_by_check_in.profile_id != incident.profile_id:
                issues.append(
                    _issue(
                        code="resolution_checkin_profile_mismatch",
                        aggregate_type="alert_incident",
                        aggregate_id=incident.id,
                        repairable=False,
                        detail="Resolution check-in belongs to another profile.",
                    )
                )

        opened_key = f"alert-opened:{incident.profile_id}:{incident.deadline_generation}"
        opened_event = OutboxEvent.objects.filter(deduplication_key=opened_key).first()
        snapshot_ids = set(incident.recipients.values_list("user_id_snapshot", flat=True))
        if opened_event is None:
            active_at_open_ids = set(
                GuardianMembership.objects.filter(
                    profile_id=incident.profile_id,
                    status=GuardianMembership.Status.ACTIVE,
                    created_at__lte=incident.opened_at,
                ).values_list("guardian_id", flat=True)
            )
            snapshots_may_be_incomplete = bool(active_at_open_ids - snapshot_ids)
            issues.append(
                _issue(
                    code="missing_alert_opened_outbox",
                    aggregate_type="alert_incident",
                    aggregate_id=incident.id,
                    repairable=not snapshots_may_be_incomplete,
                    detail=(
                        "Opened outbox event is missing."
                        if not snapshots_may_be_incomplete
                        else "Opened outbox and expected recipient snapshots are missing."
                    ),
                )
            )
            if (
                repair
                and not snapshots_may_be_incomplete
                and _create_missing_outbox_event(
                    incident_id=incident.id,
                    event_type="alert.opened",
                )
            ):
                repairs.append(f"created_alert_opened_outbox:{incident.id}")
        else:
            event_recipient_ids = _recipient_ids_from_event(opened_event)
            if event_recipient_ids is None:
                issues.append(
                    _issue(
                        code="invalid_alert_opened_recipient_payload",
                        aggregate_type="outbox_event",
                        aggregate_id=opened_event.id,
                        repairable=False,
                        detail="Opened event recipient snapshot payload is malformed.",
                    )
                )
            else:
                missing_snapshot_ids = event_recipient_ids - snapshot_ids
                extra_snapshot_ids = snapshot_ids - event_recipient_ids
                if missing_snapshot_ids:
                    issues.append(
                        _issue(
                            code="missing_alert_recipient_snapshots",
                            aggregate_type="alert_incident",
                            aggregate_id=incident.id,
                            repairable=True,
                            detail=(
                                f"Opened event references {len(missing_snapshot_ids)} missing "
                                "recipient snapshots."
                            ),
                        )
                    )
                    if repair:
                        restored = _restore_recipient_snapshots(
                            incident_id=incident.id,
                            recipient_ids=event_recipient_ids,
                        )
                        if restored:
                            repairs.append(f"restored_recipient_snapshots:{incident.id}:{restored}")
                if extra_snapshot_ids:
                    issues.append(
                        _issue(
                            code="recipient_snapshots_missing_from_outbox",
                            aggregate_type="alert_incident",
                            aggregate_id=incident.id,
                            repairable=False,
                            detail=(
                                f"Incident has {len(extra_snapshot_ids)} snapshots absent from "
                                "its opened event."
                            ),
                        )
                    )
            if (
                opened_event.event_type != "alert.opened"
                or opened_event.aggregate_type != "alert_incident"
                or opened_event.aggregate_id != incident.id
            ):
                issues.append(
                    _issue(
                        code="alert_opened_outbox_identity_mismatch",
                        aggregate_type="outbox_event",
                        aggregate_id=opened_event.id,
                        repairable=False,
                        detail="Opened outbox identity fields do not match its incident.",
                    )
                )

        if incident.status == AlertIncident.Status.RESOLVED and incident.resolved_by_check_in_id:
            resolved_key = f"alert-resolved:{incident.id}"
            resolved_event = OutboxEvent.objects.filter(deduplication_key=resolved_key).first()
            if resolved_event is None:
                issues.append(
                    _issue(
                        code="missing_alert_resolved_outbox",
                        aggregate_type="alert_incident",
                        aggregate_id=incident.id,
                        repairable=True,
                        detail="Resolved incident has no resolution outbox event.",
                    )
                )
                if repair and _create_missing_outbox_event(
                    incident_id=incident.id,
                    event_type="alert.resolved",
                ):
                    repairs.append(f"created_alert_resolved_outbox:{incident.id}")

    return ReconciliationReport(issues=tuple(issues), repairs=tuple(repairs))
