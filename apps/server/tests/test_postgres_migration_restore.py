import uuid
from datetime import timedelta

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.utils import timezone

MIGRATION_SNAPSHOT = ("core", "0007_profile_archive_and_queue_provenance")
EXPECTED_CORE_LEAF = ("core", "0009_retire_checkin_outbox_events")
RETIRED_EVENT_MESSAGE = "Retired legacy no-op event; check-in remains in audit history"

OWNER_ID = uuid.UUID("10000000-0000-0000-0000-000000000001")
GUARDIAN_ID = uuid.UUID("10000000-0000-0000-0000-000000000002")
PROFILE_ID = uuid.UUID("20000000-0000-0000-0000-000000000001")
CHECK_IN_ID = uuid.UUID("30000000-0000-0000-0000-000000000001")
INCIDENT_ID = uuid.UUID("40000000-0000-0000-0000-000000000001")
ALERT_EVENT_ID = uuid.UUID("50000000-0000-0000-0000-000000000001")
CHECK_IN_EVENT_ID = uuid.UUID("50000000-0000-0000-0000-000000000002")
DEVICE_ID = uuid.UUID("60000000-0000-0000-0000-000000000001")
INSTALLATION_ID = uuid.UUID("60000000-0000-0000-0000-000000000002")
DELIVERY_ID = uuid.UUID("70000000-0000-0000-0000-000000000001")
RECIPIENT_ID = uuid.UUID("80000000-0000-0000-0000-000000000001")
MEMBERSHIP_ID = uuid.UUID("90000000-0000-0000-0000-000000000001")


def _seed_anonymized_snapshot(apps):
    User = apps.get_model("core", "User")
    CheckInProfile = apps.get_model("core", "CheckInProfile")
    CheckIn = apps.get_model("core", "CheckIn")
    GuardianMembership = apps.get_model("core", "GuardianMembership")
    AlertIncident = apps.get_model("core", "AlertIncident")
    AlertRecipient = apps.get_model("core", "AlertRecipient")
    PushDevice = apps.get_model("core", "PushDevice")
    OutboxEvent = apps.get_model("core", "OutboxEvent")
    DeliveryAttempt = apps.get_model("core", "DeliveryAttempt")

    snapshot_time = timezone.now()
    owner = User.objects.create(
        id=OWNER_ID,
        email="snapshot-owner@example.invalid",
        password="!synthetic-unusable-password",
        first_name="",
        last_name="",
        email_verified_at=snapshot_time,
    )
    guardian = User.objects.create(
        id=GUARDIAN_ID,
        email="snapshot-guardian@example.invalid",
        password="!synthetic-unusable-password",
        first_name="",
        last_name="",
        email_verified_at=snapshot_time,
    )
    profile = CheckInProfile.objects.create(
        id=PROFILE_ID,
        owner=owner,
        name="Synthetic restore profile",
        interval_seconds=86_400,
        enabled=True,
        is_paused=False,
        paused_until=None,
        archived_at=None,
        last_checked_in_at=snapshot_time,
        next_deadline_at=snapshot_time + timedelta(days=1),
        deadline_generation=7,
    )
    membership = GuardianMembership.objects.create(
        id=MEMBERSHIP_ID,
        profile=profile,
        guardian=guardian,
        status="active",
    )
    GuardianMembership.objects.filter(pk=membership.pk).update(
        created_at=snapshot_time - timedelta(days=2)
    )
    check_in = CheckIn.objects.create(
        id=CHECK_IN_ID,
        profile=profile,
        idempotency_key="synthetic-snapshot-check-in",
        accepted_at=snapshot_time,
        client_recorded_at=snapshot_time - timedelta(seconds=15),
        latitude="0.000000",
        longitude="0.000000",
        location_accuracy_meters="999.00",
        deadline_generation=7,
        response_deadline_at=snapshot_time + timedelta(days=1),
        submitted_from_queue=True,
    )
    incident = AlertIncident.objects.create(
        id=INCIDENT_ID,
        profile=profile,
        deadline_generation=6,
        deadline_at=snapshot_time - timedelta(days=1, minutes=5),
        opened_at=snapshot_time - timedelta(days=1),
        status="open",
    )
    AlertRecipient.objects.create(
        id=RECIPIENT_ID,
        incident=incident,
        user=guardian,
        user_id_snapshot=guardian.id,
    )
    device = PushDevice.objects.create(
        id=DEVICE_ID,
        user=guardian,
        installation_id=INSTALLATION_ID,
        expo_push_token="ExponentPushToken[" + "synthetic-snapshot-only]",
        platform="ios",
        active=True,
        last_seen_at=snapshot_time,
    )
    alert_event = OutboxEvent.objects.create(
        id=ALERT_EVENT_ID,
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"alert-opened:{profile.id}:{incident.deadline_generation}",
        payload={
            "incident_id": str(incident.id),
            "profile_id": str(profile.id),
            "deadline_generation": incident.deadline_generation,
            "recipient_user_ids": [str(guardian.id)],
        },
        status="processed",
        attempts=1,
        processed_at=snapshot_time - timedelta(hours=23),
    )
    DeliveryAttempt.objects.create(
        id=DELIVERY_ID,
        incident=incident,
        outbox_event=alert_event,
        device=device,
        device_id_snapshot=device.id,
        destination_token_hash="0" * 64,
        platform_snapshot="ios",
        attempt_number=1,
        status="delivered",
        expo_ticket_id="synthetic-legacy-ticket",
        response_data={"status": "synthetic-provider-accepted"},
    )
    OutboxEvent.objects.create(
        id=CHECK_IN_EVENT_ID,
        event_type="checkin.accepted",
        aggregate_type="check_in",
        aggregate_id=check_in.id,
        deduplication_key=f"checkin-accepted:{check_in.id}",
        payload={"check_in_id": str(check_in.id), "profile_id": str(profile.id)},
        status="pending",
        attempts=0,
        locked_at=snapshot_time - timedelta(minutes=10),
    )


@pytest.mark.django_db(transaction=True)
def test_anonymized_snapshot_migrates_to_leaf_without_safety_gaps():
    if connection.vendor != "postgresql":
        pytest.skip("Migration snapshot restore gate requires PostgreSQL.")

    executor = MigrationExecutor(connection)
    leaf_targets = tuple(executor.loader.graph.leaf_nodes())
    assert EXPECTED_CORE_LEAF in leaf_targets

    try:
        executor.migrate([MIGRATION_SNAPSHOT])
        snapshot_apps = executor.loader.project_state([MIGRATION_SNAPSHOT]).apps
        _seed_anonymized_snapshot(snapshot_apps)

        executor = MigrationExecutor(connection)
        executor.migrate(leaf_targets)
        leaf_apps = executor.loader.project_state(leaf_targets).apps

        User = leaf_apps.get_model("core", "User")
        CheckInProfile = leaf_apps.get_model("core", "CheckInProfile")
        CheckIn = leaf_apps.get_model("core", "CheckIn")
        GuardianMembership = leaf_apps.get_model("core", "GuardianMembership")
        AlertIncident = leaf_apps.get_model("core", "AlertIncident")
        AlertRecipient = leaf_apps.get_model("core", "AlertRecipient")
        PushDevice = leaf_apps.get_model("core", "PushDevice")
        OutboxEvent = leaf_apps.get_model("core", "OutboxEvent")
        DeliveryAttempt = leaf_apps.get_model("core", "DeliveryAttempt")

        assert {
            "users": User.objects.count(),
            "profiles": CheckInProfile.objects.count(),
            "check_ins": CheckIn.objects.count(),
            "memberships": GuardianMembership.objects.count(),
            "incidents": AlertIncident.objects.count(),
            "recipients": AlertRecipient.objects.count(),
            "devices": PushDevice.objects.count(),
            "outbox_events": OutboxEvent.objects.count(),
            "delivery_attempts": DeliveryAttempt.objects.count(),
        } == {
            "users": 2,
            "profiles": 1,
            "check_ins": 1,
            "memberships": 1,
            "incidents": 1,
            "recipients": 1,
            "devices": 1,
            "outbox_events": 2,
            "delivery_attempts": 1,
        }

        profile = CheckInProfile.objects.get(pk=PROFILE_ID)
        check_in = CheckIn.objects.get(pk=CHECK_IN_ID)
        membership = GuardianMembership.objects.get(pk=MEMBERSHIP_ID)
        incident = AlertIncident.objects.get(pk=INCIDENT_ID)
        recipient = AlertRecipient.objects.get(pk=RECIPIENT_ID)
        device = PushDevice.objects.get(pk=DEVICE_ID)
        alert_event = OutboxEvent.objects.get(pk=ALERT_EVENT_ID)
        retired_event = OutboxEvent.objects.get(pk=CHECK_IN_EVENT_ID)
        delivery = DeliveryAttempt.objects.get(pk=DELIVERY_ID)

        assert profile.owner_id == OWNER_ID
        assert check_in.profile_id == profile.id
        assert membership.profile_id == profile.id
        assert membership.guardian_id == GUARDIAN_ID
        assert incident.profile_id == profile.id
        assert recipient.incident_id == incident.id
        assert recipient.user_id == GUARDIAN_ID
        assert device.user_id == GUARDIAN_ID
        assert alert_event.aggregate_id == incident.id
        assert delivery.incident_id == incident.id
        assert delivery.outbox_event_id == alert_event.id
        assert delivery.device_id == device.id
        connection.check_constraints()

        assert delivery.status == "delivered"
        assert delivery.device_id_snapshot == DEVICE_ID
        assert delivery.destination_token_hash == "0" * 64
        assert delivery.platform_snapshot == "ios"
        assert delivery.expo_ticket_id == "synthetic-legacy-ticket"
        assert delivery.response_data == {"status": "synthetic-provider-accepted"}

        assert retired_event.status == "processed"
        assert retired_event.processed_at is not None
        assert retired_event.locked_at is None
        assert retired_event.last_error == RETIRED_EVENT_MESSAGE
        assert retired_event.attempts == 0
        assert retired_event.payload == {
            "check_in_id": str(CHECK_IN_ID),
            "profile_id": str(PROFILE_ID),
        }

        from core.models import DeliveryAttempt as RuntimeDeliveryAttempt
        from core.reconciliation import reconcile_domain_state

        runtime_delivery = RuntimeDeliveryAttempt.objects.get(pk=DELIVERY_ID)
        assert runtime_delivery.status == RuntimeDeliveryAttempt.Status.LEGACY_DELIVERED
        reconciliation = reconcile_domain_state()
        assert reconciliation.issues == ()
        assert reconciliation.repairs == ()
    finally:
        MigrationExecutor(connection).migrate(leaf_targets)
