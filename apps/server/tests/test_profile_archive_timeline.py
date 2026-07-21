from datetime import timedelta
from urllib.parse import urlsplit

import pytest
from django.db import IntegrityError, transaction
from django.utils import timezone

from core.account_data import build_account_export
from core.models import (
    AlertIncident,
    AuditEvent,
    CheckIn,
    CheckInProfile,
    GuardianInvitation,
    GuardianMembership,
)
from core.services import (
    create_invitation,
    create_profile,
    perform_check_in,
    sweep_expired_deadlines,
    update_profile,
)

pytestmark = pytest.mark.django_db


def authenticate(client, user):
    client.force_authenticate(user=user)
    return client


def archive(client, profile):
    return client.delete(f"/api/v1/profiles/{profile.id}/")


def test_archiving_due_profile_commits_incident_and_returns_stable_conflict(
    api_client, user, profile
):
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])

    response = archive(authenticate(api_client, user), profile)

    assert response.status_code == 409
    assert set(response.json()) == {"code", "detail", "incident_id"}
    assert response.json()["code"] == "profile_has_open_incident"
    incident = AlertIncident.objects.get(pk=response.json()["incident_id"])
    assert incident.profile == profile
    assert incident.status == AlertIncident.Status.OPEN
    profile.refresh_from_db()
    assert profile.archived_at is None
    assert AuditEvent.objects.filter(
        event_type="incident.opened",
        aggregate_id=incident.id,
    ).exists()


def test_archive_is_inert_revokes_access_and_retains_domain_history(
    api_client, user, other_user, profile
):
    first = perform_check_in(profile=profile, idempotency_key="retained-first").check_in
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    invited = type(other_user).objects.create_user(
        email="pending-archive@example.cz",
        password="Safely-testing-123",
    )
    invitation, raw_token = create_invitation(
        profile=profile,
        invited_by=user,
        email=invited.email,
    )
    initial_generation = CheckInProfile.objects.get(pk=profile.pk).deadline_generation

    response = archive(authenticate(api_client, user), profile)

    assert response.status_code == 204
    profile.refresh_from_db()
    assert profile.archived_at is not None
    assert profile.enabled is False
    assert profile.is_paused is True
    assert profile.paused_until is None
    assert profile.next_deadline_at is None
    assert profile.deadline_generation == initial_generation + 1
    membership.refresh_from_db()
    invitation.refresh_from_db()
    assert membership.status == GuardianMembership.Status.REVOKED
    assert invitation.status == GuardianInvitation.Status.REVOKED
    assert CheckIn.objects.filter(pk=first.pk, profile=profile).exists()
    archived_audit = AuditEvent.objects.get(
        event_type="profile.archived",
        aggregate_id=profile.id,
    )
    assert archived_audit.metadata == {
        "deadline_generation": profile.deadline_generation,
        "revoked_membership_count": 1,
        "revoked_invitation_count": 1,
    }

    owner_client = authenticate(api_client, user)
    assert owner_client.get(f"/api/v1/profiles/{profile.id}/").status_code == 404
    assert owner_client.patch(f"/api/v1/profiles/{profile.id}/", {"name": "No"}).status_code == 404
    assert (
        owner_client.post(
            f"/api/v1/profiles/{profile.id}/check-in/",
            HTTP_IDEMPOTENCY_KEY="archived-checkin",
        ).status_code
        == 404
    )
    assert owner_client.get(f"/api/v1/profiles/{profile.id}/guardians/").status_code == 404
    assert owner_client.get(f"/api/v1/profiles/{profile.id}/invitations/").status_code == 404

    guardian_client = authenticate(api_client, other_user)
    assert guardian_client.get("/api/v1/watched-profiles/").json() == []
    invited_client = authenticate(api_client, invited)
    assert invited_client.get("/api/v1/guardian-invitations/").json() == []
    assert (
        invited_client.post(
            "/api/v1/guardian-invitations/accept/",
            {"token": raw_token},
        ).status_code
        == 400
    )


def test_archived_profiles_do_not_consume_limit_and_names_can_be_reused(api_client, user):
    profiles = [
        create_profile(owner=user, name=f"Profil {number}", interval_seconds=3_600)
        for number in range(5)
    ]
    assert archive(authenticate(api_client, user), profiles[0]).status_code == 204

    replacement = authenticate(api_client, user).post(
        "/api/v1/profiles/",
        {"name": profiles[0].name, "interval_seconds": 3_600},
        format="json",
    )

    assert replacement.status_code == 201
    assert CheckInProfile.objects.filter(owner=user).count() == 6
    listed = authenticate(api_client, user).get("/api/v1/profiles/").json()
    assert len(listed) == 5
    assert str(profiles[0].id) not in {item["id"] for item in listed}


def test_archived_profile_list_is_owner_only_paginated_and_not_cached(
    api_client, user, other_user, profile
):
    older = create_profile(owner=user, name="Starší archiv", interval_seconds=3_600)
    newer = create_profile(owner=user, name="Novější archiv", interval_seconds=3_600)
    foreign = create_profile(owner=other_user, name="Cizí archiv", interval_seconds=3_600)
    assert archive(authenticate(api_client, user), older).status_code == 204
    assert archive(authenticate(api_client, user), newer).status_code == 204
    assert archive(authenticate(api_client, other_user), foreign).status_code == 204

    response = authenticate(api_client, user).get(
        "/api/v1/profiles/archived/",
        {"page_size": 1},
    )

    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store, private"
    assert response["Pragma"] == "no-cache"
    assert set(response.json()) == {"next", "previous", "results"}
    assert response.json()["next"] is not None
    assert response.json()["previous"] is None
    assert [item["id"] for item in response.json()["results"]] == [str(newer.id)]
    assert response.json()["results"][0]["archived_at"] is not None
    assert str(profile.id) not in response.content.decode()
    assert str(foreign.id) not in response.content.decode()

    inserted_after_first_page = create_profile(
        owner=user,
        name="Vložený po první stránce",
        interval_seconds=3_600,
    )
    assert archive(authenticate(api_client, user), inserted_after_first_page).status_code == 204
    cursor_query = urlsplit(response.json()["next"]).query
    second_page = authenticate(api_client, user).get(f"/api/v1/profiles/archived/?{cursor_query}")
    assert second_page.status_code == 200
    assert [item["id"] for item in second_page.json()["results"]] == [str(older.id)]
    paged_ids = {
        response.json()["results"][0]["id"],
        second_page.json()["results"][0]["id"],
    }
    assert paged_ids == {str(newer.id), str(older.id)}
    assert str(inserted_after_first_page.id) not in paged_ids

    foreign_response = authenticate(api_client, other_user).get("/api/v1/profiles/archived/")
    assert foreign_response.status_code == 200
    assert [item["id"] for item in foreign_response.json()["results"]] == [str(foreign.id)]


def test_database_rejects_an_active_archived_profile(user, profile):
    with pytest.raises(IntegrityError), transaction.atomic():
        CheckInProfile.objects.filter(pk=profile.pk).update(archived_at=timezone.now())


def test_queue_provenance_is_explicit_idempotent_and_exported(api_client, user, profile):
    client = authenticate(api_client, user)
    client_recorded_at = timezone.now() - timedelta(days=3)
    direct = client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        {
            "client_recorded_at": client_recorded_at.isoformat(),
            "submitted_from_queue": False,
        },
        format="json",
        HTTP_IDEMPOTENCY_KEY="old-but-direct",
    )
    queued = client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        {"submitted_from_queue": True},
        format="json",
        HTTP_IDEMPOTENCY_KEY="queued",
    )
    repeated = client.post(
        f"/api/v1/profiles/{profile.id}/check-in/",
        {"submitted_from_queue": False},
        format="json",
        HTTP_IDEMPOTENCY_KEY="queued",
    )

    assert direct.status_code == queued.status_code == 201
    assert direct.json()["submitted_from_queue"] is False
    assert queued.json()["submitted_from_queue"] is True
    assert repeated.status_code == 200
    assert repeated.json() == queued.json()
    history = client.get(f"/api/v1/check-ins/?profile={profile.id}").json()["results"]
    assert [item["submitted_from_queue"] for item in history] == [True, False]
    queued_check_in = CheckIn.objects.get(pk=queued.json()["id"])
    assert (
        AuditEvent.objects.get(
            event_type="checkin.confirmed",
            aggregate_id=queued_check_in.id,
        ).metadata["submitted_from_queue"]
        is True
    )
    exported = build_account_export(user)
    assert {item["submitted_from_queue"] for item in exported["check_ins"]} == {False, True}


def test_timeline_has_exact_safe_event_contract_and_archived_owner_access(
    api_client, user, other_user, profile
):
    profile = update_profile(
        profile=profile,
        values={"is_paused": True, "paused_until": None},
    )
    profile = update_profile(
        profile=profile,
        values={"is_paused": False, "paused_until": None},
    )
    check_in_with_location = perform_check_in(
        profile=profile,
        idempotency_key="timeline-location",
        submitted_from_queue=True,
        latitude="50.075500",
        longitude="14.437800",
    ).check_in
    profile.refresh_from_db()
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])
    sweep_expired_deadlines()
    perform_check_in(profile=profile, idempotency_key="timeline-resolver")
    assert archive(authenticate(api_client, user), profile).status_code == 204

    response = authenticate(api_client, user).get(
        f"/api/v1/profiles/{profile.id}/timeline/?page_size=100"
    )

    assert response.status_code == 200
    assert response["Cache-Control"] == "no-store, private"
    assert set(response.json()) == {"next", "previous", "results"}
    events = response.json()["results"]
    assert {item["event_type"] for item in events} == {
        "profile.created",
        "profile.paused",
        "profile.resumed",
        "checkin.confirmed",
        "incident.opened",
        "incident.resolved",
        "profile.archived",
    }
    event_fields = {"id", "event_type", "occurred_at", "profile_id", "details"}
    assert all(set(item) == event_fields for item in events)
    assert all(item["profile_id"] == str(profile.id) for item in events)
    assert "latitude" not in response.content.decode()
    assert "longitude" not in response.content.decode()
    detail_keys = {
        "profile.created": {"enabled", "is_paused", "interval_seconds", "deadline_generation"},
        "profile.paused": {"automatic", "deadline_generation", "has_scheduled_resume"},
        "profile.resumed": {"automatic", "deadline_generation", "has_scheduled_resume"},
        "checkin.confirmed": {
            "check_in_id",
            "deadline_generation",
            "next_deadline_at",
            "submitted_from_queue",
            "has_location",
            "resolved_incident_count",
        },
        "incident.opened": {"incident_id", "deadline_at", "deadline_generation"},
        "incident.resolved": {"incident_id", "resolved_at", "resolved_by_check_in_id"},
        "profile.archived": {
            "deadline_generation",
            "revoked_membership_count",
            "revoked_invitation_count",
        },
    }
    for event in events:
        assert set(event["details"]) == detail_keys[event["event_type"]]
    check_in_events = [item for item in events if item["event_type"] == "checkin.confirmed"]
    assert (
        next(
            item
            for item in check_in_events
            if item["details"]["check_in_id"] == str(check_in_with_location.id)
        )["details"]["has_location"]
        is True
    )
    assert any(item["details"]["has_location"] is False for item in check_in_events)

    assert (
        authenticate(api_client, other_user)
        .get(f"/api/v1/profiles/{profile.id}/timeline/")
        .status_code
        == 404
    )
    assert authenticate(api_client, user).get(f"/api/v1/profiles/{profile.id}/").status_code == 404


def test_timeline_cursor_is_stable_when_new_event_arrives(api_client, user, profile):
    perform_check_in(profile=profile, idempotency_key="cursor-one")
    perform_check_in(profile=profile, idempotency_key="cursor-two")
    client = authenticate(api_client, user)
    first_page = client.get(f"/api/v1/profiles/{profile.id}/timeline/?page_size=1").json()
    first_id = first_page["results"][0]["id"]
    assert first_page["next"] is not None

    perform_check_in(profile=profile, idempotency_key="cursor-newer")
    next_url = urlsplit(first_page["next"])
    second_page = client.get(f"{next_url.path}?{next_url.query}").json()

    assert second_page["results"][0]["id"] != first_id
    assert second_page["results"][0]["event_type"] == "checkin.confirmed"
