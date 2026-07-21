from datetime import timedelta

import pytest
from django.utils import timezone

from core.models import PAUSED_UNTIL_MAX_ERROR

pytestmark = pytest.mark.django_db


@pytest.mark.parametrize(
    ("duration_seconds", "duration_days"),
    [(86_400, 1), (604_800, 7)],
)
def test_pause_duration_is_resolved_from_server_time(
    api_client,
    user,
    profile,
    duration_seconds,
    duration_days,
):
    api_client.force_authenticate(user=user)
    before = timezone.now()

    response = api_client.patch(
        f"/api/v1/profiles/{profile.id}/",
        {"is_paused": True, "pause_duration_seconds": duration_seconds},
        format="json",
    )

    after = timezone.now()
    assert response.status_code == 200
    profile.refresh_from_db()
    assert before + timedelta(days=duration_days) <= profile.paused_until
    assert profile.paused_until <= after + timedelta(days=duration_days)
    assert profile.next_deadline_at is None


def test_custom_pause_accepts_exact_server_horizon(api_client, user, profile, monkeypatch):
    api_client.force_authenticate(user=user)
    server_now = timezone.now().replace(microsecond=0)
    monkeypatch.setattr(timezone, "now", lambda: server_now)
    paused_until = server_now + timedelta(days=366)

    response = api_client.patch(
        f"/api/v1/profiles/{profile.id}/",
        {"is_paused": True, "paused_until": paused_until.isoformat()},
        format="json",
    )

    assert response.status_code == 200
    profile.refresh_from_db()
    assert profile.is_paused is True
    assert profile.paused_until == paused_until


def test_custom_pause_rejects_far_future_without_changing_profile_and_allows_indefinite(
    api_client,
    user,
    profile,
    monkeypatch,
):
    api_client.force_authenticate(user=user)
    server_now = timezone.now().replace(microsecond=0)
    monkeypatch.setattr(timezone, "now", lambda: server_now)
    original = {
        "enabled": profile.enabled,
        "is_paused": profile.is_paused,
        "paused_until": profile.paused_until,
        "next_deadline_at": profile.next_deadline_at,
        "deadline_generation": profile.deadline_generation,
    }

    rejected = api_client.patch(
        f"/api/v1/profiles/{profile.id}/",
        {
            "is_paused": True,
            "paused_until": (server_now + timedelta(days=366, seconds=1)).isoformat(),
        },
        format="json",
    )

    assert rejected.status_code == 400
    assert rejected.json() == {
        "error": {
            "status": 400,
            "details": {"paused_until": [PAUSED_UNTIL_MAX_ERROR]},
        }
    }
    profile.refresh_from_db()
    assert {
        "enabled": profile.enabled,
        "is_paused": profile.is_paused,
        "paused_until": profile.paused_until,
        "next_deadline_at": profile.next_deadline_at,
        "deadline_generation": profile.deadline_generation,
    } == original

    indefinite = api_client.patch(
        f"/api/v1/profiles/{profile.id}/",
        {"is_paused": True, "paused_until": None},
        format="json",
    )
    assert indefinite.status_code == 200
    profile.refresh_from_db()
    assert profile.is_paused is True
    assert profile.paused_until is None


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
