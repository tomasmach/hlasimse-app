from django.test import override_settings

from core.versioning import InvalidSemVer, parse_semver

MOBILE_HEADERS = {
    "HTTP_X_HLASIMSE_CLIENT": "hlasimse-mobile",
    "HTTP_X_HLASIMSE_PLATFORM": "ios",
    "HTTP_X_HLASIMSE_VERSION": "2.1.0",
    "HTTP_X_HLASIMSE_BUILD": "42",
}
RELEASES = {
    "ios": {
        "min_version": "2.0.0",
        "parsed_min_version": parse_semver("2.0.0"),
        "min_build": 40,
        "store_url": "https://apps.example.test/ios",
    },
    "android": {
        "min_version": "3.0.0",
        "parsed_min_version": parse_semver("3.0.0"),
        "min_build": 70,
        "store_url": "https://apps.example.test/android",
    },
}


def test_semver_parser_rejects_invalid_or_ambiguous_versions():
    for invalid in ("1", "1.0", "01.0.0", "1.0.0-01", "v1.0.0", "1.0.0.0", ""):
        try:
            parse_semver(invalid)
        except InvalidSemVer:
            continue
        raise AssertionError(f"{invalid!r} should not be accepted as semantic version")


def test_semver_comparison_respects_prerelease_precedence():
    assert parse_semver("1.9.9") < parse_semver("2.0.0")
    assert parse_semver("2.0.0-rc.1") < parse_semver("2.0.0")
    assert parse_semver("2.0.0+build.1") == parse_semver("2.0.0+build.2")


@override_settings(MOBILE_RELEASES=RELEASES, MOBILE_API_MAINTENANCE=False)
def test_client_config_is_public_and_never_cached(client):
    response = client.get("/api/v1/client-config/")

    assert response.status_code == 200
    assert response.json() == {
        "client": "hlasimse-mobile",
        "maintenance": False,
        "platforms": {
            "ios": {
                "min_version": "2.0.0",
                "min_build": 40,
                "store_url": "https://apps.example.test/ios",
            },
            "android": {
                "min_version": "3.0.0",
                "min_build": 70,
                "store_url": "https://apps.example.test/android",
            },
        },
    }
    assert response["Cache-Control"] == "max-age=0, no-cache, no-store, must-revalidate, private"


@override_settings(MOBILE_RELEASES=RELEASES, MOBILE_API_MAINTENANCE=False)
def test_supported_mobile_client_reaches_the_api(client):
    response = client.get("/api/v1/auth/me/", **MOBILE_HEADERS)

    assert response.status_code == 401
    assert response.json().get("code") not in {"update_required", "invalid_client_metadata"}


@override_settings(MOBILE_RELEASES=RELEASES, MOBILE_API_MAINTENANCE=False)
def test_old_client_is_blocked_with_platform_specific_store(client):
    response = client.get(
        "/api/v1/auth/me/",
        **{**MOBILE_HEADERS, "HTTP_X_HLASIMSE_VERSION": "1.9.9"},
    )

    assert response.status_code == 426
    assert response.json() == {
        "code": "update_required",
        "detail": (
            "Tato verze aplikace už není bezpečně podporovaná. "
            "Před dalším použitím ji aktualizujte."
        ),
        "min_version": "2.0.0",
        "min_build": 40,
        "store_url": "https://apps.example.test/ios",
    }


@override_settings(MOBILE_RELEASES=RELEASES, MOBILE_API_MAINTENANCE=False)
def test_current_version_with_old_native_build_is_blocked(client):
    response = client.get(
        "/api/v1/auth/me/",
        **{
            **MOBILE_HEADERS,
            "HTTP_X_HLASIMSE_VERSION": "2.0.0",
            "HTTP_X_HLASIMSE_BUILD": "39",
        },
    )

    assert response.status_code == 426
    assert response.json()["min_version"] == "2.0.0"
    assert response.json()["min_build"] == 40


@override_settings(MOBILE_RELEASES=RELEASES, MOBILE_API_MAINTENANCE=False)
def test_marked_mobile_client_rejects_invalid_version_and_missing_build(client):
    invalid_version = client.get(
        "/api/v1/auth/me/",
        **{**MOBILE_HEADERS, "HTTP_X_HLASIMSE_VERSION": "2.0"},
    )
    missing_build = client.get(
        "/api/v1/auth/me/",
        **{**MOBILE_HEADERS, "HTTP_X_HLASIMSE_BUILD": ""},
    )

    assert invalid_version.status_code == 400
    assert invalid_version.json()["code"] == "invalid_client_version"
    assert missing_build.status_code == 400
    assert missing_build.json()["code"] == "invalid_client_metadata"


@override_settings(
    MOBILE_RELEASES=RELEASES,
    MOBILE_API_MAINTENANCE=True,
    MOBILE_MAINTENANCE_RETRY_AFTER_SECONDS=120,
)
def test_maintenance_blocks_app_api_but_exempts_health_and_client_config(client):
    api_response = client.get("/api/v1/auth/me/", **MOBILE_HEADERS)
    config_response = client.get("/api/v1/client-config/")
    health_response = client.get("/health/live/")

    assert api_response.status_code == 503
    assert api_response.json()["code"] == "maintenance"
    assert api_response["Retry-After"] == "120"
    assert config_response.status_code == 200
    assert config_response.json()["maintenance"] is True
    assert health_response.status_code == 200


@override_settings(
    MOBILE_RELEASES=RELEASES,
    MOBILE_API_MAINTENANCE=True,
    MOBILE_MAINTENANCE_RETRY_AFTER_SECONDS=120,
)
def test_maintenance_blocks_unmarked_clients_on_app_api(client):
    response = client.get("/api/v1/auth/me/")

    assert response.status_code == 503
    assert response.json()["code"] == "maintenance"
