#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

IOS_UPGRADE_STAGE_DIR=""
IOS_TEMPLATE_SIMULATOR_UDID=""
IOS_OWNED_SIMULATOR_UDID=""

e2e_ios_delete_owned_simulator() {
  local device_id="${IOS_OWNED_SIMULATOR_UDID}"

  if [[ -z "${device_id}" ]]; then
    return 0
  fi
  if [[ ! "${device_id}" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]]; then
    e2e_log "Refusing to delete an owned simulator with an invalid exact UDID: ${device_id}."
    return 1
  fi
  if [[ "${device_id}" == "${IOS_TEMPLATE_SIMULATOR_UDID}" ]]; then
    e2e_log "Refusing to delete the template simulator ${device_id}."
    return 1
  fi

  xcrun simctl shutdown "${device_id}" >/dev/null 2>&1 || true
  if ! xcrun simctl delete "${device_id}"; then
    e2e_log "Failed to delete runner-created iOS simulator ${device_id}."
    return 1
  fi
  IOS_OWNED_SIMULATOR_UDID=""
}

e2e_ios_cleanup() {
  local exit_code=$?
  local cleanup_status
  local simulator_cleanup_status=0

  trap - EXIT
  set +e
  # Publish/redact evidence and stop the owned backend, Metro, and PostgreSQL
  # before touching simulator state. e2e_cleanup also preserves or elevates the
  # incoming exit code when traceability/finalization fails.
  e2e_cleanup "${exit_code}"
  cleanup_status=$?
  if [[ -n "${IOS_UPGRADE_STAGE_DIR}" ]] && [[ -d "${IOS_UPGRADE_STAGE_DIR}" ]]; then
    rm -r -- "${IOS_UPGRADE_STAGE_DIR}"
  fi
  e2e_ios_delete_owned_simulator
  simulator_cleanup_status=$?
  if [[ "${simulator_cleanup_status}" -ne 0 ]] && [[ "${cleanup_status}" -eq 0 ]]; then
    cleanup_status=1
  fi
  exit "${cleanup_status}"
}

trap e2e_ios_cleanup EXIT

e2e_require curl
e2e_require lsof
e2e_require node
e2e_require npx
e2e_require ditto
e2e_require uv
e2e_require xcrun
e2e_require xcodebuild
[[ -x "${E2E_MAESTRO_BIN}" ]] || { e2e_log "Maestro not executable: ${E2E_MAESTRO_BIN}"; exit 1; }
e2e_require_maestro_version
e2e_generate_credential

IOS_TEMPLATE_SIMULATOR_UDID="${IOS_SIMULATOR_UDID:-${1:-}}"
if [[ -z "${IOS_TEMPLATE_SIMULATOR_UDID}" ]]; then
  e2e_log "Set IOS_SIMULATOR_UDID or pass the exact simulator UDID as the first argument."
  exit 2
fi

e2e_ios_device_record() {
  local device_id="$1"
  xcrun simctl list devices available --json | node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const udid = process.argv[1];
      const devices = JSON.parse(input).devices;
      for (const [runtime, entries] of Object.entries(devices)) {
        const device = entries.find(candidate => candidate.udid === udid && candidate.isAvailable !== false);
        if (device && device.deviceTypeIdentifier) {
          process.stdout.write(`${device.name}\t${runtime}\t${device.deviceTypeIdentifier}`);
          return;
        }
      }
      process.exit(2);
    });
  ' "${device_id}"
}

if ! IOS_TEMPLATE_DEVICE_RECORD="$(e2e_ios_device_record "${IOS_TEMPLATE_SIMULATOR_UDID}")"; then
  e2e_log "Available iOS simulator metadata not found for template UDID ${IOS_TEMPLATE_SIMULATOR_UDID}."
  exit 2
fi
IFS=$'\t' read -r IOS_TEMPLATE_DEVICE_NAME IOS_RUNTIME_ID IOS_DEVICE_TYPE_ID \
  <<<"${IOS_TEMPLATE_DEVICE_RECORD}"

if [[ "${E2E_IOS_REUSE_TEMPLATE:-false}" == "true" ]]; then
  IOS_SIMULATOR_UDID="${IOS_TEMPLATE_SIMULATOR_UDID}"
  IOS_DEVICE_ORIGIN="diagnostic-template-reuse"
  IOS_DEVICE_OWNED="false"
else
  IOS_CREATED_DEVICE_NAME="Hlásím se E2E $(date -u +%Y%m%dT%H%M%SZ)-$$"
  IOS_OWNED_SIMULATOR_UDID="$(
    xcrun simctl create "${IOS_CREATED_DEVICE_NAME}" "${IOS_DEVICE_TYPE_ID}" "${IOS_RUNTIME_ID}"
  )"
  if [[ ! "${IOS_OWNED_SIMULATOR_UDID}" =~ ^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$ ]]; then
    e2e_log "simctl create did not return one exact simulator UDID."
    exit 1
  fi
  IOS_SIMULATOR_UDID="${IOS_OWNED_SIMULATOR_UDID}"
  IOS_DEVICE_ORIGIN="fresh-runner-created"
  IOS_DEVICE_OWNED="true"
fi

E2E_APP_ID="$(e2e_app_id ios)"
export E2E_APP_ID
if [[ "${E2E_IOS_REUSE_TEMPLATE:-false}" == "true" ]]; then
  E2E_RUN_MODE="diagnostic-template-reuse"
elif [[ "${E2E_IOS_FOCUSED_ONLY:-false}" == "true" ]]; then
  E2E_RUN_MODE="focused"
else
  E2E_RUN_MODE="full"
fi
e2e_initialize_run_metadata ios "${E2E_APP_ID}"

IOS_DEVICE_RECORD="$(e2e_ios_device_record "${IOS_SIMULATOR_UDID}")"
IFS=$'\t' read -r IOS_DEVICE_NAME IOS_ACTIVE_RUNTIME_ID IOS_ACTIVE_DEVICE_TYPE_ID \
  <<<"${IOS_DEVICE_RECORD}"
if [[ "${IOS_ACTIVE_RUNTIME_ID}" != "${IOS_RUNTIME_ID}" ]] \
  || [[ "${IOS_ACTIVE_DEVICE_TYPE_ID}" != "${IOS_DEVICE_TYPE_ID}" ]]; then
  e2e_log "Active simulator metadata does not match the exact template type/runtime."
  exit 1
fi
IOS_RUNTIME_RECORD="$(
  xcrun simctl list runtimes --json | node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const runtimeId = process.argv[1];
      const runtime = JSON.parse(input).runtimes.find(candidate => candidate.identifier === runtimeId);
      if (!runtime) process.exit(2);
      process.stdout.write(`${runtime.name}\t${runtime.version}`);
    });
  ' "${IOS_RUNTIME_ID}"
)"
IFS=$'\t' read -r IOS_OS_NAME IOS_OS_VERSION <<<"${IOS_RUNTIME_RECORD}"
IOS_SDK_VERSION="$(xcrun --sdk iphonesimulator --show-sdk-version)"
XCODE_VERSION="$(xcodebuild -version | awk 'NR == 1 {print $2}')"
XCODE_BUILD="$(xcodebuild -version | awk 'NR == 2 {print $3}')"
e2e_record_property device_id "${IOS_SIMULATOR_UDID}"
e2e_record_property device_name "${IOS_DEVICE_NAME}"
e2e_record_property device_origin "${IOS_DEVICE_ORIGIN}"
e2e_record_property device_owned "${IOS_DEVICE_OWNED}"
e2e_record_property device_type_identifier "${IOS_DEVICE_TYPE_ID}"
e2e_record_property template_device_id "${IOS_TEMPLATE_SIMULATOR_UDID}"
e2e_record_property template_device_name "${IOS_TEMPLATE_DEVICE_NAME}"
e2e_record_property os_name "${IOS_OS_NAME}"
e2e_record_property os_version "${IOS_OS_VERSION}"
e2e_record_property api_level "${IOS_SDK_VERSION}"
e2e_record_property ios_runtime_id "${IOS_RUNTIME_ID}"
e2e_record_property xcode_version "${XCODE_VERSION}"
e2e_record_property xcode_build "${XCODE_BUILD}"
e2e_log "iOS app ID: ${E2E_APP_ID}"
e2e_log "Artifact directory: ${E2E_ARTIFACT_DIR}"

e2e_owner_checkin_count() {
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    E2E_OWNER_EMAIL="${E2E_OWNER_EMAIL}" uv run python manage.py shell --verbosity 0 -c '
import os
from core.models import CheckIn

print(CheckIn.objects.filter(profile__owner__email=os.environ["E2E_OWNER_EMAIL"]).count())
'
  )
}

e2e_assert_latest_owner_checkin_has_no_location() {
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    E2E_OWNER_EMAIL="${E2E_OWNER_EMAIL}" uv run python manage.py shell --verbosity 0 -c '
import json
import os
from core.models import CheckIn

check_in = (
    CheckIn.objects.filter(profile__owner__email=os.environ["E2E_OWNER_EMAIL"])
    .order_by("-accepted_at")
    .first()
)
assert check_in is not None, "location-denial flow did not create a check-in"
assert check_in.latitude is None, "denied location unexpectedly persisted latitude"
assert check_in.longitude is None, "denied location unexpectedly persisted longitude"
assert check_in.location_accuracy_meters is None, "denied location unexpectedly persisted accuracy"
print(json.dumps({
    "check_in_id": str(check_in.id),
    "accepted_at": check_in.accepted_at.isoformat(),
    "latitude": None,
    "longitude": None,
    "location_accuracy_meters": None,
}))
'
  ) | tee "${E2E_ARTIFACT_DIR}/backend/ios-location-denial.json"
}

e2e_assert_latest_owner_checkin_uses_upgrade_sentinel() {
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    E2E_OWNER_EMAIL="${E2E_OWNER_EMAIL}" uv run python manage.py shell --verbosity 0 -c '
import json
import os
from core.models import CheckIn

check_in = (
    CheckIn.objects.select_related("profile")
    .filter(profile__owner__email=os.environ["E2E_OWNER_EMAIL"])
    .order_by("-accepted_at")
    .first()
)
assert check_in is not None, "upgrade flow did not create a check-in"
assert check_in.profile.name == "E2E update sentinel", (
    f"upgrade flow checked in the wrong profile: {check_in.profile.name}"
)
print(json.dumps({
    "check_in_id": str(check_in.id),
    "profile_id": str(check_in.profile_id),
    "profile_name": check_in.profile.name,
    "accepted_at": check_in.accepted_at.isoformat(),
}))
'
  ) | tee "${E2E_ARTIFACT_DIR}/backend/ios-upgrade-local-state.json"
}

e2e_reinstall_ios_bundle_without_clearing_data() {
  local device_id="$1"
  local installed_bundle
  local data_before
  local data_after

  installed_bundle="$(xcrun simctl get_app_container "${device_id}" "${E2E_APP_ID}" app)"
  data_before="$(xcrun simctl get_app_container "${device_id}" "${E2E_APP_ID}" data)"
  IOS_UPGRADE_STAGE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hlasimse-ios-upgrade.XXXXXX")"
  ditto "${installed_bundle}" "${IOS_UPGRADE_STAGE_DIR}/Hlasimse.app"

  xcrun simctl terminate "${device_id}" "${E2E_APP_ID}" 2>/dev/null || true
  xcrun simctl install "${device_id}" "${IOS_UPGRADE_STAGE_DIR}/Hlasimse.app"
  data_after="$(xcrun simctl get_app_container "${device_id}" "${E2E_APP_ID}" data)"

  {
    printf 'bundle_id=%s\n' "${E2E_APP_ID}"
    printf 'data_container_before=%s\n' "${data_before}"
    printf 'data_container_after=%s\n' "${data_after}"
    if [[ "${data_before}" == "${data_after}" ]]; then
      printf 'data_container_path_stable=true\n'
    else
      printf 'data_container_path_stable=false\n'
    fi
    printf 'install_mode=in-place-same-bundle\n'
    printf 'preservation_authority=secure-store-selected-profile-and-server-confirmed-sentinel-check-in\n'
  } >"${E2E_ARTIFACT_DIR}/ios-upgrade.properties"

  rm -r -- "${IOS_UPGRADE_STAGE_DIR}"
  IOS_UPGRADE_STAGE_DIR=""
}

if ! xcrun simctl boot "${IOS_SIMULATOR_UDID}" 2>/dev/null; then
  IOS_DEVICE_STATE="$(
    xcrun simctl list devices --json | node -e '
      let input = "";
      process.stdin.on("data", chunk => input += chunk);
      process.stdin.on("end", () => {
        const udid = process.argv[1];
        for (const entries of Object.values(JSON.parse(input).devices)) {
          const device = entries.find(candidate => candidate.udid === udid);
          if (device) {
            process.stdout.write(device.state || "");
            return;
          }
        }
        process.exit(2);
      });
    ' "${IOS_SIMULATOR_UDID}"
  )"
  if [[ "${IOS_DEVICE_STATE}" != "Booted" ]]; then
    e2e_log "Failed to boot exact iOS simulator ${IOS_SIMULATOR_UDID}."
    exit 1
  fi
fi
xcrun simctl bootstatus "${IOS_SIMULATOR_UDID}" -b
e2e_prepare_backend
e2e_start_metro "http://127.0.0.1:8000"

(
  cd "${E2E_ROOT_DIR}/apps/mobile"
  NODE_PATH="${E2E_NODE_PATH}" EXPO_PUBLIC_API_URL="http://127.0.0.1:8000" EXPO_NO_TELEMETRY=1 \
    npx expo run:ios --device "${IOS_SIMULATOR_UDID}" --no-bundler
) 2>&1 | tee "${E2E_ARTIFACT_DIR}/ios-build.log"

if [[ "${E2E_IOS_FOCUSED_ONLY:-false}" != "true" ]]; then
  e2e_run_journey "${IOS_SIMULATOR_UDID}"
else
  e2e_log "Skipping the baseline journey for an explicit focused iOS harness run."
fi

e2e_seed_dataset guardian-open ios-final-seed.json
e2e_run_flow "${IOS_SIMULATOR_UDID}" 45_ios_location_login
xcrun simctl privacy "${IOS_SIMULATOR_UDID}" reset location "${E2E_APP_ID}"
xcrun simctl terminate "${IOS_SIMULATOR_UDID}" "${E2E_APP_ID}" 2>/dev/null || true
xcrun simctl launch "${IOS_SIMULATOR_UDID}" "${E2E_APP_ID}" >/dev/null
IOS_LOCATION_CHECKINS_BEFORE="$(e2e_owner_checkin_count)"
e2e_run_flow "${IOS_SIMULATOR_UDID}" 50_ios_location_denied
IOS_LOCATION_CHECKINS_AFTER="$(e2e_owner_checkin_count)"
if [[ "${IOS_LOCATION_CHECKINS_AFTER}" -ne $((IOS_LOCATION_CHECKINS_BEFORE + 1)) ]]; then
  e2e_log "Expected the location-denial journey to create exactly one check-in; count changed from ${IOS_LOCATION_CHECKINS_BEFORE} to ${IOS_LOCATION_CHECKINS_AFTER}."
  exit 1
fi
e2e_assert_latest_owner_checkin_has_no_location

IOS_UPGRADE_CHECKINS_BEFORE="$(e2e_owner_checkin_count)"
e2e_reinstall_ios_bundle_without_clearing_data "${IOS_SIMULATOR_UDID}"
e2e_run_flow "${IOS_SIMULATOR_UDID}" 55_ios_upgrade_preserves_state
IOS_UPGRADE_CHECKINS_AFTER="$(e2e_owner_checkin_count)"
if [[ "${IOS_UPGRADE_CHECKINS_AFTER}" -ne $((IOS_UPGRADE_CHECKINS_BEFORE + 1)) ]]; then
  e2e_log "Expected the post-upgrade journey to create exactly one check-in; count changed from ${IOS_UPGRADE_CHECKINS_BEFORE} to ${IOS_UPGRADE_CHECKINS_AFTER}."
  exit 1
fi
e2e_assert_latest_owner_checkin_uses_upgrade_sentinel
e2e_seed_dataset cleanup-only ios-final-cleanup.json
