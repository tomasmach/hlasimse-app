import json
import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.core.exceptions import ValidationError
from django.core.management import CommandError, call_command
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.audit import record_audit_event
from core.models import (
    AlertIncident,
    AlertRecipient,
    AuditEvent,
    GuardianMembership,
    OutboxEvent,
)
from core.reconciliation import reconcile_domain_state
from core.services import (
    accept_invitation,
    create_invitation,
    create_profile,
    perform_check_in,
    respond_to_invitation,
    revoke_guardian_membership,
    sweep_expired_deadlines,
    update_profile,
)

pytestmark = pytest.mark.django_db


def _codes(report):
    return {issue.code for issue in report.issues}


def test_audit_events_are_safe_immutable_and_rolled_back_with_domain_change(user):
    with pytest.raises(RuntimeError), transaction.atomic():
        profile = create_profile(owner=user, name="Rollback", interval_seconds=3_600)
        assert AuditEvent.objects.filter(aggregate_id=profile.id).exists()
        raise RuntimeError("force rollback")

    assert not user.profiles.filter(name="Rollback").exists()
    assert not AuditEvent.objects.filter(event_type="profile.created").exists()

    profile = create_profile(owner=user, name="Audit", interval_seconds=3_600)
    event = AuditEvent.objects.get(event_type="profile.created", aggregate_id=profile.id)
    assert event.actor == user
    assert "email" not in json.dumps(event.metadata).lower()
    event.metadata = {"enabled": False}
    with pytest.raises(TypeError, match="immutable"):
        event.save()
    with pytest.raises(TypeError, match="immutable"):
        AuditEvent.objects.filter(pk=event.pk).update(metadata={})
    with pytest.raises(ValidationError):
        record_audit_event(
            event_type="unsafe.test",
            aggregate_type="account",
            aggregate_id=user.id,
            metadata={"email": "hidden@example.cz"},
        )
    with pytest.raises(ValidationError):
        record_audit_event(
            event_type="unsafe.test",
            aggregate_type="account",
            aggregate_id=user.id,
            metadata={"provider_reference": "ExponentPushToken[do-not-log]"},
        )


def test_profile_checkin_and_incident_transitions_are_audited(profile, other_user):
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    update_profile(
        profile=profile,
        values={"is_paused": True, "paused_until": timezone.now() + timedelta(hours=2)},
    )
    update_profile(profile=profile, values={"is_paused": False})
    profile.refresh_from_db()
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    result = perform_check_in(profile=profile, idempotency_key="audited-checkin")

    incident = AlertIncident.objects.get(profile=profile)
    assert set(
        AuditEvent.objects.filter(
            aggregate_id__in=[profile.id, result.check_in.id, incident.id]
        ).values_list("event_type", flat=True)
    ) >= {
        "profile.paused",
        "profile.resumed",
        "incident.opened",
        "incident.resolved",
        "checkin.confirmed",
    }
    assert (
        not json.dumps(list(AuditEvent.objects.values_list("metadata", flat=True)))
        .lower()
        .__contains__("latitude")
    )


def test_guardian_lifecycle_is_audited(profile, other_user, user):
    accepted_invitation, accepted_token = create_invitation(
        profile=profile,
        invited_by=user,
        email=other_user.email,
    )
    membership = accept_invitation(raw_token=accepted_token, user=other_user)
    assert revoke_guardian_membership(membership=membership, actor=other_user) is True

    declining_user = type(user).objects.create_user(
        email="decline@example.cz", password="Safely-testing-123"
    )
    declined_invitation, _token = create_invitation(
        profile=profile,
        invited_by=user,
        email=declining_user.email,
    )
    respond_to_invitation(
        invitation_id=declined_invitation.id,
        user=declining_user,
        decision="decline",
    )

    assert set(
        AuditEvent.objects.filter(
            aggregate_id__in=[accepted_invitation.id, declined_invitation.id, membership.id]
        ).values_list("event_type", flat=True)
    ) >= {
        "guardian.invitation_created",
        "guardian.invitation_accepted",
        "guardian.invitation_declined",
        "guardian.membership_revoked",
    }


def test_watched_profile_exposes_only_current_guardians_membership_id(
    api_client, profile, other_user, user
):
    current = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    unrelated_guardian = type(user).objects.create_user(
        email="unrelated-guardian@example.cz", password="Safely-testing-123"
    )
    GuardianMembership.objects.create(profile=profile, guardian=unrelated_guardian)
    api_client.force_authenticate(other_user)

    response = api_client.get("/api/v1/watched-profiles/")

    assert response.status_code == 200
    assert response.json()[0]["membership_id"] == str(current.id)
    assert str(unrelated_guardian.id) not in json.dumps(response.json())


def test_push_device_activation_and_deactivation_are_audited(api_client, user):
    api_client.force_authenticate(user)
    created = api_client.post(
        "/api/v1/push-devices/",
        {
            "installation_id": str(uuid.uuid4()),
            "expo_push_token": "ExponentPushToken[audit-device]",
            "platform": "android",
        },
    )

    assert created.status_code == 201
    device_id = created.json()["id"]
    assert AuditEvent.objects.filter(
        event_type="device.activated", aggregate_id=device_id, actor=user
    ).exists()
    listed = api_client.get("/api/v1/push-devices/")
    assert listed.status_code == 200
    assert "expo_push_token" not in listed.json()[0]

    removed = api_client.delete(f"/api/v1/push-devices/{device_id}/")

    assert removed.status_code == 204
    assert AuditEvent.objects.filter(
        event_type="device.deactivated", aggregate_id=device_id, actor=user
    ).exists()


def test_account_deletion_leaves_non_pii_audit_tombstone(api_client, user, profile):
    account_id = user.id
    api_client.force_authenticate(user)

    response = api_client.delete(
        "/api/v1/account/",
        {"password": "Safely-testing-123", "confirmed": True},
        format="json",
    )

    assert response.status_code == 204
    tombstone = AuditEvent.objects.get(event_type="account.deleted", aggregate_id=account_id)
    assert tombstone.actor is None
    assert tombstone.actor_kind == AuditEvent.ActorKind.USER
    assert tombstone.metadata == {"method": "self_service"}
    assert "owner@example.cz" not in json.dumps(tombstone.metadata)


def test_alert_responses_disable_storage_in_shared_or_private_caches(api_client, profile, user):
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=profile.next_deadline_at,
    )
    api_client.force_authenticate(user)

    listing = api_client.get("/api/v1/alerts/")
    detail = api_client.get(f"/api/v1/alerts/{incident.id}/")

    assert listing["Cache-Control"] == detail["Cache-Control"] == "no-store, private"
    assert listing["Pragma"] == detail["Pragma"] == "no-cache"


def test_reconciliation_detects_without_writing_and_repairs_expired_generation(profile):
    profile.next_deadline_at = timezone.now() - timedelta(minutes=2)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    detected = reconcile_domain_state()

    assert "expired_profile_missing_incident" in _codes(detected)
    assert not AlertIncident.objects.filter(profile=profile).exists()

    repaired = reconcile_domain_state(repair=True)

    assert repaired.repairs == (f"materialized_incident:{profile.id}",)
    incident = AlertIncident.objects.get(profile=profile)
    assert OutboxEvent.objects.filter(
        deduplication_key=f"alert-opened:{profile.id}:{profile.deadline_generation}"
    ).exists()
    assert AuditEvent.objects.filter(
        event_type="incident.opened", aggregate_id=incident.id
    ).exists()
    assert not reconcile_domain_state().issues


def test_incident_and_outbox_fault_rolls_back_then_retries_cleanly(profile, other_user):
    GuardianMembership.objects.create(profile=profile, guardian=other_user)
    profile.next_deadline_at = timezone.now() - timedelta(minutes=2)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    with (
        patch.object(
            OutboxEvent.objects,
            "get_or_create",
            side_effect=RuntimeError("injected outbox write failure"),
        ),
        pytest.raises(RuntimeError, match="injected outbox write failure"),
    ):
        sweep_expired_deadlines()

    assert not AlertIncident.objects.filter(profile=profile).exists()
    assert not AlertRecipient.objects.exists()
    assert not OutboxEvent.objects.exists()
    assert not AuditEvent.objects.filter(event_type="incident.opened").exists()

    assert sweep_expired_deadlines() == (1, 1)
    incident = AlertIncident.objects.get(profile=profile)
    assert incident.recipients.filter(user=other_user).exists()
    assert (
        OutboxEvent.objects.filter(
            aggregate_id=incident.id,
            event_type="alert.opened",
        ).count()
        == 1
    )
    assert not reconcile_domain_state().issues


def test_reconciliation_restores_snapshots_from_opened_event(profile, other_user):
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=profile.next_deadline_at,
    )
    event = OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"alert-opened:{profile.id}:{profile.deadline_generation}",
        payload={
            "incident_id": str(incident.id),
            "profile_id": str(profile.id),
            "deadline_generation": profile.deadline_generation,
            "recipient_user_ids": [str(other_user.id)],
        },
    )

    detected = reconcile_domain_state()
    assert "missing_alert_recipient_snapshots" in _codes(detected)
    assert not AlertRecipient.objects.filter(incident=incident).exists()

    reconcile_domain_state(repair=True)

    snapshot = AlertRecipient.objects.get(incident=incident)
    assert snapshot.user is None
    assert snapshot.user_id_snapshot == other_user.id
    assert event.status == OutboxEvent.Status.PENDING
    assert "missing_alert_recipient_snapshots" not in _codes(reconcile_domain_state())


def test_reconciliation_repairs_missing_resolution_event(profile):
    opened_at = timezone.now() - timedelta(minutes=5)
    check_in = perform_check_in(profile=profile, idempotency_key="resolution-source").check_in
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation - 1,
        deadline_at=opened_at,
        opened_at=opened_at,
        status=AlertIncident.Status.RESOLVED,
        resolved_at=check_in.accepted_at,
        resolved_by_check_in=check_in,
    )
    OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=(f"alert-opened:{incident.profile_id}:{incident.deadline_generation}"),
        payload={
            "incident_id": str(incident.id),
            "profile_id": str(profile.id),
            "deadline_generation": incident.deadline_generation,
            "recipient_user_ids": [],
        },
    )

    assert "missing_alert_resolved_outbox" in _codes(reconcile_domain_state())
    reconcile_domain_state(repair=True)
    assert OutboxEvent.objects.filter(
        deduplication_key=f"alert-resolved:{incident.id}",
        payload__check_in_id=str(check_in.id),
    ).exists()


def test_open_incident_constraint_and_reconciliation_prevent_duplicate_alert(profile):
    first = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=profile.next_deadline_at,
    )
    OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=first.id,
        deduplication_key=f"alert-opened:{first.profile_id}:{first.deadline_generation}",
        payload={
            "incident_id": str(first.id),
            "profile_id": str(profile.id),
            "deadline_generation": first.deadline_generation,
            "recipient_user_ids": [],
        },
    )
    with pytest.raises(IntegrityError), transaction.atomic():
        AlertIncident.objects.create(
            profile=profile,
            deadline_generation=profile.deadline_generation + 1,
            deadline_at=profile.next_deadline_at,
        )
    profile.deadline_generation += 1
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["deadline_generation", "next_deadline_at", "updated_at"])

    report = reconcile_domain_state(repair=True)

    gap = next(issue for issue in report.issues if issue.code == "expired_profile_missing_incident")
    assert gap.repairable is False
    assert AlertIncident.objects.filter(profile=profile, status="open").count() == 1


def test_reconciliation_command_can_fail_health_check_on_remaining_gap(profile, capsys):
    AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=profile.next_deadline_at,
        resolved_at=timezone.now(),
    )

    with pytest.raises(CommandError, match="open_incident_has_resolution_fields"):
        call_command("reconcile_safety_state", "--fail-on-gaps")

    assert not capsys.readouterr().out
