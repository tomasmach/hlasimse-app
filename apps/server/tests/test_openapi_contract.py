import json
from pathlib import Path

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "openapi.json"


def load_schema():
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def test_tracked_schema_only_contains_versioned_mobile_api_paths():
    schema = load_schema()

    assert schema["openapi"] == "3.1.0"
    assert schema["paths"]
    assert all(path.startswith("/api/v1/") for path in schema["paths"])
    assert "/api/v1/client-config/" in schema["paths"]


def test_history_exposes_location_presence_without_coordinates():
    properties = load_schema()["components"]["schemas"]["CheckInHistory"]["properties"]

    assert properties["has_location"]["type"] == "boolean"
    assert {"latitude", "longitude", "location_accuracy_meters"}.isdisjoint(properties)


def test_pause_duration_presets_are_part_of_create_and_patch_contracts():
    schemas = load_schema()["components"]["schemas"]

    assert schemas["PauseDurationSecondsEnum"]["enum"] == [86_400, 604_800]
    for component_name in ("ProfileRequest", "PatchedProfileRequest"):
        pause_field = schemas[component_name]["properties"]["pause_duration_seconds"]
        assert pause_field["allOf"] == [{"$ref": "#/components/schemas/PauseDurationSecondsEnum"}]
        assert pause_field["writeOnly"] is True
        paused_until = schemas[component_name]["properties"]["paused_until"]
        assert "nejvýše 366 dní" in paused_until["description"]
        assert "serverového času" in paused_until["description"]


def test_registration_requires_write_only_terms_acceptance():
    request = load_schema()["components"]["schemas"]["RegisterRequest"]

    assert "terms_accepted" in request["required"]
    assert request["properties"]["terms_accepted"] == {
        "type": "boolean",
        "writeOnly": True,
    }


def test_provider_acceptance_is_not_documented_as_device_delivery():
    properties = load_schema()["components"]["schemas"]["DeliveryAttemptCountsSchema"]["properties"]

    provider_accepted = properties["provider_accepted"]
    assert provider_accepted["type"] == "integer"
    assert "does not prove delivery to a device" in provider_accepted["description"]


def test_safety_custom_actions_have_explicit_machine_contracts():
    paths = load_schema()["paths"]

    check_in = paths["/api/v1/profiles/{id}/check-in/"]["post"]
    assert check_in["parameters"] == [
        {
            "in": "header",
            "name": "Idempotency-Key",
            "schema": {"type": "string"},
            "required": True,
        },
        {
            "in": "path",
            "name": "id",
            "schema": {"type": "string", "format": "uuid"},
            "description": "A UUID string identifying this check in profile.",
            "required": True,
        },
    ]
    assert check_in["responses"]["201"]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/CheckInReceipt"
    }

    timeline_schema = paths["/api/v1/profiles/{id}/timeline/"]["get"]["responses"]["200"]
    assert timeline_schema["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ProfileTimelinePageSchema"
    }

    archived_operation = paths["/api/v1/profiles/archived/"]["get"]
    assert archived_operation["parameters"] == [
        {
            "in": "query",
            "name": "page_size",
            "schema": {"type": "integer"},
        }
    ]
    archived_schema = archived_operation["responses"]["200"]
    assert archived_schema["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/ArchivedProfilePage"
    }
    archived_page = load_schema()["components"]["schemas"]["ArchivedProfilePage"]
    assert set(archived_page["properties"]) == {"next", "previous", "results"}
    assert set(archived_page["required"]) == {"next", "previous", "results"}

    delete_location = paths["/api/v1/check-ins/{check_in_id}/location/"]["delete"]
    assert delete_location["responses"] == {"204": {"description": "No response body"}}


def test_acknowledgement_contract_exposes_display_name_without_email():
    schema = load_schema()
    properties = schema["components"]["schemas"]["Acknowledgement"]["properties"]

    assert set(properties) == {"user_id", "display_name", "acknowledged_at"}
    description = schema["paths"]["/api/v1/alerts/{id}/acknowledge/"]["post"]["description"]
    assert description == (
        "Record only that an active guardian viewed an open incident in the app. "
        "This does not mean contact, intervention, responsibility, push delivery, or safety."
    )
    assert "taken responsibility" not in description
