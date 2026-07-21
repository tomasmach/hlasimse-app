import uuid

import pytest

from core.models import PushDevice

pytestmark = pytest.mark.django_db


def _authenticate(client, user):
    client.force_authenticate(user=user)
    return client


def _device_payload(*, installation_id=None, token_suffix: str, platform: str = "ios"):
    return {
        "installation_id": str(installation_id or uuid.uuid4()),
        "expo_push_token": f"ExponentPushToken[{token_suffix}]",
        "platform": platform,
    }


def _create_device(user, *, token_suffix: str, active: bool = True):
    payload = _device_payload(token_suffix=token_suffix)
    device = PushDevice.objects.create(
        user=user,
        installation_id=payload["installation_id"],
        expo_push_token=payload["expo_push_token"],
        platform=payload["platform"],
        active=active,
    )
    return device, payload


def test_sixth_active_push_device_is_rejected(api_client, user):
    for number in range(5):
        _create_device(user, token_suffix=f"existing-{number}")

    response = _authenticate(api_client, user).post(
        "/api/v1/push-devices/",
        _device_payload(token_suffix="sixth"),
    )

    assert response.status_code == 400
    assert response.json()["error"]["details"] == {
        "non_field_errors": [
            "Účet už má maximální počet 5 aktivních zařízení. "
            "Nejprve odstraňte některé starší zařízení."
        ]
    }
    assert PushDevice.objects.filter(user=user, active=True).count() == 5


def test_existing_active_device_can_refresh_at_and_above_cap(api_client, user):
    device, payload = _create_device(user, token_suffix="refresh")
    for number in range(5):
        _create_device(user, token_suffix=f"legacy-{number}")

    response = _authenticate(api_client, user).post(
        "/api/v1/push-devices/",
        {
            **payload,
            "expo_push_token": "ExponentPushToken[refreshed-token]",
            "platform": "android",
        },
    )

    assert response.status_code == 201
    device.refresh_from_db()
    assert device.platform == PushDevice.Platform.ANDROID
    assert device.expo_push_token == "ExponentPushToken[refreshed-token]"
    assert PushDevice.objects.filter(user=user, active=True).count() == 6


def test_inactive_device_cannot_reactivate_when_account_is_at_cap(api_client, user):
    inactive_device, payload = _create_device(user, token_suffix="inactive", active=False)
    for number in range(5):
        _create_device(user, token_suffix=f"active-{number}")

    response = _authenticate(api_client, user).post("/api/v1/push-devices/", payload)

    assert response.status_code == 400
    inactive_device.refresh_from_db()
    assert inactive_device.active is False


def test_device_cannot_rebind_to_account_at_cap(api_client, user, other_user):
    source_device, payload = _create_device(other_user, token_suffix="rebind-at-cap")
    for number in range(5):
        _create_device(user, token_suffix=f"target-{number}")

    response = _authenticate(api_client, user).post("/api/v1/push-devices/", payload)

    assert response.status_code == 400
    source_device.refresh_from_db()
    assert source_device.user == other_user
    assert source_device.active is True
