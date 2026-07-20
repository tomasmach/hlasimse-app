import hashlib
import secrets
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import IntegrityError, connection, transaction
from django.db.models import Exists, OuterRef, Q
from django.utils import timezone

from .audit import record_audit_event
from .models import (
    AlertIncident,
    AlertRecipient,
    CheckIn,
    CheckInProfile,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
)

MAX_PROFILES_PER_USER = 5
MAX_GUARDIANS_PER_PROFILE = 5
MAX_PENDING_INVITATIONS_PER_PROFILE = 10


@dataclass(frozen=True)
class CheckInResult:
    check_in: CheckIn
    profile: CheckInProfile
    created: bool


@dataclass(frozen=True)
class ProfileArchiveResult:
    profile: CheckInProfile
    archived: bool
    blocking_incident: AlertIncident | None = None


def create_profile(
    *,
    owner,
    name: str,
    interval_seconds: int,
    enabled: bool = True,
    is_paused: bool = False,
    paused_until=None,
) -> CheckInProfile:
    now = timezone.now()
    if paused_until is not None and not is_paused:
        raise ValidationError(
            {"paused_until": "Čas obnovení lze nastavit jen u pozastaveného profilu."}
        )
    if paused_until is not None and paused_until <= now:
        raise ValidationError({"paused_until": "Čas obnovení musí být v budoucnosti."})
    with transaction.atomic():
        get_user_model().objects.select_for_update().get(pk=owner.pk)
        if (
            CheckInProfile.objects.filter(owner=owner, archived_at__isnull=True).count()
            >= MAX_PROFILES_PER_USER
        ):
            raise ValidationError({"profiles": "Každý účet může mít nejvýše 5 profilů."})
        profile = CheckInProfile(
            owner=owner,
            name=name,
            interval_seconds=interval_seconds,
            enabled=enabled,
            is_paused=is_paused,
            paused_until=paused_until,
            next_deadline_at=(
                now + timedelta(seconds=interval_seconds) if enabled and not is_paused else None
            ),
            deadline_generation=1,
        )
        profile.full_clean()
        profile.save()
        record_audit_event(
            event_type="profile.created",
            aggregate_type="check_in_profile",
            aggregate_id=profile.id,
            actor=owner,
            metadata={
                "enabled": profile.enabled,
                "is_paused": profile.is_paused,
                "interval_seconds": profile.interval_seconds,
                "deadline_generation": profile.deadline_generation,
            },
        )
        return profile


def _recipient_payload(incident: AlertIncident) -> dict[str, list[str]]:
    recipients = list(
        incident.recipients.order_by("created_at").values_list("user_id_snapshot", flat=True)
    )
    return {"recipient_user_ids": [str(user_id) for user_id in recipients]}


def _materialize_due_incident_locked(
    *, profile: CheckInProfile, now, actor=None
) -> tuple[AlertIncident | None, bool, bool]:
    """Materialize the current missed generation while the profile row is locked."""
    if (
        not profile.enabled
        or profile.is_paused
        or profile.next_deadline_at is None
        or profile.next_deadline_at > now
    ):
        return None, False, False

    existing_open = AlertIncident.objects.filter(
        profile=profile,
        status=AlertIncident.Status.OPEN,
    ).first()
    if (
        existing_open is not None
        and existing_open.deadline_generation != profile.deadline_generation
    ):
        return existing_open, False, False

    incident, created = AlertIncident.objects.get_or_create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        defaults={"deadline_at": profile.next_deadline_at, "opened_at": now},
    )
    if created:
        guardian_ids = list(
            GuardianMembership.objects.filter(
                profile=profile,
                status=GuardianMembership.Status.ACTIVE,
            )
            .order_by("created_at")
            .values_list("guardian_id", flat=True)
        )
        AlertRecipient.objects.bulk_create(
            [
                AlertRecipient(
                    incident=incident,
                    user_id=guardian_id,
                    user_id_snapshot=guardian_id,
                )
                for guardian_id in guardian_ids
            ]
        )
        record_audit_event(
            event_type="incident.opened",
            aggregate_type="alert_incident",
            aggregate_id=incident.id,
            actor=actor,
            metadata={
                "profile_id": str(profile.id),
                "deadline_generation": profile.deadline_generation,
                "recipient_count": len(guardian_ids),
            },
        )
    _, event_created = OutboxEvent.objects.get_or_create(
        deduplication_key=f"alert-opened:{profile.id}:{profile.deadline_generation}",
        defaults={
            "event_type": "alert.opened",
            "aggregate_type": "alert_incident",
            "aggregate_id": incident.id,
            "payload": {
                "incident_id": str(incident.id),
                "profile_id": str(profile.id),
                "deadline_generation": profile.deadline_generation,
                **_recipient_payload(incident),
            },
        },
    )
    return incident, created, event_created


def _resume_expired_pause_locked(*, profile: CheckInProfile, now) -> bool:
    if not profile.is_paused or profile.paused_until is None or profile.paused_until > now:
        return False
    profile.is_paused = False
    profile.paused_until = None
    profile.deadline_generation += 1
    profile.next_deadline_at = (
        now + timedelta(seconds=profile.interval_seconds) if profile.enabled else None
    )
    profile.save(
        update_fields=[
            "is_paused",
            "paused_until",
            "deadline_generation",
            "next_deadline_at",
            "updated_at",
        ]
    )
    record_audit_event(
        event_type="profile.resumed",
        aggregate_type="check_in_profile",
        aggregate_id=profile.id,
        metadata={
            "automatic": True,
            "deadline_generation": profile.deadline_generation,
        },
    )
    return True


def update_profile(*, profile: CheckInProfile, values: dict) -> CheckInProfile:
    with transaction.atomic():
        locked = CheckInProfile.objects.select_for_update().get(pk=profile.pk)
        if locked.archived_at is not None:
            raise ValidationError({"profile": "Archivovaný profil nelze upravit."})
        now = timezone.now()
        _resume_expired_pause_locked(profile=locked, now=now)
        _materialize_due_incident_locked(profile=locked, now=now, actor=locked.owner)

        actual_changed_fields = {
            field for field, value in values.items() if value != getattr(locked, field)
        }
        interval_changed = (
            "interval_seconds" in values and values["interval_seconds"] != locked.interval_seconds
        )
        enabled_changed = "enabled" in values and values["enabled"] != locked.enabled
        pause_changed = "is_paused" in values and values["is_paused"] != locked.is_paused

        target_is_paused = values.get("is_paused", locked.is_paused)
        if "is_paused" in values and not target_is_paused and "paused_until" not in values:
            values["paused_until"] = None
        target_paused_until = values.get("paused_until", locked.paused_until)
        if target_paused_until is not None and not target_is_paused:
            raise ValidationError(
                {"paused_until": "Čas obnovení lze nastavit jen u pozastaveného profilu."}
            )
        if target_paused_until is not None and target_paused_until <= now:
            raise ValidationError({"paused_until": "Čas obnovení musí být v budoucnosti."})

        for field, value in values.items():
            setattr(locked, field, value)
        if interval_changed or enabled_changed or pause_changed:
            locked.deadline_generation += 1
            locked.next_deadline_at = (
                now + timedelta(seconds=locked.interval_seconds)
                if locked.enabled and not locked.is_paused
                else None
            )
        locked.full_clean()
        locked.save()
        changed_fields = sorted(actual_changed_fields)
        if pause_changed:
            record_audit_event(
                event_type="profile.paused" if locked.is_paused else "profile.resumed",
                aggregate_type="check_in_profile",
                aggregate_id=locked.id,
                actor=locked.owner,
                metadata={
                    "automatic": False,
                    "deadline_generation": locked.deadline_generation,
                    "has_scheduled_resume": locked.paused_until is not None,
                },
            )
        non_pause_fields = [
            field for field in changed_fields if field not in {"is_paused", "paused_until"}
        ]
        if non_pause_fields:
            record_audit_event(
                event_type="profile.updated",
                aggregate_type="check_in_profile",
                aggregate_id=locked.id,
                actor=locked.owner,
                metadata={
                    "changed_fields": non_pause_fields,
                    "deadline_generation": locked.deadline_generation,
                },
            )
        return locked


def perform_check_in(
    *,
    profile: CheckInProfile,
    idempotency_key: str,
    client_recorded_at=None,
    latitude: Decimal | None = None,
    longitude: Decimal | None = None,
    location_accuracy_meters: Decimal | None = None,
    submitted_from_queue: bool = False,
) -> CheckInResult:
    with transaction.atomic():
        locked = CheckInProfile.objects.select_for_update().get(pk=profile.pk)
        existing = CheckIn.objects.filter(profile=locked, idempotency_key=idempotency_key).first()
        if existing:
            return CheckInResult(existing, locked, False)
        now = timezone.now()
        if locked.archived_at is not None:
            raise ValidationError({"profile": "Archivovaný profil nepřijímá ohlášení."})
        _resume_expired_pause_locked(profile=locked, now=now)
        if not locked.enabled:
            raise ValidationError({"profile": "Kontrolní profil není aktivní."})

        _materialize_due_incident_locked(profile=locked, now=now, actor=locked.owner)

        locked.deadline_generation += 1
        locked.last_checked_in_at = now
        locked.next_deadline_at = (
            None if locked.is_paused else now + timedelta(seconds=locked.interval_seconds)
        )
        locked.save(
            update_fields=[
                "deadline_generation",
                "last_checked_in_at",
                "next_deadline_at",
                "updated_at",
            ]
        )
        try:
            with transaction.atomic():
                check_in = CheckIn.objects.create(
                    profile=locked,
                    idempotency_key=idempotency_key,
                    accepted_at=now,
                    client_recorded_at=client_recorded_at,
                    latitude=latitude,
                    longitude=longitude,
                    location_accuracy_meters=location_accuracy_meters,
                    deadline_generation=locked.deadline_generation,
                    response_deadline_at=locked.next_deadline_at,
                    submitted_from_queue=submitted_from_queue,
                )
        except IntegrityError:
            check_in = CheckIn.objects.get(profile=locked, idempotency_key=idempotency_key)
            return CheckInResult(check_in, locked, False)

        open_incidents = list(
            AlertIncident.objects.select_for_update().filter(
                profile=locked, status=AlertIncident.Status.OPEN
            )
        )
        for incident in open_incidents:
            incident.status = AlertIncident.Status.RESOLVED
            incident.resolved_at = now
            incident.resolved_by_check_in = check_in
            incident.save(
                update_fields=[
                    "status",
                    "resolved_at",
                    "resolved_by_check_in",
                    "updated_at",
                ]
            )
            record_audit_event(
                event_type="incident.resolved",
                aggregate_type="alert_incident",
                aggregate_id=incident.id,
                actor=locked.owner,
                metadata={
                    "profile_id": str(locked.id),
                    "check_in_id": str(check_in.id),
                    "resolution": "confirmed_check_in",
                },
            )
            OutboxEvent.objects.get_or_create(
                deduplication_key=f"alert-resolved:{incident.id}",
                defaults={
                    "event_type": "alert.resolved",
                    "aggregate_type": "alert_incident",
                    "aggregate_id": incident.id,
                    "payload": {
                        "incident_id": str(incident.id),
                        "profile_id": str(locked.id),
                        "check_in_id": str(check_in.id),
                        **_recipient_payload(incident),
                    },
                },
            )
        OutboxEvent.objects.get_or_create(
            deduplication_key=f"checkin:{check_in.id}",
            defaults={
                "event_type": "checkin.accepted",
                "aggregate_type": "check_in",
                "aggregate_id": check_in.id,
                "payload": {
                    "check_in_id": str(check_in.id),
                    "profile_id": str(locked.id),
                    "deadline_generation": locked.deadline_generation,
                    "next_deadline_at": (
                        locked.next_deadline_at.isoformat() if locked.next_deadline_at else None
                    ),
                },
            },
        )
        record_audit_event(
            event_type="checkin.confirmed",
            aggregate_type="check_in",
            aggregate_id=check_in.id,
            actor=locked.owner,
            metadata={
                "profile_id": str(locked.id),
                "deadline_generation": locked.deadline_generation,
                "resolved_incident_count": len(open_incidents),
                "has_optional_position": latitude is not None,
                "submitted_from_queue": submitted_from_queue,
            },
        )
        return CheckInResult(check_in, locked, True)


def archive_profile(*, profile: CheckInProfile, actor) -> ProfileArchiveResult:
    """Make a profile inert while retaining all safety and audit history.

    A due generation is materialized before deciding whether archival is safe. The
    result object (rather than an exception) lets that incident commit before the
    caller returns a conflict response.
    """
    with transaction.atomic():
        locked = CheckInProfile.objects.select_for_update().get(pk=profile.pk)
        if locked.owner_id != actor.id or locked.archived_at is not None:
            raise PermissionDenied("Profil není dostupný.")
        now = timezone.now()
        _resume_expired_pause_locked(profile=locked, now=now)
        _materialize_due_incident_locked(profile=locked, now=now, actor=actor)
        blocking_incident = (
            AlertIncident.objects.select_for_update()
            .filter(profile=locked, status=AlertIncident.Status.OPEN)
            .first()
        )
        if blocking_incident is not None:
            return ProfileArchiveResult(
                profile=locked,
                archived=False,
                blocking_incident=blocking_incident,
            )

        locked.archived_at = now
        locked.enabled = False
        locked.is_paused = True
        locked.paused_until = None
        locked.next_deadline_at = None
        locked.deadline_generation += 1
        locked.full_clean()
        locked.save(
            update_fields=[
                "archived_at",
                "enabled",
                "is_paused",
                "paused_until",
                "next_deadline_at",
                "deadline_generation",
                "updated_at",
            ]
        )
        revoked_memberships = GuardianMembership.objects.filter(
            profile=locked,
            status=GuardianMembership.Status.ACTIVE,
        ).update(status=GuardianMembership.Status.REVOKED, updated_at=now)
        revoked_invitations = GuardianInvitation.objects.filter(
            profile=locked,
            status=GuardianInvitation.Status.PENDING,
        ).update(status=GuardianInvitation.Status.REVOKED, updated_at=now)
        record_audit_event(
            event_type="profile.archived",
            aggregate_type="check_in_profile",
            aggregate_id=locked.id,
            actor=actor,
            metadata={
                "deadline_generation": locked.deadline_generation,
                "revoked_membership_count": revoked_memberships,
                "revoked_invitation_count": revoked_invitations,
            },
        )
        return ProfileArchiveResult(profile=locked, archived=True)


def create_invitation(
    *, profile: CheckInProfile, invited_by, email: str
) -> tuple[GuardianInvitation, str]:
    if invited_by.email_verified_at is None:
        raise PermissionDenied("Před pozváním strážce je nutné ověřit e-mail.")
    normalized_email = email.strip().lower()
    if normalized_email == invited_by.email.lower():
        raise ValidationError({"email": "Vlastník profilu nemůže být jeho strážcem."})
    raw_token = secrets.token_urlsafe(32)
    digest = hashlib.sha256(raw_token.encode()).hexdigest()
    with transaction.atomic():
        locked_profile = CheckInProfile.objects.select_for_update().get(pk=profile.pk)
        if locked_profile.archived_at is not None:
            raise ValidationError({"profile": "Archivovaný profil nepřijímá pozvánky."})
        now = timezone.now()
        GuardianInvitation.objects.filter(
            profile=profile,
            status=GuardianInvitation.Status.PENDING,
            expires_at__lte=now,
        ).update(status=GuardianInvitation.Status.EXPIRED, updated_at=now)
        if GuardianInvitation.objects.filter(
            profile=profile,
            normalized_email=normalized_email,
            status=GuardianInvitation.Status.PENDING,
        ).exists():
            raise ValidationError({"email": "Pro tento e-mail už čeká platná pozvánka."})
        if (
            GuardianInvitation.objects.filter(
                profile=profile,
                status=GuardianInvitation.Status.PENDING,
            ).count()
            >= MAX_PENDING_INVITATIONS_PER_PROFILE
        ):
            raise ValidationError(
                {"invitations": "Profil může mít nejvýše 10 čekajících pozvánek."}
            )
        try:
            with transaction.atomic():
                invitation = GuardianInvitation.objects.create(
                    profile=profile,
                    invited_by=invited_by,
                    email=normalized_email,
                    token_digest=digest,
                    expires_at=now + timedelta(days=7),
                )
        except IntegrityError as exc:
            raise ValidationError({"email": "Pro tento e-mail už čeká platná pozvánka."}) from exc
        OutboxEvent.objects.create(
            event_type="guardian.invited",
            aggregate_type="guardian_invitation",
            aggregate_id=invitation.id,
            deduplication_key=f"guardian-invitation:{invitation.id}",
            payload={"invitation_id": str(invitation.id)},
        )
        record_audit_event(
            event_type="guardian.invitation_created",
            aggregate_type="guardian_invitation",
            aggregate_id=invitation.id,
            actor=invited_by,
            metadata={"profile_id": str(profile.id), "expires_in_days": 7},
        )
    return invitation, raw_token


def accept_invitation(*, raw_token: str, user) -> GuardianMembership:
    if user.email_verified_at is None:
        raise PermissionDenied("Před přijetím pozvánky je nutné ověřit e-mail.")
    digest = hashlib.sha256(raw_token.encode()).hexdigest()
    with transaction.atomic():
        invitation_ref = (
            GuardianInvitation.objects.filter(token_digest=digest)
            .values("id", "profile_id")
            .first()
        )
        if invitation_ref is None:
            raise ValidationError({"token": "Pozvánka neexistuje."})
        locked_profile = CheckInProfile.objects.select_for_update().get(
            pk=invitation_ref["profile_id"]
        )
        if locked_profile.archived_at is not None:
            raise ValidationError({"token": "Pozvánka už není platná."})
        invitation = GuardianInvitation.objects.select_for_update().get(pk=invitation_ref["id"])
        if invitation.normalized_email != user.email.lower():
            raise PermissionDenied("Pozvánka patří jinému e-mailu.")
        return _accept_invitation_locked(invitation=invitation, user=user, error_field="token")


def _accept_invitation_locked(
    *, invitation: GuardianInvitation, user, error_field: str
) -> GuardianMembership:
    if invitation.status != GuardianInvitation.Status.PENDING:
        if invitation.accepted_by_id == user.id:
            return GuardianMembership.objects.get(profile=invitation.profile, guardian=user)
        raise ValidationError({error_field: "Pozvánka už není platná."})
    if invitation.expires_at <= timezone.now():
        invitation.status = GuardianInvitation.Status.EXPIRED
        invitation.save(update_fields=["status", "updated_at"])
        raise ValidationError({error_field: "Pozvánka vypršela."})
    if invitation.profile.owner_id == user.id:
        raise ValidationError({error_field: "Vlastník nemůže přijmout vlastní pozvánku."})

    membership = GuardianMembership.objects.filter(
        profile=invitation.profile, guardian=user
    ).first()
    activating = membership is None or membership.status != GuardianMembership.Status.ACTIVE
    if (
        activating
        and GuardianMembership.objects.filter(
            profile=invitation.profile,
            status=GuardianMembership.Status.ACTIVE,
        ).count()
        >= MAX_GUARDIANS_PER_PROFILE
    ):
        raise ValidationError({"guardians": "Profil může mít nejvýše 5 strážců."})
    if membership is None:
        membership = GuardianMembership.objects.create(
            profile=invitation.profile,
            guardian=user,
            status=GuardianMembership.Status.ACTIVE,
        )
    elif membership.status != GuardianMembership.Status.ACTIVE:
        membership.status = GuardianMembership.Status.ACTIVE
        membership.save(update_fields=["status", "updated_at"])
    invitation.status = GuardianInvitation.Status.ACCEPTED
    invitation.accepted_by = user
    invitation.save(update_fields=["status", "accepted_by", "updated_at"])
    record_audit_event(
        event_type="guardian.invitation_accepted",
        aggregate_type="guardian_invitation",
        aggregate_id=invitation.id,
        actor=user,
        metadata={
            "profile_id": str(invitation.profile_id),
            "membership_id": str(membership.id),
        },
    )
    return membership


def respond_to_invitation(*, invitation_id, user, decision: str):
    """Accept or decline a received invitation without exposing its bearer token."""
    if user.email_verified_at is None:
        raise PermissionDenied("Před odpovědí na pozvánku je nutné ověřit e-mail.")
    if decision not in {"accept", "decline"}:
        raise ValidationError({"decision": "Neplatná odpověď na pozvánku."})
    with transaction.atomic():
        invitation_ref = (
            GuardianInvitation.objects.filter(
                pk=invitation_id,
                normalized_email=user.email.strip().lower(),
            )
            .values("id", "profile_id")
            .first()
        )
        if invitation_ref is None:
            raise PermissionDenied("Pozvánka není dostupná.")
        locked_profile = CheckInProfile.objects.select_for_update().get(
            pk=invitation_ref["profile_id"]
        )
        if locked_profile.archived_at is not None:
            raise ValidationError({"invitation": "Pozvánka už není platná."})
        invitation = GuardianInvitation.objects.select_for_update().get(pk=invitation_ref["id"])
        if decision == "accept":
            return invitation, _accept_invitation_locked(
                invitation=invitation,
                user=user,
                error_field="invitation",
            )
        if invitation.status != GuardianInvitation.Status.PENDING:
            raise ValidationError({"invitation": "Pozvánka už není platná."})
        if invitation.expires_at <= timezone.now():
            invitation.status = GuardianInvitation.Status.EXPIRED
            invitation.save(update_fields=["status", "updated_at"])
            raise ValidationError({"invitation": "Pozvánka vypršela."})
        invitation.status = GuardianInvitation.Status.REVOKED
        invitation.save(update_fields=["status", "updated_at"])
        record_audit_event(
            event_type="guardian.invitation_declined",
            aggregate_type="guardian_invitation",
            aggregate_id=invitation.id,
            actor=user,
            metadata={"profile_id": str(invitation.profile_id)},
        )
        return invitation, None


def revoke_guardian_membership(*, membership: GuardianMembership, actor) -> bool:
    with transaction.atomic():
        CheckInProfile.objects.select_for_update().get(pk=membership.profile_id)
        locked = GuardianMembership.objects.select_for_update().get(pk=membership.pk)
        if locked.status == GuardianMembership.Status.REVOKED:
            return False
        locked.status = GuardianMembership.Status.REVOKED
        locked.save(update_fields=["status", "updated_at"])
        record_audit_event(
            event_type="guardian.membership_revoked",
            aggregate_type="guardian_membership",
            aggregate_id=locked.id,
            actor=actor,
            metadata={
                "profile_id": str(locked.profile_id),
                "self_revoked": actor.id == locked.guardian_id,
            },
        )
        return True


def deactivate_push_device(*, device: PushDevice, actor) -> bool:
    with transaction.atomic():
        locked = PushDevice.objects.select_for_update().get(pk=device.pk)
        if not locked.active:
            return False
        locked.active = False
        locked.save(update_fields=["active", "updated_at"])
        record_audit_event(
            event_type="device.deactivated",
            aggregate_type="push_device",
            aggregate_id=locked.id,
            actor=actor,
            metadata={"platform": locked.platform},
        )
        return True


def sweep_expired_deadlines(*, now=None, limit: int = 500) -> tuple[int, int]:
    now = now or timezone.now()
    paused_ids = list(
        CheckInProfile.objects.filter(
            archived_at__isnull=True,
            is_paused=True,
            paused_until__isnull=False,
            paused_until__lte=now,
        )
        .order_by("paused_until")
        .values_list("id", flat=True)[:limit]
    )
    for profile_id in paused_ids:
        with transaction.atomic():
            profile = CheckInProfile.objects.select_for_update().get(pk=profile_id)
            _resume_expired_pause_locked(profile=profile, now=now)

    already_materialized = AlertIncident.objects.filter(
        profile_id=OuterRef("pk"), deadline_generation=OuterRef("deadline_generation")
    )
    profile_ids = list(
        CheckInProfile.objects.filter(
            archived_at__isnull=True,
            enabled=True,
            is_paused=False,
            next_deadline_at__isnull=False,
            next_deadline_at__lte=now,
        )
        .annotate(generation_materialized=Exists(already_materialized))
        .filter(generation_materialized=False)
        .order_by("next_deadline_at")
        .values_list("id", flat=True)[:limit]
    )
    incidents_created = 0
    events_created = 0
    for profile_id in profile_ids:
        with transaction.atomic():
            queryset = CheckInProfile.objects.select_for_update(
                skip_locked=connection.vendor == "postgresql"
            )
            profile = queryset.filter(pk=profile_id).first()
            if (
                profile is None
                or not profile.enabled
                or profile.is_paused
                or profile.next_deadline_at is None
                or profile.next_deadline_at > now
            ):
                continue
            _, created, event_created = _materialize_due_incident_locked(profile=profile, now=now)
            events_created += int(event_created)
            incidents_created += int(created)
    return incidents_created, events_created


def can_access_incident(user, incident: AlertIncident) -> bool:
    return incident.profile.owner_id == user.id or (
        incident.recipients.filter(user_id=user.id).exists()
        and GuardianMembership.objects.filter(
            profile=incident.profile,
            guardian=user,
            status=GuardianMembership.Status.ACTIVE,
        ).exists()
    )


def can_acknowledge_incident(user, incident: AlertIncident) -> bool:
    if incident.status != AlertIncident.Status.OPEN or incident.profile.owner_id == user.id:
        return False
    return (
        incident.recipients.filter(user_id=user.id).exists()
        and GuardianMembership.objects.filter(
            profile=incident.profile,
            guardian=user,
            status=GuardianMembership.Status.ACTIVE,
        ).exists()
    )


def accessible_incidents(user):
    return AlertIncident.objects.filter(
        Q(profile__owner=user)
        | Q(
            recipients__user=user,
            profile__guardians__guardian=user,
            profile__guardians__status=GuardianMembership.Status.ACTIVE,
        )
    ).distinct()
