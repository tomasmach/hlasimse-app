from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import AlertIncident, GuardianMembership
from core.services import perform_check_in, sweep_expired_deadlines

pytestmark = pytest.mark.django_db


def _jwt_client(user) -> APIClient:
    issuer = APIClient()
    issued = issuer.post(
        "/api/v1/auth/token/",
        {"email": user.email, "password": "Safely-testing-123"},
        format="json",
    )
    assert issued.status_code == 200
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issued.json()['access']}")
    return client


def test_revoking_guardian_invalidates_domain_access_in_two_existing_sessions(
    user,
    other_user,
    profile,
):
    membership = GuardianMembership.objects.create(profile=profile, guardian=other_user)
    perform_check_in(
        profile=profile,
        idempotency_key="two-session-location-source",
        latitude="50.075500",
        longitude="14.437800",
    )
    profile.refresh_from_db()
    profile.next_deadline_at = timezone.now() - timedelta(minutes=1)
    profile.save(update_fields=["next_deadline_at", "updated_at"])
    assert sweep_expired_deadlines() == (1, 1)
    incident = AlertIncident.objects.get(profile=profile)

    first_session = _jwt_client(other_user)
    second_session = _jwt_client(other_user)
    for session in (first_session, second_session):
        assert session.get("/api/v1/watched-profiles/").json()[0]["id"] == str(profile.id)
        detail = session.get(f"/api/v1/alerts/{incident.id}/")
        assert detail.status_code == 200
        assert detail.json()["last_known_location"]["latitude"] == "50.075500"

    owner = APIClient()
    owner.force_authenticate(user=user)
    revoked = owner.delete(f"/api/v1/profiles/{profile.id}/guardians/{membership.id}/")
    assert revoked.status_code == 204

    for session in (first_session, second_session):
        assert session.get("/api/v1/auth/me/").status_code == 200
        assert session.get("/api/v1/watched-profiles/").json() == []
        assert session.get(f"/api/v1/alerts/{incident.id}/").status_code == 404
        assert session.post(f"/api/v1/alerts/{incident.id}/acknowledge/").status_code == 404
