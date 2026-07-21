import json
import os
import uuid
from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from core.management.commands.seed_e2e import OWNER_EMAIL, assert_safe_e2e_database
from core.models import AlertIncident, AuditEvent, CheckIn, CheckInProfile, OutboxEvent, User
from core.services import sweep_expired_deadlines

PHASES = ("open-incident", "verify-resolution")


def _authorized_owner():
    credential = os.getenv("HLASIMSE_E2E_CREDENTIAL", "")
    if len(credential) < 32:
        raise CommandError("HLASIMSE_E2E_CREDENTIAL must be the generated per-run credential.")
    owner = User.objects.filter(email=OWNER_EMAIL).first()
    if owner is None or not owner.is_active or not owner.check_password(credential):
        raise CommandError("Reserved E2E owner authentication failed.")
    return owner


def _exact_profile(*, profile_id: uuid.UUID, owner) -> CheckInProfile:
    profile = CheckInProfile.objects.select_for_update().filter(pk=profile_id, owner=owner).first()
    if profile is None:
        raise CommandError("Profile does not belong to the authenticated reserved E2E owner.")
    if profile.archived_at is not None or not profile.enabled or profile.is_paused:
        raise CommandError("AT-08 requires one active, unpaused, unarchived E2E profile.")
    return profile


def _single_audit(*, incident: AlertIncident, event_type: str) -> AuditEvent:
    events = list(
        AuditEvent.objects.filter(
            aggregate_type="alert_incident",
            aggregate_id=incident.id,
            event_type=event_type,
        )
    )
    if len(events) != 1:
        raise CommandError(f"Expected exactly one {event_type} audit event for the AT-08 incident.")
    return events[0]


def _single_outbox(*, incident: AlertIncident, event_type: str) -> OutboxEvent:
    events = list(
        OutboxEvent.objects.filter(
            aggregate_type="alert_incident",
            aggregate_id=incident.id,
            event_type=event_type,
        )
    )
    if len(events) != 1:
        raise CommandError(
            f"Expected exactly one {event_type} outbox event for the AT-08 incident."
        )
    return events[0]


class Command(BaseCommand):
    help = (
        "Exercise the AT-08 deadline transition only for the authenticated reserved E2E owner "
        "in a fail-closed local E2E database. Production interval validation is unchanged."
    )

    def add_arguments(self, parser):
        parser.add_argument("--confirm-local-e2e", action="store_true")
        parser.add_argument("--phase", choices=PHASES, required=True)
        parser.add_argument("--profile-id", type=uuid.UUID, required=True)
        parser.add_argument("--incident-id", type=uuid.UUID)

    def handle(self, *args, **options):
        if not options["confirm_local_e2e"]:
            raise CommandError("Pass --confirm-local-e2e explicitly.")
        assert_safe_e2e_database()
        owner = _authorized_owner()
        if options["phase"] == "open-incident":
            if options["incident_id"] is not None:
                raise CommandError("Do not pass --incident-id while opening the AT-08 incident.")
            result = self._open_incident(profile_id=options["profile_id"], owner=owner)
        else:
            if options["incident_id"] is None:
                raise CommandError("Pass the exact --incident-id returned by open-incident.")
            result = self._verify_resolution(
                profile_id=options["profile_id"],
                incident_id=options["incident_id"],
                owner=owner,
            )
        self.stdout.write(json.dumps(result, sort_keys=True))

    @transaction.atomic
    def _open_incident(self, *, profile_id: uuid.UUID, owner) -> dict:
        profile = _exact_profile(profile_id=profile_id, owner=owner)
        transition_at = timezone.now()
        if profile.next_deadline_at is None or profile.next_deadline_at <= transition_at:
            raise CommandError(
                "AT-08 must start with a future server deadline before the E2E-only transition."
            )
        if AlertIncident.objects.filter(
            profile=profile,
            deadline_generation=profile.deadline_generation,
        ).exists():
            raise CommandError("The selected deadline generation already has an incident.")
        if CheckIn.objects.filter(profile=profile, submitted_from_queue=True).exists():
            raise CommandError("The selected profile already contains a queued check-in result.")

        original_interval_seconds = profile.interval_seconds
        original_deadline_at = profile.next_deadline_at
        profile.next_deadline_at = transition_at - timedelta(seconds=1)
        profile.save(update_fields=["next_deadline_at", "updated_at"])

        incidents_created, events_created = sweep_expired_deadlines(now=transition_at)
        incident = AlertIncident.objects.filter(
            profile=profile,
            deadline_generation=profile.deadline_generation,
        ).first()
        if incident is None or incident.status != AlertIncident.Status.OPEN:
            raise CommandError("The real deadline sweep did not open the exact AT-08 incident.")
        if incidents_created < 1 or events_created < 1:
            raise CommandError(
                "The real deadline sweep did not report incident and outbox creation."
            )
        if profile.interval_seconds != original_interval_seconds:
            raise CommandError("The E2E transition unexpectedly changed the production interval.")

        opened_audit = _single_audit(incident=incident, event_type="incident.opened")
        opened_outbox = _single_outbox(incident=incident, event_type="alert.opened")
        if (
            opened_audit.actor_kind != AuditEvent.ActorKind.SYSTEM
            or opened_audit.actor_id is not None
            or opened_audit.metadata.get("profile_id") != str(profile.id)
            or opened_audit.metadata.get("deadline_generation") != incident.deadline_generation
        ):
            raise CommandError("Opened incident audit identity or metadata is inconsistent.")
        if (
            opened_outbox.payload.get("incident_id") != str(incident.id)
            or opened_outbox.payload.get("profile_id") != str(profile.id)
            or opened_outbox.payload.get("deadline_generation") != incident.deadline_generation
        ):
            raise CommandError("Opened outbox payload does not identify the exact AT-08 incident.")

        return {
            "acceptance_test": "AT-08",
            "schema_version": 1,
            "phase": "incident_opened_while_mobile_pending",
            "profile_id": str(profile.id),
            "deadline_generation": incident.deadline_generation,
            "original_deadline_was_future": original_deadline_at > transition_at,
            "deadline_forced_past_for_e2e": incident.deadline_at < incident.opened_at,
            "production_interval_unchanged": profile.interval_seconds == original_interval_seconds,
            "profile_interval_seconds": profile.interval_seconds,
            "server_queued_checkin_count": CheckIn.objects.filter(
                profile=profile,
                submitted_from_queue=True,
            ).count(),
            "incident_id": str(incident.id),
            "incident_status": incident.status,
            "opened_audit_id": str(opened_audit.id),
            "opened_audit_system_actor": True,
            "opened_outbox_id": str(opened_outbox.id),
            "opened_outbox_status": opened_outbox.status,
            "scheduler_incidents_created": incidents_created,
            "scheduler_events_created": events_created,
        }

    @transaction.atomic
    def _verify_resolution(
        self,
        *,
        profile_id: uuid.UUID,
        incident_id: uuid.UUID,
        owner,
    ) -> dict:
        profile = _exact_profile(profile_id=profile_id, owner=owner)
        incident = (
            AlertIncident.objects.select_for_update(of=("self",))
            .filter(pk=incident_id, profile=profile)
            .select_related("resolved_by_check_in")
            .first()
        )
        if incident is None:
            raise CommandError("The exact AT-08 incident/profile identity does not match.")
        check_in = incident.resolved_by_check_in
        if incident.status != AlertIncident.Status.RESOLVED or check_in is None:
            raise CommandError("The exact AT-08 incident is not resolved by a check-in.")
        if not check_in.submitted_from_queue:
            raise CommandError("The incident was not resolved by the offline queue sync.")
        if check_in.client_recorded_at is None or check_in.client_recorded_at > incident.opened_at:
            raise CommandError("The queued client action was not recorded before incident opening.")
        if check_in.accepted_at < incident.opened_at:
            raise CommandError("The server accepted the queued check-in before incident opening.")
        if check_in.deadline_generation != incident.deadline_generation + 1:
            raise CommandError(
                "Queued sync did not advance exactly the incident deadline generation."
            )
        if CheckIn.objects.filter(profile=profile, submitted_from_queue=True).count() != 1:
            raise CommandError("AT-08 expected exactly one server-accepted queued check-in.")

        opened_audit = _single_audit(incident=incident, event_type="incident.opened")
        resolved_audit = _single_audit(incident=incident, event_type="incident.resolved")
        opened_outbox = _single_outbox(incident=incident, event_type="alert.opened")
        resolved_outbox = _single_outbox(incident=incident, event_type="alert.resolved")
        if (
            resolved_audit.actor_id != owner.id
            or resolved_audit.metadata.get("profile_id") != str(profile.id)
            or resolved_audit.metadata.get("check_in_id") != str(check_in.id)
            or resolved_audit.metadata.get("resolution") != "confirmed_check_in"
        ):
            raise CommandError("Resolved incident audit identity or metadata is inconsistent.")
        if (
            resolved_outbox.payload.get("incident_id") != str(incident.id)
            or resolved_outbox.payload.get("profile_id") != str(profile.id)
            or resolved_outbox.payload.get("check_in_id") != str(check_in.id)
        ):
            raise CommandError("Resolved outbox does not reference the queued check-in.")

        check_in_audits = list(
            AuditEvent.objects.filter(
                aggregate_type="check_in",
                aggregate_id=check_in.id,
                event_type="checkin.confirmed",
            )
        )
        if len(check_in_audits) != 1:
            raise CommandError("Expected one audit event for the queued check-in confirmation.")
        check_in_audit = check_in_audits[0]
        if (
            check_in_audit.actor_id != owner.id
            or check_in_audit.metadata.get("submitted_from_queue") is not True
            or check_in_audit.metadata.get("resolved_incident_count") != 1
        ):
            raise CommandError("Queued check-in audit metadata does not prove exact resolution.")

        return {
            "acceptance_test": "AT-08",
            "schema_version": 1,
            "phase": "exact_incident_resolved_after_api_restart",
            "profile_id": str(profile.id),
            "deadline_generation": incident.deadline_generation,
            "incident_id": str(incident.id),
            "incident_status": incident.status,
            "queued_check_in_id": str(check_in.id),
            "submitted_from_queue": check_in.submitted_from_queue,
            "client_recorded_before_incident": check_in.client_recorded_at <= incident.opened_at,
            "server_accepted_after_incident": check_in.accepted_at >= incident.opened_at,
            "opened_audit_id": str(opened_audit.id),
            "resolved_audit_id": str(resolved_audit.id),
            "check_in_audit_id": str(check_in_audit.id),
            "owner_audit_actor_verified": True,
            "opened_outbox_id": str(opened_outbox.id),
            "resolved_outbox_id": str(resolved_outbox.id),
            "opened_outbox_preserved": OutboxEvent.objects.filter(pk=opened_outbox.id).exists(),
            "audit_event_types": [
                opened_audit.event_type,
                resolved_audit.event_type,
                check_in_audit.event_type,
            ],
            "outbox_event_types": [opened_outbox.event_type, resolved_outbox.event_type],
        }
