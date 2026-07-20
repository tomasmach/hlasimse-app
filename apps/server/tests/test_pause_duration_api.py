from datetime import timedelta

import pytest
from django.utils import timezone

pytestmark = pytest.mark.django_db


def test_pause_duration_is_resolved_from_server_time(api_client, user, profile):
    api_client.force_authenticate(user=user)
    before = timezone.now()

    response = api_client.patch(
        f"/api/v1/profiles/{profile.id}/",
        {"is_paused": True, "pause_duration_seconds": 86_400},
        format="json",
    )

    after = timezone.now()
    assert response.status_code == 200
    profile.refresh_from_db()
    assert before + timedelta(days=1) <= profile.paused_until <= after + timedelta(days=1)
    assert profile.next_deadline_at is None


@pytest.mark.parametrize(
    "payload",
    [
        {"is_paused": True, "pause_duration_seconds": 3_600},
        {"is_paused": False, "pause_duration_seconds": 86_400},
        {
            "is_paused": True,
            "pause_duration_seconds": 86_400,
            "paused_until": "2026-07-22T10:00:00Z",
        },
    ],
)
def test_pause_duration_rejects_ambiguous_or_unsupported_requests(
    api_client,
    user,
    profile,
    payload,
):
    api_client.force_authenticate(user=user)

    response = api_client.patch(f"/api/v1/profiles/{profile.id}/", payload, format="json")

    assert response.status_code == 400
    profile.refresh_from_db()
    assert profile.is_paused is False
    assert profile.paused_until is None
