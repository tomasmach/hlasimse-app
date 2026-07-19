import uuid

from django.db import transaction

from .models import (
    AlertIncident,
    AlertRecipient,
    CheckIn,
    CheckInProfile,
    DeliveryAttempt,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    PushDevice,
    User,
)


class AccountDeletionBlocked(Exception):
    pass


class AccountPasswordInvalid(Exception):
    pass


def build_account_export(user) -> dict:
    """Build a complete subject export without credentials or provider tokens."""
    profiles = list(CheckInProfile.objects.filter(owner=user).order_by("created_at"))
    profile_ids = [profile.id for profile in profiles]
    return {
        "schema_version": 1,
        "account": {
            "id": user.id,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "date_joined": user.date_joined,
        },
        "profiles": [
            {
                "id": profile.id,
                "name": profile.name,
                "interval_seconds": profile.interval_seconds,
                "enabled": profile.enabled,
                "is_paused": profile.is_paused,
                "paused_until": profile.paused_until,
                "last_checked_in_at": profile.last_checked_in_at,
                "next_deadline_at": profile.next_deadline_at,
                "deadline_generation": profile.deadline_generation,
                "created_at": profile.created_at,
                "updated_at": profile.updated_at,
            }
            for profile in profiles
        ],
        "check_ins": [
            {
                "id": check_in.id,
                "profile_id": check_in.profile_id,
                "accepted_at": check_in.accepted_at,
                "client_recorded_at": check_in.client_recorded_at,
                "latitude": str(check_in.latitude) if check_in.latitude is not None else None,
                "longitude": str(check_in.longitude) if check_in.longitude is not None else None,
                "location_accuracy_meters": (
                    str(check_in.location_accuracy_meters)
                    if check_in.location_accuracy_meters is not None
                    else None
                ),
                "deadline_generation": check_in.deadline_generation,
                "response_deadline_at": check_in.response_deadline_at,
            }
            for check_in in CheckIn.objects.filter(profile_id__in=profile_ids).order_by(
                "accepted_at"
            )
        ],
        "owned_guardian_memberships": list(
            GuardianMembership.objects.filter(profile_id__in=profile_ids)
            .order_by("created_at")
            .values(
                "id",
                "profile_id",
                "guardian__email",
                "status",
                "created_at",
                "updated_at",
            )
        ),
        "watched_memberships": list(
            GuardianMembership.objects.filter(guardian=user)
            .order_by("created_at")
            .values(
                "id",
                "profile_id",
                "profile__name",
                "profile__owner__first_name",
                "profile__owner__last_name",
                "status",
                "created_at",
                "updated_at",
            )
        ),
        "sent_invitations": list(
            GuardianInvitation.objects.filter(profile_id__in=profile_ids)
            .order_by("created_at")
            .values(
                "id",
                "profile_id",
                "email",
                "status",
                "expires_at",
                "created_at",
                "updated_at",
            )
        ),
        "received_invitations": list(
            GuardianInvitation.objects.filter(normalized_email=user.email.strip().lower())
            .order_by("created_at")
            .values(
                "id",
                "profile_id",
                "profile__name",
                "status",
                "expires_at",
                "created_at",
                "updated_at",
            )
        ),
        "owned_incidents": list(
            AlertIncident.objects.filter(profile_id__in=profile_ids)
            .order_by("opened_at")
            .values(
                "id",
                "profile_id",
                "deadline_generation",
                "deadline_at",
                "opened_at",
                "resolved_at",
                "status",
                "resolved_by_check_in_id",
            )
        ),
        "received_incidents": list(
            AlertIncident.objects.filter(recipients__user=user)
            .exclude(profile_id__in=profile_ids)
            .distinct()
            .order_by("opened_at")
            .values(
                "id",
                "profile_id",
                "deadline_at",
                "opened_at",
                "resolved_at",
                "status",
            )
        ),
        "push_devices": list(
            PushDevice.objects.filter(user=user)
            .order_by("created_at")
            .values("id", "installation_id", "platform", "active", "last_seen_at")
        ),
    }


def delete_account_safely(*, user_id, password: str) -> None:
    """Erase an account while retaining anonymized closed third-party incident audit.

    The schema cannot preserve guardian acknowledgement identity after erasure and has
    no reliable channel for a final guardian notification. Deletion is therefore
    blocked whenever the account participates in an open incident.
    """
    with transaction.atomic():
        user = User.objects.select_for_update().get(pk=user_id)
        if not user.check_password(password):
            raise AccountPasswordInvalid
        involved_profile_ids = set(
            GuardianMembership.objects.filter(guardian=user).values_list("profile_id", flat=True)
        )
        involved_profile_ids.update(
            CheckInProfile.objects.filter(owner=user).values_list("id", flat=True)
        )
        involved_profile_ids.update(
            AlertRecipient.objects.filter(user=user).values_list("incident__profile_id", flat=True)
        )
        # Incident creation locks its profile first. Holding every involved profile
        # closes the race between the open-incident check and account erasure.
        list(
            CheckInProfile.objects.select_for_update()
            .filter(pk__in=involved_profile_ids)
            .order_by("pk")
            .values_list("pk", flat=True)
        )
        owned_open_incident_ids = AlertIncident.objects.filter(
            profile_id__in=involved_profile_ids,
            profile__owner=user,
            status=AlertIncident.Status.OPEN,
        ).values_list("id", flat=True)
        received_open_incident_ids = AlertRecipient.objects.filter(
            user=user,
            incident__status=AlertIncident.Status.OPEN,
        ).values_list("incident_id", flat=True)
        open_incident_ids = set(owned_open_incident_ids) | set(received_open_incident_ids)
        has_open_incident = (
            AlertIncident.objects.select_for_update().filter(pk__in=open_incident_ids).exists()
        )
        if has_open_incident:
            raise AccountDeletionBlocked(
                "Účet nelze odstranit během aktivního incidentu. "
                "Nejprve incident bezpečně vyřešte potvrzeným check-inem."
            )

        profile_ids = list(CheckInProfile.objects.filter(owner=user).values_list("id", flat=True))
        check_in_ids = list(
            CheckIn.objects.filter(profile_id__in=profile_ids).values_list("id", flat=True)
        )
        incident_ids = list(
            AlertIncident.objects.filter(profile_id__in=profile_ids).values_list("id", flat=True)
        )
        invitation_ids = list(
            GuardianInvitation.objects.filter(profile_id__in=profile_ids).values_list(
                "id", flat=True
            )
        )

        # Remove owned delivery audit before deleting the corresponding protected
        # outbox rows. Closed incidents belonging to other owners remain anonymized.
        DeliveryAttempt.objects.filter(incident_id__in=incident_ids).delete()
        OutboxEvent.objects.filter(
            aggregate_id__in=[*profile_ids, *check_in_ids, *incident_ids, *invitation_ids]
        ).delete()

        recipient_rows = list(AlertRecipient.objects.select_for_update().filter(user=user))
        recipient_incident_ids = [row.incident_id for row in recipient_rows]
        for event in OutboxEvent.objects.select_for_update().filter(
            event_type__in=("alert.opened", "alert.resolved"),
            aggregate_id__in=recipient_incident_ids,
        ):
            payload = dict(event.payload)
            recipients = payload.get("recipient_user_ids")
            if isinstance(recipients, list) and str(user.id) in recipients:
                payload["recipient_user_ids"] = [
                    recipient for recipient in recipients if recipient != str(user.id)
                ]
                event.payload = payload
                event.save(update_fields=["payload", "updated_at"])
        for recipient in recipient_rows:
            recipient.user_id_snapshot = uuid.uuid4()
            recipient.save(update_fields=["user_id_snapshot", "updated_at"])

        for invitation in GuardianInvitation.objects.select_for_update().filter(
            normalized_email=user.email.strip().lower()
        ):
            anonymized_email = f"deleted-{uuid.uuid4().hex}@invalid.local"
            invitation.email = anonymized_email
            invitation.normalized_email = anonymized_email
            invitation.accepted_by = None
            if invitation.status == GuardianInvitation.Status.PENDING:
                invitation.status = GuardianInvitation.Status.REVOKED
            invitation.save(
                update_fields=[
                    "email",
                    "normalized_email",
                    "accepted_by",
                    "status",
                    "updated_at",
                ]
            )

        CheckInProfile.objects.filter(owner=user).update(
            enabled=False,
            is_paused=True,
            paused_until=None,
            next_deadline_at=None,
        )
        PushDevice.objects.filter(user=user).update(active=False)
        user.delete()
