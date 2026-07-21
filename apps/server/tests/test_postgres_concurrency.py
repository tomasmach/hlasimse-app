from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier, Event
from unittest.mock import patch

import pytest
from django.core.exceptions import PermissionDenied, ValidationError
from django.db import close_old_connections, connection, connections, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from core.account_data import AccountDeletionBlocked, delete_account_safely
from core.models import (
    AlertAcknowledgement,
    AlertIncident,
    AlertRecipient,
    AuditEvent,
    CheckIn,
    CheckInProfile,
    EmailVerificationChallenge,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    User,
)
from core.reconciliation import reconcile_domain_state
from core.services import (
    IncidentAcknowledgementClosed,
    accept_invitation,
    acknowledge_incident,
    create_invitation,
    create_profile,
    perform_check_in,
    sweep_expired_deadlines,
    visible_incident_last_known_check_in,
)

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def require_postgresql():
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL concurrency validation requires a PostgreSQL test database")


def run_workers(worker, *, count=2):
    barrier = Barrier(count)

    def wrapped(argument):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return worker(argument)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=count) as executor:
        return list(executor.map(wrapped, range(count)))


def run_two_workers(worker):
    return run_workers(worker)


def test_concurrent_profile_creation_never_creates_a_sixth_profile():
    owner = User.objects.create_user(email="profile-owner@example.cz", password="Long-pass-123")
    for number in range(4):
        create_profile(owner=owner, name=f"Existing {number}", interval_seconds=3_600)

    def create_candidate(number):
        thread_owner = User.objects.get(pk=owner.pk)
        try:
            profile = create_profile(
                owner=thread_owner,
                name=f"Concurrent {number}",
                interval_seconds=3_600,
            )
        except ValidationError:
            return "rejected"
        return str(profile.id)

    results = run_two_workers(create_candidate)

    assert owner.profiles.count() == 5
    assert results.count("rejected") == 1


def test_concurrent_guardian_acceptance_never_activates_a_sixth_guardian():
    owner = User.objects.create_user(email="guardian-owner@example.cz", password="Long-pass-123")
    profile = create_profile(owner=owner, name="Safety", interval_seconds=3_600)
    guardians = [
        User.objects.create_user(email=f"guardian-{number}@example.cz", password="Long-pass-123")
        for number in range(6)
    ]
    for guardian in guardians[:4]:
        GuardianMembership.objects.create(profile=profile, guardian=guardian)
    tokens = [
        create_invitation(profile=profile, invited_by=owner, email=guardian.email)[1]
        for guardian in guardians[4:]
    ]

    def accept_candidate(number):
        guardian = User.objects.get(pk=guardians[number + 4].pk)
        try:
            membership = accept_invitation(raw_token=tokens[number], user=guardian)
        except ValidationError:
            return "rejected"
        return str(membership.id)

    results = run_two_workers(accept_candidate)

    assert profile.guardians.filter(status=GuardianMembership.Status.ACTIVE).count() == 5
    assert results.count("rejected") == 1
    assert GuardianInvitation.objects.filter(status=GuardianInvitation.Status.PENDING).count() == 1


def test_ten_concurrent_duplicate_checkins_have_one_receipt_and_one_deadline_advance():
    owner = User.objects.create_user(email="checkin-owner@example.cz", password="Long-pass-123")
    profile = create_profile(owner=owner, name="Solo", interval_seconds=3_600)
    initial_generation = profile.deadline_generation

    def check_in(_number):
        thread_profile = type(profile).objects.get(pk=profile.pk)
        result = perform_check_in(profile=thread_profile, idempotency_key="same-device-event")
        return str(result.check_in.id), result.created, result.check_in.response_deadline_at

    results = run_workers(check_in, count=10)

    profile.refresh_from_db()
    assert CheckIn.objects.filter(profile=profile).count() == 1
    assert {result[0] for result in results} == {str(profile.check_ins.get().id)}
    assert sum(result[1] for result in results) == 1
    assert {result[2] for result in results} == {profile.check_ins.get().response_deadline_at}
    assert profile.deadline_generation == initial_generation + 1


def test_simultaneous_sweep_and_checkin_cannot_skip_a_late_incident():
    owner = User.objects.create_user(email="race-owner@example.cz", password="Long-pass-123")
    profile = create_profile(owner=owner, name="Race", interval_seconds=3_600)
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    def race(number):
        if number == 0:
            return sweep_expired_deadlines(limit=10)
        thread_profile = type(profile).objects.get(pk=profile.pk)
        result = perform_check_in(profile=thread_profile, idempotency_key="deadline-race")
        return str(result.check_in.id)

    run_two_workers(race)

    incident = AlertIncident.objects.get(profile=profile)
    assert incident.status == AlertIncident.Status.RESOLVED
    assert incident.resolved_by_check_in == profile.check_ins.get()
    assert AlertIncident.objects.filter(profile=profile).count() == 1


def test_simultaneous_due_profile_archive_and_checkin_preserves_incident_history():
    owner = User.objects.create_user(email="archive-race@example.cz", password="Long-pass-123")
    profile = create_profile(owner=owner, name="Archive race", interval_seconds=3_600)
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    def race(number):
        if number == 0:
            client = APIClient()
            client.force_authenticate(user=User.objects.get(pk=owner.pk))
            return client.delete(f"/api/v1/profiles/{profile.id}/").status_code
        result = perform_check_in(
            profile=CheckInProfile.objects.get(pk=profile.pk),
            idempotency_key="archive-deadline-race",
        )
        return str(result.check_in.id)

    results = run_two_workers(race)

    profile.refresh_from_db()
    incident = AlertIncident.objects.get(profile=profile)
    check_in = CheckIn.objects.get(profile=profile)
    assert results[0] in {204, 409}
    assert incident.status == AlertIncident.Status.RESOLVED
    assert incident.resolved_by_check_in == check_in
    assert not AlertIncident.objects.filter(
        profile=profile,
        status=AlertIncident.Status.OPEN,
    ).exists()
    if results[0] == 204:
        assert profile.archived_at is not None
        assert profile.enabled is False
        assert profile.is_paused is True
        assert profile.next_deadline_at is None
    else:
        assert profile.archived_at is None


def test_concurrent_reconciliation_materializes_one_incident_and_audit_event():
    owner = User.objects.create_user(email="reconcile@example.cz", password="Long-pass-123")
    profile = create_profile(owner=owner, name="Reconcile", interval_seconds=3_600)
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    def reconcile(_number):
        return reconcile_domain_state(repair=True).repairs

    run_two_workers(reconcile)

    incident = AlertIncident.objects.get(profile=profile)
    assert (
        OutboxEvent.objects.filter(
            deduplication_key=f"alert-opened:{profile.id}:{profile.deadline_generation}"
        ).count()
        == 1
    )
    assert (
        AuditEvent.objects.filter(event_type="incident.opened", aggregate_id=incident.id).count()
        == 1
    )


def test_concurrent_registration_is_non_enumerating_and_idempotent():
    create_barrier = Barrier(2)

    def register(number):
        client = APIClient()
        client.raise_request_exception = False
        email = "CaseSensitive@example.cz" if number == 0 else "casesensitive@example.cz"
        create_barrier.wait(timeout=10)
        return client.post(
            "/api/v1/auth/register/",
            {
                "email": email,
                "password": "Safely-testing-123",
                "terms_accepted": True,
            },
        ).status_code

    statuses = run_two_workers(register)

    assert statuses == [202, 202]
    assert User.objects.filter(email="casesensitive@example.cz").count() == 1
    assert EmailVerificationChallenge.objects.count() == 1
    assert OutboxEvent.objects.filter(event_type="user.email_verification").count() == 1


def test_concurrent_owner_and_guardian_deletion_preserves_open_incident():
    owner = User.objects.create_user(
        email="delete-owner@example.cz",
        password="Long-pass-123",
    )
    deleting_guardian = User.objects.create_user(
        email="delete-guardian@example.cz",
        password="Long-pass-123",
    )
    remaining_guardian = User.objects.create_user(
        email="keep-guardian@example.cz",
        password="Long-pass-123",
    )
    profile = create_profile(owner=owner, name="Deletion race", interval_seconds=3_600)
    GuardianMembership.objects.create(profile=profile, guardian=deleting_guardian)
    remaining_membership = GuardianMembership.objects.create(
        profile=profile,
        guardian=remaining_guardian,
    )
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    deleting_recipient = AlertRecipient.objects.create(
        incident=incident,
        user=deleting_guardian,
        user_id_snapshot=deleting_guardian.id,
    )
    remaining_recipient = AlertRecipient.objects.create(
        incident=incident,
        user=remaining_guardian,
        user_id_snapshot=remaining_guardian.id,
    )
    deleting_acknowledgement = AlertAcknowledgement.objects.create(
        incident=incident,
        user=deleting_guardian,
    )
    event = OutboxEvent.objects.create(
        event_type="alert.opened",
        aggregate_type="alert_incident",
        aggregate_id=incident.id,
        deduplication_key=f"concurrent-account-delete:{incident.id}",
        payload={
            "recipient_user_ids": [
                str(deleting_guardian.id),
                str(remaining_guardian.id),
            ]
        },
    )
    participant_ids = [owner.id, deleting_guardian.id]

    def delete_participant(number):
        try:
            delete_account_safely(
                user_id=participant_ids[number],
                password="Long-pass-123",
            )
        except AccountDeletionBlocked:
            return "blocked"
        return "deleted"

    results = run_two_workers(delete_participant)

    assert results == ["blocked", "deleted"]
    assert User.objects.filter(pk=owner.pk).exists()
    assert not User.objects.filter(pk=deleting_guardian.pk).exists()
    assert User.objects.filter(pk=remaining_guardian.pk).exists()
    profile.refresh_from_db()
    assert profile.owner_id == owner.id
    incident.refresh_from_db()
    assert incident.status == AlertIncident.Status.OPEN
    assert incident.resolved_at is None
    remaining_membership.refresh_from_db()
    assert remaining_membership.status == GuardianMembership.Status.ACTIVE
    deleting_recipient.refresh_from_db()
    assert deleting_recipient.user is None
    assert deleting_recipient.user_id_snapshot != deleting_guardian.id
    remaining_recipient.refresh_from_db()
    assert remaining_recipient.user == remaining_guardian
    assert remaining_recipient.user_id_snapshot == remaining_guardian.id
    deleting_acknowledgement.refresh_from_db()
    assert deleting_acknowledgement.user is None
    assert deleting_acknowledgement.user_id_snapshot != deleting_guardian.id
    event.refresh_from_db()
    assert event.payload["recipient_user_ids"] == [str(remaining_guardian.id)]


def test_account_deletion_and_checkin_use_one_postgresql_lock_order():
    owner = User.objects.create_user(
        email="delete-checkin-race@example.cz",
        password="Long-pass-123",
    )
    profile = create_profile(owner=owner, name="Deletion check-in race", interval_seconds=3_600)
    deletion_reached_password_check = Event()
    checkin_holds_profile_lock = Event()
    original_check_password = User.check_password

    def synchronized_password_check(user, raw_password):
        deletion_reached_password_check.set()
        assert checkin_holds_profile_lock.wait(timeout=10)
        return original_check_password(user, raw_password)

    def race(number):
        if number == 0:
            with patch(
                "core.account_data.User.check_password",
                synchronized_password_check,
            ):
                delete_account_safely(user_id=owner.id, password="Long-pass-123")
            return "deleted"

        assert deletion_reached_password_check.wait(timeout=10)
        with transaction.atomic():
            locked_profile = CheckInProfile.objects.select_for_update().get(pk=profile.pk)
            checkin_holds_profile_lock.set()
            perform_check_in(
                profile=locked_profile,
                idempotency_key="delete-checkin-lock-order",
            )
        return "checked-in"

    results = run_two_workers(race)

    assert results == ["deleted", "checked-in"]


def test_acknowledgement_waits_for_overlapping_resolution_and_cannot_write_after_close():
    owner = User.objects.create_user(
        email="ack-resolution-owner@example.cz",
        password="Long-pass-123",
    )
    guardian = User.objects.create_user(
        email="ack-resolution-guardian@example.cz",
        password="Long-pass-123",
    )
    profile = create_profile(owner=owner, name="Ack race", interval_seconds=3_600)
    GuardianMembership.objects.create(profile=profile, guardian=guardian)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=guardian,
        user_id_snapshot=guardian.id,
    )
    resolution_holds_profile_lock = Event()
    allow_resolution = Event()
    acknowledgement_started = Event()

    from core import services

    original_materialize = services._materialize_due_incident_locked

    def hold_resolution_profile_lock(*args, **kwargs):
        resolution_holds_profile_lock.set()
        assert allow_resolution.wait(timeout=10)
        return original_materialize(*args, **kwargs)

    def resolve():
        close_old_connections()
        try:
            with patch(
                "core.services._materialize_due_incident_locked",
                hold_resolution_profile_lock,
            ):
                perform_check_in(
                    profile=CheckInProfile.objects.get(pk=profile.pk),
                    idempotency_key="ack-resolution-race",
                )
        finally:
            connections.close_all()

    def acknowledge():
        close_old_connections()
        try:
            acknowledgement_started.set()
            try:
                acknowledge_incident(
                    incident=AlertIncident.objects.get(pk=incident.pk),
                    guardian=User.objects.get(pk=guardian.pk),
                )
            except IncidentAcknowledgementClosed:
                return "closed"
            return "acknowledged"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        resolution_future = executor.submit(resolve)
        assert resolution_holds_profile_lock.wait(timeout=10)
        acknowledgement_future = executor.submit(acknowledge)
        assert acknowledgement_started.wait(timeout=10)
        allow_resolution.set()
        resolution_future.result(timeout=10)
        assert acknowledgement_future.result(timeout=10) == "closed"

    incident.refresh_from_db()
    assert incident.status == AlertIncident.Status.RESOLVED
    assert not AlertAcknowledgement.objects.filter(incident=incident).exists()


def test_acknowledgement_rechecks_membership_after_overlapping_revocation():
    owner = User.objects.create_user(
        email="ack-revocation-owner@example.cz",
        password="Long-pass-123",
    )
    guardian = User.objects.create_user(
        email="ack-revocation-guardian@example.cz",
        password="Long-pass-123",
    )
    profile = create_profile(owner=owner, name="Ack membership race", interval_seconds=3_600)
    membership = GuardianMembership.objects.create(profile=profile, guardian=guardian)
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
    )
    AlertRecipient.objects.create(
        incident=incident,
        user=guardian,
        user_id_snapshot=guardian.id,
    )
    revocation_holds_profile_lock = Event()
    allow_revocation = Event()
    acknowledgement_started = Event()

    def revoke():
        close_old_connections()
        try:
            with transaction.atomic():
                CheckInProfile.objects.select_for_update().get(pk=profile.pk)
                revocation_holds_profile_lock.set()
                assert allow_revocation.wait(timeout=10)
                locked_membership = GuardianMembership.objects.select_for_update().get(
                    pk=membership.pk
                )
                locked_membership.status = GuardianMembership.Status.REVOKED
                locked_membership.save(update_fields=["status", "updated_at"])
        finally:
            connections.close_all()

    def acknowledge():
        close_old_connections()
        try:
            acknowledgement_started.set()
            try:
                acknowledge_incident(
                    incident=AlertIncident.objects.get(pk=incident.pk),
                    guardian=User.objects.get(pk=guardian.pk),
                )
            except PermissionDenied:
                return "forbidden"
            return "acknowledged"
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        revocation_future = executor.submit(revoke)
        assert revocation_holds_profile_lock.wait(timeout=10)
        acknowledgement_future = executor.submit(acknowledge)
        assert acknowledgement_started.wait(timeout=10)
        allow_revocation.set()
        revocation_future.result(timeout=10)
        assert acknowledgement_future.result(timeout=10) == "forbidden"

    membership.refresh_from_db()
    assert membership.status == GuardianMembership.Status.REVOKED
    assert not AlertAcknowledgement.objects.filter(incident=incident).exists()


def test_location_read_waits_for_overlapping_resolution_and_returns_no_coordinates():
    owner = User.objects.create_user(
        email="location-resolution-owner@example.cz",
        password="Long-pass-123",
    )
    profile = create_profile(owner=owner, name="Location race", interval_seconds=3_600)
    located_check_in = perform_check_in(
        profile=profile,
        idempotency_key="location-before-incident",
        latitude="50.075500",
        longitude="14.437800",
        location_accuracy_meters="8.50",
    ).check_in
    incident = AlertIncident.objects.create(
        profile=profile,
        deadline_generation=profile.deadline_generation,
        deadline_at=timezone.now() - timedelta(minutes=1),
        opened_at=located_check_in.accepted_at + timedelta(seconds=1),
    )
    stale_open_incident = AlertIncident.objects.select_related("profile").get(pk=incident.pk)
    resolution_holds_profile_lock = Event()
    allow_resolution = Event()
    location_read_started = Event()

    from core import services

    original_materialize = services._materialize_due_incident_locked

    def hold_resolution_profile_lock(*args, **kwargs):
        resolution_holds_profile_lock.set()
        assert allow_resolution.wait(timeout=10)
        return original_materialize(*args, **kwargs)

    def resolve():
        close_old_connections()
        try:
            with patch(
                "core.services._materialize_due_incident_locked",
                hold_resolution_profile_lock,
            ):
                perform_check_in(
                    profile=CheckInProfile.objects.get(pk=profile.pk),
                    idempotency_key="location-resolution-race",
                )
        finally:
            connections.close_all()

    def read_location():
        close_old_connections()
        try:
            location_read_started.set()
            return visible_incident_last_known_check_in(
                user=User.objects.get(pk=owner.pk),
                incident=stale_open_incident,
            )
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        resolution_future = executor.submit(resolve)
        assert resolution_holds_profile_lock.wait(timeout=10)
        location_future = executor.submit(read_location)
        assert location_read_started.wait(timeout=10)
        allow_resolution.set()
        resolution_future.result(timeout=10)
        assert location_future.result(timeout=10) is None

    incident.refresh_from_db()
    assert incident.status == AlertIncident.Status.RESOLVED
