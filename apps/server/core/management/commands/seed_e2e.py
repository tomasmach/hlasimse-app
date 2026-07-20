import json
import os
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from core.models import (
    AlertIncident,
    CheckIn,
    CheckInProfile,
    DeliveryAttempt,
    EmailVerificationChallenge,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    User,
)
from core.services import (
    accept_invitation,
    create_invitation,
    create_profile,
    perform_check_in,
    sweep_expired_deadlines,
)

OWNER_EMAIL = "e2e.owner@hlasimse.invalid"
GUARDIAN_EMAIL = "e2e.guardian@hlasimse.invalid"
E2E_EMAILS = (OWNER_EMAIL, GUARDIAN_EMAIL)
SEED_MODES = ("guardian-open", "owner-no-profile", "cleanup-only")


def assert_safe_e2e_database() -> None:
    """Fail closed unless this is an unmistakably local development database."""
    if not settings.DEBUG:
        raise CommandError("E2E seed is disabled when DEBUG is false.")

    config = connection.settings_dict
    engine = str(config.get("ENGINE", ""))
    database_name = str(config.get("NAME", ""))
    if engine == "django.db.backends.sqlite3":
        database_path = Path(database_name).resolve()
        server_root = Path(settings.BASE_DIR).resolve()
        if database_path.parent != server_root or database_path.name != "db.sqlite3":
            raise CommandError(
                "E2E seed only allows the repository-local apps/server/db.sqlite3 database."
            )
        return

    if engine == "django.db.backends.postgresql":
        host = str(config.get("HOST", "")).strip().lower()
        safe_hosts = {"", "localhost", "127.0.0.1", "::1"}
        normalized_name = database_name.lower().replace("-", "_")
        safe_name = any(part in {"e2e", "test"} for part in normalized_name.split("_") if part)
        if host not in safe_hosts or not safe_name:
            raise CommandError(
                "PostgreSQL E2E seed requires a loopback/local socket and a database name "
                "containing a distinct 'e2e' or 'test' segment."
            )
        return

    raise CommandError(f"Unsupported E2E database engine: {engine or 'unknown'}")


def delete_previous_e2e_dataset() -> set:
    """Delete only aggregates reachable from the two exact reserved users.

    Outbox aggregate IDs are intentionally not foreign keys. Remove delivery rows
    first (their outbox relation is PROTECT), then the matching outbox rows, then
    the users and their normal FK graph. Immutable audit rows remain anonymized.
    """
    user_ids = list(User.objects.filter(email__in=E2E_EMAILS).values_list("id", flat=True))
    if not user_ids:
        return set()

    profile_ids = list(
        CheckInProfile.objects.filter(owner_id__in=user_ids).values_list("id", flat=True)
    )
    check_in_ids = list(
        CheckIn.objects.filter(profile_id__in=profile_ids).values_list("id", flat=True)
    )
    incident_ids = list(
        AlertIncident.objects.filter(profile_id__in=profile_ids).values_list("id", flat=True)
    )
    invitation_ids = list(
        GuardianInvitation.objects.filter(
            Q(profile_id__in=profile_ids)
            | Q(invited_by_id__in=user_ids)
            | Q(accepted_by_id__in=user_ids)
            | Q(normalized_email__in=E2E_EMAILS)
        ).values_list("id", flat=True)
    )
    membership_ids = list(
        GuardianMembership.objects.filter(
            Q(profile_id__in=profile_ids) | Q(guardian_id__in=user_ids)
        ).values_list("id", flat=True)
    )
    device_ids = list(PushDevice.objects.filter(user_id__in=user_ids).values_list("id", flat=True))
    challenge_ids = list(
        EmailVerificationChallenge.objects.filter(user_id__in=user_ids).values_list("id", flat=True)
    )
    aggregate_ids = {
        *user_ids,
        *profile_ids,
        *check_in_ids,
        *incident_ids,
        *invitation_ids,
        *membership_ids,
        *device_ids,
        *challenge_ids,
    }
    outbox_ids = list(
        OutboxEvent.objects.filter(aggregate_id__in=aggregate_ids).values_list("id", flat=True)
    )
    DeliveryAttempt.objects.filter(
        Q(outbox_event_id__in=outbox_ids) | Q(incident_id__in=incident_ids)
    ).delete()
    OutboxEvent.objects.filter(id__in=outbox_ids).delete()
    GuardianInvitation.objects.filter(id__in=invitation_ids).delete()
    User.objects.filter(id__in=user_ids).delete()
    if OutboxEvent.objects.filter(aggregate_id__in=aggregate_ids).exists():
        raise CommandError("Reserved E2E outbox aggregates survived the bounded cleanup.")
    return aggregate_ids


class Command(BaseCommand):
    help = (
        "Reset and seed the two reserved @hlasimse.invalid simulator accounts. "
        "The command refuses non-debug and non-local databases."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--confirm-local-e2e",
            action="store_true",
            help="Explicitly confirm that this is a bounded local E2E operation.",
        )
        parser.add_argument(
            "--mode",
            choices=SEED_MODES,
            default="guardian-open",
            help=(
                "guardian-open creates the two-account active-incident fixture; "
                "owner-no-profile creates verified accounts with no safety profile; "
                "cleanup-only removes the exact reserved fixture graph without recreating it."
            ),
        )

    def handle(self, *args, **options):
        if not options["confirm_local_e2e"]:
            raise CommandError("Pass --confirm-local-e2e explicitly.")
        assert_safe_e2e_database()
        run_credential = os.getenv("HLASIMSE_E2E_CREDENTIAL", "")
        if options["mode"] != "cleanup-only" and len(run_credential) < 32:
            raise CommandError(
                "HLASIMSE_E2E_CREDENTIAL must be generated per run and contain "
                "at least 32 characters."
            )

        with transaction.atomic():
            # Exact reserved addresses are the complete deletion boundary. Never use a
            # domain suffix query or delete unrelated fixtures/development data.
            removed_aggregate_ids = delete_previous_e2e_dataset()

            profile = None
            invitation = None
            membership = None
            incident = None
            incidents_created = 0
            events_created = 0
            if options["mode"] != "cleanup-only":
                owner = User.objects.create_user(
                    email=OWNER_EMAIL,
                    password=run_credential,
                    first_name="E2E Vlastník",
                )
                guardian = User.objects.create_user(
                    email=GUARDIAN_EMAIL,
                    password=run_credential,
                    first_name="E2E Strážce",
                )
            if options["mode"] == "guardian-open":
                profile = create_profile(
                    owner=owner,
                    name="E2E bezpečnostní profil",
                    interval_seconds=3_600,
                )
                perform_check_in(
                    profile=profile,
                    idempotency_key="e2e-seed-baseline-check-in",
                    client_recorded_at=timezone.now() - timedelta(minutes=20),
                )
                invitation, raw_token = create_invitation(
                    profile=profile,
                    invited_by=owner,
                    email=guardian.email,
                )
                membership = accept_invitation(raw_token=raw_token, user=guardian)

                # Create one deterministic open incident after the guardian snapshot exists.
                profile.refresh_from_db()
                profile.next_deadline_at = timezone.now() - timedelta(minutes=5)
                profile.save(update_fields=["next_deadline_at", "updated_at"])
                incidents_created, events_created = sweep_expired_deadlines()
                incident = AlertIncident.objects.get(
                    profile=profile,
                    deadline_generation=profile.deadline_generation,
                )

        result = {
            "database_vendor": connection.vendor,
            "owner_email": OWNER_EMAIL,
            "guardian_email": GUARDIAN_EMAIL,
            "mode": options["mode"],
            "removed_aggregate_count": len(removed_aggregate_ids),
            "profile_id": str(profile.id) if profile else None,
            "membership_id": str(membership.id) if membership else None,
            "invitation_id": str(invitation.id) if invitation else None,
            "incident_id": str(incident.id) if incident else None,
            "incident_status": incident.status if incident else None,
            "incidents_created": incidents_created,
            "outbox_events_created": events_created,
        }
        self.stdout.write(json.dumps(result, sort_keys=True))
