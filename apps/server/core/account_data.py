import uuid

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .audit import record_audit_event
from .models import (
    AlertAcknowledgement,
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


ACCOUNT_ERASURE_ALERT_EVENT_TYPES = ("alert.opened", "alert.resolved", "alert.retry")


def build_account_export(user) -> dict:
    """Build a complete subject export without credentials or provider tokens."""
    profiles = list(CheckInProfile.objects.filter(owner=user).order_by("created_at"))
    profile_ids = [profile.id for profile in profiles]
    return {
        "schema_version": 1,
        "exported_at": timezone.now(),
        "account": {
            "id": user.id,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "date_joined": user.date_joined,
            "terms_accepted_at": user.terms_accepted_at,
            "terms_version": user.terms_version,
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
                "archived_at": profile.archived_at,
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
                "submitted_from_queue": check_in.submitted_from_queue,
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
        "alert_acknowledgements": [
            {
                "id": acknowledgement.id,
                "incident_id": acknowledgement.incident_id,
                "user_id": acknowledgement.user_id_snapshot,
                "acknowledged_at": acknowledgement.acknowledged_at,
            }
            for acknowledgement in AlertAcknowledgement.objects.filter(user=user).order_by(
                "acknowledged_at", "id"
            )
        ],
        "push_devices": list(
            PushDevice.objects.filter(user=user)
            .order_by("created_at")
            .values("id", "installation_id", "platform", "active", "last_seen_at")
        ),
    }


def delete_account_safely(*, user_id, password: str) -> None:
    """Erase an account while retaining anonymized third-party incident audit.

    Owners cannot erase the source of truth for an open incident. A guardian can
    leave an open incident because recipient, acknowledgement, and delivery records
    are tombstoned without changing that incident or its remaining recipients.
    """
    with transaction.atomic():
        # Safety operations acquire profile rows before they write audit rows that
        # reference the user. Keep account erasure in the same lock order: the
        # profile locks below serialize check-ins, and the final user deletion
        # acquires the user row only after those operations have completed.
        user = User.objects.get(pk=user_id)
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
            profile__owner=user,
            status=AlertIncident.Status.OPEN,
        ).values_list("id", flat=True)
        has_open_incident = (
            AlertIncident.objects.select_for_update()
            .filter(pk__in=owned_open_incident_ids)
            .exists()
        )
        if has_open_incident:
            raise AccountDeletionBlocked(
                "Účet nelze odstranit, dokud některý z vašich profilů má aktivní incident. "
                "Nejprve jej bezpečně vyřešte potvrzeným check-inem."
            )

        profile_ids = list(CheckInProfile.objects.filter(owner=user).values_list("id", flat=True))
        check_in_ids = list(
            CheckIn.objects.filter(profile_id__in=profile_ids).values_list("id", flat=True)
        )
        incident_ids = list(
            AlertIncident.objects.filter(profile_id__in=profile_ids).values_list("id", flat=True)
        )
        device_ids = list(PushDevice.objects.filter(user=user).values_list("id", flat=True))
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
            event_type__in=ACCOUNT_ERASURE_ALERT_EVENT_TYPES,
            aggregate_id__in=recipient_incident_ids,
        ):
            payload = dict(event.payload)
            recipients = payload.get("recipient_user_ids")
            if isinstance(recipients, list) and str(user.id) in recipients:
                remaining_recipient_ids = [
                    recipient for recipient in recipients if recipient != str(user.id)
                ]
                payload["recipient_user_ids"] = remaining_recipient_ids
                event.payload = payload
                update_fields = ["payload", "updated_at"]
                if not remaining_recipient_ids and event.status != OutboxEvent.Status.PROCESSED:
                    event.status = OutboxEvent.Status.PROCESSED
                    event.processed_at = timezone.now()
                    event.locked_at = None
                    event.last_error = "No recipient remains after account erasure"
                    update_fields.extend(["status", "processed_at", "locked_at", "last_error"])
                event.save(update_fields=update_fields)
        for recipient in recipient_rows:
            recipient.user = None
            recipient.user_id_snapshot = uuid.uuid4()
            recipient.save(update_fields=["user", "user_id_snapshot", "updated_at"])

        acknowledgement_rows = list(
            AlertAcknowledgement.objects.select_for_update().filter(user=user)
        )
        for acknowledgement in acknowledgement_rows:
            acknowledgement.user = None
            acknowledgement.user_id_snapshot = uuid.uuid4()
            acknowledgement.save(update_fields=["user", "user_id_snapshot", "updated_at"])

        # Legacy attempts can have no device snapshot. Capture their row IDs while
        # the live device relation still exists; the final query also discovers any
        # concurrent modern attempt by its immutable device snapshot.
        third_party_attempt_ids = list(
            DeliveryAttempt.objects.select_for_update()
            .filter(Q(device_id_snapshot__in=device_ids) | Q(device_id__in=device_ids))
            .exclude(incident_id__in=incident_ids)
            .values_list("id", flat=True)
        )

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
        for device in PushDevice.objects.filter(user=user, active=True).only("id", "platform"):
            record_audit_event(
                event_type="device.deactivated",
                aggregate_type="push_device",
                aggregate_id=device.id,
                actor=user,
                metadata={"platform": device.platform, "account_deletion": True},
            )
        PushDevice.objects.filter(user=user).update(active=False)
        record_audit_event(
            event_type="account.deleted",
            aggregate_type="account",
            aggregate_id=user.id,
            actor=user,
            metadata={"method": "self_service"},
        )
        user.delete()

        # The user deletion removes devices and can serialize behind an in-flight
        # delivery-attempt insert. Replace every matching row afterwards instead of
        # updating it in place: a worker holding a stale model instance can no longer
        # restore a provider ticket or response after this transaction commits.
        attempts_to_tombstone = list(
            DeliveryAttempt.objects.select_for_update()
            .filter(
                Q(id__in=third_party_attempt_ids)
                | Q(device_id_snapshot__in=device_ids)
                | Q(device_id__in=device_ids),
            )
            .exclude(incident_id__in=incident_ids)
        )
        for attempt in attempts_to_tombstone:
            original_created_at = attempt.created_at
            tombstone_values = {
                "incident_id": attempt.incident_id,
                "outbox_event_id": attempt.outbox_event_id,
                "device": None,
                "device_id_snapshot": None,
                "destination_token_hash": "",
                "platform_snapshot": attempt.platform_snapshot,
                "attempt_number": attempt.attempt_number,
                "status": attempt.status,
                "expo_ticket_id": "",
                "response_data": {},
                "next_retry_at": None,
                "account_erasure_tombstone": True,
            }
            attempt.delete()
            tombstone = DeliveryAttempt.objects.create(**tombstone_values)
            DeliveryAttempt.objects.filter(pk=tombstone.pk).update(created_at=original_created_at)
