from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

import pytest
from django.core.exceptions import ValidationError
from django.db import close_old_connections, connection, connections
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (
    AlertIncident,
    AuditEvent,
    CheckIn,
    GuardianInvitation,
    GuardianMembership,
    OutboxEvent,
    User,
)
from core.reconciliation import reconcile_domain_state
from core.serializers import RegisterSerializer
from core.services import (
    accept_invitation,
    create_invitation,
    create_profile,
    perform_check_in,
    sweep_expired_deadlines,
)

pytestmark = pytest.mark.django_db(transaction=True)


@pytest.fixture(autouse=True)
def require_postgresql():
    if connection.vendor != "postgresql":
        pytest.skip("PostgreSQL concurrency validation requires a PostgreSQL test database")


def run_two_workers(worker):
    barrier = Barrier(2)

    def wrapped(argument):
        close_old_connections()
        try:
            barrier.wait(timeout=10)
            return worker(argument)
        finally:
            connections.close_all()

    with ThreadPoolExecutor(max_workers=2) as executor:
        return list(executor.map(wrapped, (0, 1)))


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


def test_concurrent_duplicate_checkin_has_one_receipt_and_one_deadline_advance():
    owner = User.objects.create_user(email="checkin-owner@example.cz", password="Long-pass-123")
    profile = create_profile(owner=owner, name="Solo", interval_seconds=3_600)
    initial_generation = profile.deadline_generation

    def check_in(_number):
        thread_profile = type(profile).objects.get(pk=profile.pk)
        result = perform_check_in(profile=thread_profile, idempotency_key="same-device-event")
        return str(result.check_in.id), result.created, result.check_in.response_deadline_at

    results = run_two_workers(check_in)

    profile.refresh_from_db()
    assert CheckIn.objects.filter(profile=profile).count() == 1
    assert {result[0] for result in results} == {str(profile.check_ins.get().id)}
    assert sorted(result[1] for result in results) == [False, True]
    assert results[0][2] == results[1][2]
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


def test_registration_rejects_case_insensitive_duplicate_as_validation_error(monkeypatch):
    create_barrier = Barrier(2)
    original_create = RegisterSerializer.create

    def synchronized_create(serializer, validated_data):
        create_barrier.wait(timeout=10)
        return original_create(serializer, validated_data)

    monkeypatch.setattr(RegisterSerializer, "create", synchronized_create)

    def register(number):
        client = APIClient()
        client.raise_request_exception = False
        email = "CaseSensitive@example.cz" if number == 0 else "casesensitive@example.cz"
        return client.post(
            "/api/v1/auth/register/",
            {"email": email, "password": "Safely-testing-123"},
        ).status_code

    statuses = run_two_workers(register)

    assert sorted(statuses) == [201, 400]
    assert User.objects.filter(email="casesensitive@example.cz").count() == 1
