#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

IOS_TEMPLATE_SIMULATOR_UDID=""
IOS_OWNED_SIMULATOR_UDID=""
IOS_BUILD_ROOT=""
IOS_PRODUCTION_APP_PATH=""
IOS_E2E_APP_PATH=""
IOS_PRODUCTION_APP_ID=""
IOS_PRODUCTION_JS_BUNDLE_SHA256=""
IOS_E2E_APP_SHA256=""
IOS_E2E_EXECUTABLE_SHA256=""
IOS_E2E_JS_BUNDLE_SHA256=""
IOS_DEVICE_OWNED="false"
IOS_EXPECTED_PODFILE_LOCK_SHA256="b9411512d7f64fcc179fa941639c4453fa0dd854235817dc785f0c27ff2a0a8c"

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
  local exit_code="$1"
  local cleanup_status
  local simulator_cleanup_status=0
  local build_cleanup_status=0
  local cleanup_metadata_status=0

  trap - EXIT
  set +e
  e2e_ios_delete_owned_simulator
  simulator_cleanup_status=$?
  if [[ "${E2E_METADATA_INITIALIZED}" == "true" ]]; then
    if [[ "${IOS_DEVICE_OWNED}" != "true" ]]; then
      if ! e2e_record_property device_cleanup_completed not-applicable; then
        cleanup_metadata_status=1
      fi
    elif [[ "${simulator_cleanup_status}" -eq 0 ]]; then
      if ! e2e_record_property device_cleanup_completed true; then
        cleanup_metadata_status=1
      fi
    else
      if ! e2e_record_property device_cleanup_completed false; then
        cleanup_metadata_status=1
      fi
    fi
  fi
  if [[ "${IOS_DEVICE_OWNED}" == "true" && "${simulator_cleanup_status}" -ne 0 ]] \
    && [[ "${exit_code}" -eq 0 ]]; then
    exit_code=1
  fi
  if [[ -n "${IOS_BUILD_ROOT}" ]]; then
    if [[ -d "${IOS_BUILD_ROOT}" ]] \
      && [[ -f "${IOS_BUILD_ROOT}/.hlasimse-runner-owned-build-root" ]]; then
      rm -r -- "${IOS_BUILD_ROOT}"
      build_cleanup_status=$?
    else
      build_cleanup_status=1
    fi
  fi
  if [[ "${E2E_METADATA_INITIALIZED}" == "true" ]]; then
    if [[ "${build_cleanup_status}" -eq 0 ]]; then
      if ! e2e_record_property build_cleanup_completed true; then
        cleanup_metadata_status=1
      fi
    else
      if ! e2e_record_property build_cleanup_completed false; then
        cleanup_metadata_status=1
      fi
    fi
  fi
  if [[ "${build_cleanup_status}" -ne 0 && "${exit_code}" -eq 0 ]]; then
    exit_code=1
  fi
  if [[ "${cleanup_metadata_status}" -ne 0 && "${exit_code}" -eq 0 ]]; then
    exit_code=1
  fi
  # Finalize and redact evidence only after owned-device and build cleanup have
  # completed and, when metadata exists, their outcomes have been recorded.
  e2e_cleanup "${exit_code}"
  cleanup_status=$?
  exit "${cleanup_status}"
}

trap 'e2e_ios_cleanup "$?"' EXIT

e2e_require curl
e2e_require cmp
e2e_require lsof
e2e_require node
e2e_require npx
e2e_require ditto
e2e_require codesign
e2e_require pod
e2e_require plutil
e2e_require shasum
e2e_require uv
e2e_require xcrun
e2e_require xcodebuild
[[ -x /usr/libexec/PlistBuddy ]] || { e2e_log "Required tool is unavailable: /usr/libexec/PlistBuddy"; exit 1; }
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

IOS_PRODUCTION_APP_ID="$(e2e_app_id ios)"
E2E_APP_ID="${IOS_PRODUCTION_APP_ID}.e2e"
if [[ ! "${IOS_PRODUCTION_APP_ID}" =~ ^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$ ]]; then
  e2e_log "Invalid base iOS bundle ID: ${IOS_PRODUCTION_APP_ID}."
  exit 2
fi
if [[ "${IOS_PRODUCTION_APP_ID}" == *.e2e ]]; then
  e2e_log "Production iOS bundle ID must not end in the reserved .e2e suffix."
  exit 2
fi
export E2E_APP_ID
if [[ "${E2E_IOS_REUSE_TEMPLATE:-false}" == "true" ]]; then
  E2E_RUN_MODE="diagnostic-template-reuse"
elif [[ "${E2E_IOS_FOCUSED_ONLY:-false}" == "true" ]]; then
  E2E_RUN_MODE="focused"
else
  E2E_RUN_MODE="full"
fi
e2e_initialize_run_metadata ios "${E2E_APP_ID}"
e2e_record_property production_app_id "${IOS_PRODUCTION_APP_ID}"
if [[ "${E2E_RUN_MODE}" == "full" && "${IOS_DEVICE_OWNED}" == "true" \
  && "${IOS_DEVICE_ORIGIN}" == "fresh-runner-created" ]]; then
  e2e_record_property release_evidence_eligible true
else
  e2e_record_property release_evidence_eligible false
fi

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

e2e_ios_app_tree_sha256() {
  local app_path="$1"
  node -e '
    const crypto = require("crypto");
    const fs = require("fs");
    const path = require("path");
    const root = process.argv[1];
    const hash = crypto.createHash("sha256");
    const walk = (directory, prefix = "") => {
      for (const name of fs.readdirSync(directory).sort()) {
        const absolute = path.join(directory, name);
        const relative = prefix ? `${prefix}/${name}` : name;
        const stat = fs.lstatSync(absolute);
        const mode = (stat.mode & 0o7777).toString(8);
        if (stat.isSymbolicLink()) {
          hash.update(`L\0${relative}\0${mode}\0${fs.readlinkSync(absolute)}\0`);
        } else if (stat.isDirectory()) {
          hash.update(`D\0${relative}\0${mode}\0`);
          walk(absolute, relative);
        } else if (stat.isFile()) {
          hash.update(`F\0${relative}\0${mode}\0`);
          hash.update(fs.readFileSync(absolute));
          hash.update("\0");
        }
      }
    };
    walk(root);
    process.stdout.write(hash.digest("hex"));
  ' "${app_path}"
}

e2e_ios_plist_value() {
  local plist_path="$1"
  local key_path="$2"
  plutil -extract "${key_path}" raw -o - "${plist_path}"
}

e2e_ios_prepare_release_apps() {
  local mobile_dir="${E2E_ROOT_DIR}/apps/mobile"
  local native_dir="${mobile_dir}/ios"
  local workspace="${native_dir}/Hlsmse.xcworkspace"
  local scheme="Hlsmse"
  local production_derived_data
  local production_info
  local e2e_info
  local executable_name
  local production_bundle_id
  local e2e_bundle_id
  local podfile_lock_sha256
  local production_arbitrary_loads
  local production_local_networking
  local e2e_arbitrary_loads
  local e2e_local_networking
  local codesign_details
  local codesign_identifier
  local codesign_cdhash
  local production_codesign_details
  local production_codesign_identifier
  local production_app_sha256
  local production_app_sha256_after_isolation
  local e2e_source_app_sha256
  local packaged_app_version
  local packaged_app_build
  local e2e_info_plist_sha256
  local native_project_sha256
  local production_entitlements_path="${E2E_ARTIFACT_DIR}/ios-production-entitlements.plist"
  local e2e_entitlements_path="${E2E_ARTIFACT_DIR}/ios-e2e-entitlements.plist"
  local production_entitlements_sha256
  local e2e_entitlements_sha256
  local bundle_bound_entitlement

  mkdir -p "${native_dir}"
  touch "${native_dir}/.hlasimse-prebuild-stale-sentinel"
  (
    cd "${mobile_dir}"
    CI=1 NODE_PATH="${E2E_NODE_PATH}" EXPO_NO_TELEMETRY=1 \
      npx expo prebuild --clean --platform ios --no-install
  ) 2>&1 | tee "${E2E_ARTIFACT_DIR}/ios-prebuild.log"
  if [[ -e "${native_dir}/.hlasimse-prebuild-stale-sentinel" ]]; then
    e2e_log "Expo iOS prebuild did not clear the stale native-project sentinel."
    return 1
  fi
  [[ -f "${native_dir}/Podfile" ]] || { e2e_log "Generated iOS Podfile is missing."; return 1; }
  (
    cd "${native_dir}"
    pod install
  ) 2>&1 | tee "${E2E_ARTIFACT_DIR}/ios-pod-install.log"
  [[ -f "${native_dir}/Podfile.lock" ]] || { e2e_log "Generated Podfile.lock is missing."; return 1; }
  podfile_lock_sha256="$(shasum -a 256 "${native_dir}/Podfile.lock" | awk '{print $1}')"
  if [[ "${podfile_lock_sha256}" != "${IOS_EXPECTED_PODFILE_LOCK_SHA256}" ]]; then
    e2e_log "Generated Podfile.lock hash does not match the pinned release-evidence lock."
    return 1
  fi
  [[ -d "${workspace}" ]] || { e2e_log "Generated iOS workspace is missing."; return 1; }

  IOS_BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/hlasimse-ios-release.XXXXXX")"
  touch "${IOS_BUILD_ROOT}/.hlasimse-runner-owned-build-root"
  production_derived_data="${IOS_BUILD_ROOT}/production-derived-data"

  (
    cd "${mobile_dir}"
    CI=1 NODE_PATH="${E2E_NODE_PATH}" NODE_ENV=production EXPO_NO_TELEMETRY=1 \
      EXPO_PUBLIC_API_URL="https://release-manifest.invalid" \
      NODE_BINARY="$(command -v node)" \
      xcodebuild -workspace "${workspace}" -scheme "${scheme}" \
        -configuration Release -sdk iphonesimulator \
        -destination "id=${IOS_SIMULATOR_UDID}" \
        -derivedDataPath "${production_derived_data}" build
  ) 2>&1 | tee "${E2E_ARTIFACT_DIR}/ios-production-build.log"

  IOS_PRODUCTION_APP_PATH="${production_derived_data}/Build/Products/Release-iphonesimulator/Hlsmse.app"
  [[ -d "${IOS_PRODUCTION_APP_PATH}" ]] || { e2e_log "Production Release .app is missing."; return 1; }

  mkdir -p "${IOS_BUILD_ROOT}/immutable"
  IOS_E2E_APP_PATH="${IOS_BUILD_ROOT}/immutable/Hlsmse.app"
  ditto "${IOS_PRODUCTION_APP_PATH}" "${IOS_E2E_APP_PATH}"
  production_info="${IOS_PRODUCTION_APP_PATH}/Info.plist"
  e2e_info="${IOS_E2E_APP_PATH}/Info.plist"
  production_app_sha256="$(e2e_ios_app_tree_sha256 "${IOS_PRODUCTION_APP_PATH}")"
  e2e_source_app_sha256="$(e2e_ios_app_tree_sha256 "${IOS_E2E_APP_PATH}")"
  [[ "${e2e_source_app_sha256}" == "${production_app_sha256}" ]] \
    || { e2e_log "Release-derived E2E source copy differs before native isolation."; return 1; }
  production_bundle_id="$(e2e_ios_plist_value "${production_info}" CFBundleIdentifier)"
  [[ "${production_bundle_id}" == "${IOS_PRODUCTION_APP_ID}" ]] || { e2e_log "Production Release bundle ID mismatch."; return 1; }
  [[ "$(e2e_ios_plist_value "${e2e_info}" CFBundleIdentifier)" == "${IOS_PRODUCTION_APP_ID}" ]] || { e2e_log "E2E Release source bundle ID mismatch before isolation."; return 1; }
  [[ "$(e2e_ios_plist_value "${production_info}" CFBundleShortVersionString)" == "$(e2e_app_version)" ]] \
    || { e2e_log "Production Release version mismatch."; return 1; }
  [[ "$(e2e_ios_plist_value "${production_info}" CFBundleVersion)" == "$(e2e_app_build ios)" ]] \
    || { e2e_log "Production Release build number mismatch."; return 1; }

  if ! codesign -d --entitlements :- "${IOS_PRODUCTION_APP_PATH}" \
    >"${production_entitlements_path}" 2>"${E2E_ARTIFACT_DIR}/ios-production-entitlements.log"; then
    e2e_log "Failed to extract production Release entitlements."
    return 1
  fi
  plutil -lint "${production_entitlements_path}" >/dev/null \
    || { e2e_log "Production Release entitlements are not a valid plist."; return 1; }
  for bundle_bound_entitlement in application-identifier com.apple.developer.team-identifier keychain-access-groups; do
    if /usr/libexec/PlistBuddy -c "Print :${bundle_bound_entitlement}" \
      "${production_entitlements_path}" >/dev/null 2>&1; then
      e2e_log "Refusing to preserve bundle-bound entitlement ${bundle_bound_entitlement} in the isolated E2E identity."
      return 1
    fi
  done
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier ${E2E_APP_ID}" "${e2e_info}"
  /usr/libexec/PlistBuddy -c "Set :NSAppTransportSecurity:NSAllowsLocalNetworking true" "${e2e_info}"
  codesign --force --sign - --timestamp=none --entitlements "${production_entitlements_path}" \
    "${IOS_E2E_APP_PATH}"
  codesign --verify --deep --strict "${IOS_E2E_APP_PATH}"
  if ! codesign -d --entitlements :- "${IOS_E2E_APP_PATH}" \
    >"${e2e_entitlements_path}" 2>"${E2E_ARTIFACT_DIR}/ios-e2e-entitlements.log"; then
    e2e_log "Failed to extract isolated E2E entitlements."
    return 1
  fi
  plutil -lint "${e2e_entitlements_path}" >/dev/null \
    || { e2e_log "Isolated E2E entitlements are not a valid plist."; return 1; }
  cmp -s "${production_entitlements_path}" "${e2e_entitlements_path}" \
    || { e2e_log "Isolated E2E entitlements differ from the production Release app."; return 1; }
  production_entitlements_sha256="$(shasum -a 256 "${production_entitlements_path}" | awk '{print $1}')"
  e2e_entitlements_sha256="$(shasum -a 256 "${e2e_entitlements_path}" | awk '{print $1}')"

  e2e_bundle_id="$(e2e_ios_plist_value "${e2e_info}" CFBundleIdentifier)"
  [[ "${e2e_bundle_id}" == "${E2E_APP_ID}" ]] || { e2e_log "Isolated E2E Release bundle ID mismatch."; return 1; }
  [[ "$(e2e_ios_plist_value "${e2e_info}" CFBundleShortVersionString)" == "$(e2e_app_version)" ]] \
    || { e2e_log "E2E Release version mismatch."; return 1; }
  [[ "$(e2e_ios_plist_value "${e2e_info}" CFBundleVersion)" == "$(e2e_app_build ios)" ]] \
    || { e2e_log "E2E Release build number mismatch."; return 1; }
  packaged_app_version="$(e2e_ios_plist_value "${e2e_info}" CFBundleShortVersionString)"
  packaged_app_build="$(e2e_ios_plist_value "${e2e_info}" CFBundleVersion)"
  production_arbitrary_loads="$(e2e_ios_plist_value "${production_info}" NSAppTransportSecurity.NSAllowsArbitraryLoads)"
  production_local_networking="$(e2e_ios_plist_value "${production_info}" NSAppTransportSecurity.NSAllowsLocalNetworking)"
  e2e_arbitrary_loads="$(e2e_ios_plist_value "${e2e_info}" NSAppTransportSecurity.NSAllowsArbitraryLoads)"
  e2e_local_networking="$(e2e_ios_plist_value "${e2e_info}" NSAppTransportSecurity.NSAllowsLocalNetworking)"
  [[ "${production_arbitrary_loads}" == "false" && "${production_local_networking}" == "false" ]] \
    || { e2e_log "Production Release ATS permits local or arbitrary cleartext networking."; return 1; }
  [[ "${e2e_arbitrary_loads}" == "false" && "${e2e_local_networking}" == "true" ]] \
    || { e2e_log "E2E Release ATS isolation is invalid."; return 1; }

  executable_name="$(e2e_ios_plist_value "${e2e_info}" CFBundleExecutable)"
  [[ -x "${IOS_E2E_APP_PATH}/${executable_name}" ]] || { e2e_log "E2E Release executable is missing."; return 1; }
  [[ -s "${IOS_E2E_APP_PATH}/main.jsbundle" ]] || { e2e_log "E2E Release embedded main.jsbundle is missing."; return 1; }
  [[ -s "${IOS_PRODUCTION_APP_PATH}/main.jsbundle" ]] || { e2e_log "Production Release embedded main.jsbundle is missing."; return 1; }
  grep -aFq 'https://release-manifest.invalid' "${IOS_PRODUCTION_APP_PATH}/main.jsbundle" \
    || { e2e_log "Production Release JS bundle does not contain its HTTPS endpoint sentinel."; return 1; }
  grep -aFq 'https://release-manifest.invalid' "${IOS_E2E_APP_PATH}/main.jsbundle" \
    || { e2e_log "Release-derived E2E JS bundle lost the production endpoint sentinel."; return 1; }
  grep -aFq 'http://127.0.0.1:8000' "${IOS_E2E_APP_PATH}/main.jsbundle" \
    || { e2e_log "Release-derived E2E JS bundle lacks the native-identity loopback constant."; return 1; }

  xcodebuild -workspace "${workspace}" -scheme "${scheme}" -configuration Release \
    -sdk iphonesimulator -destination "id=${IOS_SIMULATOR_UDID}" -showBuildSettings \
    >"${E2E_ARTIFACT_DIR}/ios-release-build-settings.txt"
  grep -Eq '^[[:space:]]*CONFIGURATION = Release$' "${E2E_ARTIFACT_DIR}/ios-release-build-settings.txt"
  grep -Eq '^[[:space:]]*ENABLE_TESTABILITY = NO$' "${E2E_ARTIFACT_DIR}/ios-release-build-settings.txt"

  codesign_details="$(codesign -dvvv "${IOS_E2E_APP_PATH}" 2>&1)"
  printf '%s\n' "${codesign_details}" >"${E2E_ARTIFACT_DIR}/ios-e2e-codesign.txt"
  codesign_identifier="$(printf '%s\n' "${codesign_details}" | sed -n 's/^Identifier=//p' | head -1)"
  codesign_cdhash="$(printf '%s\n' "${codesign_details}" | sed -n 's/^CDHash=//p' | head -1)"
  [[ "${codesign_identifier}" == "${E2E_APP_ID}" && -n "${codesign_cdhash}" ]] \
    || { e2e_log "E2E Release codesign identity is incomplete."; return 1; }
  codesign --verify --deep --strict "${IOS_PRODUCTION_APP_PATH}"
  production_codesign_details="$(codesign -dvvv "${IOS_PRODUCTION_APP_PATH}" 2>&1)"
  printf '%s\n' "${production_codesign_details}" >"${E2E_ARTIFACT_DIR}/ios-production-codesign.txt"
  production_codesign_identifier="$(printf '%s\n' "${production_codesign_details}" | sed -n 's/^Identifier=//p' | head -1)"
  [[ "${production_codesign_identifier}" == "${IOS_PRODUCTION_APP_ID}" ]] \
    || { e2e_log "Production Release codesign identifier mismatch."; return 1; }

  IOS_PRODUCTION_JS_BUNDLE_SHA256="$(shasum -a 256 "${IOS_PRODUCTION_APP_PATH}/main.jsbundle" | awk '{print $1}')"
  IOS_E2E_APP_SHA256="$(e2e_ios_app_tree_sha256 "${IOS_E2E_APP_PATH}")"
  IOS_E2E_EXECUTABLE_SHA256="$(shasum -a 256 "${IOS_E2E_APP_PATH}/${executable_name}" | awk '{print $1}')"
  IOS_E2E_JS_BUNDLE_SHA256="$(shasum -a 256 "${IOS_E2E_APP_PATH}/main.jsbundle" | awk '{print $1}')"
  [[ "${IOS_PRODUCTION_JS_BUNDLE_SHA256}" == "${IOS_E2E_JS_BUNDLE_SHA256}" ]] \
    || { e2e_log "Release-derived E2E JS bundle is not byte-identical to production."; return 1; }
  [[ "${production_app_sha256}" != "${IOS_E2E_APP_SHA256}" ]] \
    || { e2e_log "Native E2E isolation did not change the copied app tree."; return 1; }
  production_app_sha256_after_isolation="$(e2e_ios_app_tree_sha256 "${IOS_PRODUCTION_APP_PATH}")"
  [[ "${production_app_sha256_after_isolation}" == "${production_app_sha256}" ]] \
    || { e2e_log "Production Release app changed while deriving the E2E copy."; return 1; }
  e2e_info_plist_sha256="$(shasum -a 256 "${e2e_info}" | awk '{print $1}')"
  native_project_sha256="$(shasum -a 256 "${native_dir}/Hlsmse.xcodeproj/project.pbxproj" | awk '{print $1}')"

  e2e_record_property build_configuration Release
  e2e_record_property packaged_app_version "${packaged_app_version}"
  e2e_record_property packaged_app_build "${packaged_app_build}"
  e2e_record_property js_bundle_mode embedded
  e2e_record_property metro_used false
  e2e_record_property native_project_origin expo-prebuild-cleared
  e2e_record_property expo_prebuild_version "$(node -p "require('${E2E_ROOT_DIR}/node_modules/expo/package.json').version")"
  e2e_record_property cocoapods_version "$(pod --version)"
  e2e_record_property podfile_lock_sha256 "${podfile_lock_sha256}"
  e2e_record_property native_project_sha256 "${native_project_sha256}"
  e2e_record_property production_app_sha256 "${production_app_sha256}"
  e2e_record_property production_app_sha256_after_isolation "${production_app_sha256_after_isolation}"
  e2e_record_property e2e_source_app_sha256 "${e2e_source_app_sha256}"
  e2e_record_property production_js_bundle_sha256 "${IOS_PRODUCTION_JS_BUNDLE_SHA256}"
  e2e_record_property e2e_app_sha256 "${IOS_E2E_APP_SHA256}"
  e2e_record_property e2e_executable_sha256 "${IOS_E2E_EXECUTABLE_SHA256}"
  e2e_record_property e2e_js_bundle_sha256 "${IOS_E2E_JS_BUNDLE_SHA256}"
  e2e_record_property js_bundle_relation byte-identical-production-release
  e2e_record_property production_entitlements_sha256 "${production_entitlements_sha256}"
  e2e_record_property e2e_entitlements_sha256 "${e2e_entitlements_sha256}"
  e2e_record_property bundle_bound_entitlements_present false
  e2e_record_property e2e_info_plist_sha256 "${e2e_info_plist_sha256}"
  e2e_record_property e2e_codesign_cdhash "${codesign_cdhash}"
  e2e_record_property signing_authority adhoc-simulator-test-only
  e2e_record_property bundle_identity_derivation release-postbuild-identity-isolated
  e2e_record_property production_cleartext_allowed false
  e2e_record_property e2e_local_networking_allowed true
  e2e_record_property initial_install_mode fresh-package-install
  e2e_record_property update_artifact_relation same-built-app-reinstall-not-n-minus-one
  e2e_record_property n_minus_one_coverage false
  e2e_record_property store_signed_update_coverage false
  e2e_record_property production_endpoint_coverage sentinel-not-real-production-endpoint
  e2e_record_property artifact_scope release-derived-simulator-not-store-signed
  e2e_record_property ios_architectures "$(lipo -archs "${IOS_E2E_APP_PATH}/${executable_name}")"
}

e2e_ios_install_and_launch_release_app() {
  local device_id="$1"
  local installed_bundle
  local installed_info
  local executable_name
  local installed_app_sha256
  local installed_executable_sha256
  local installed_js_bundle_sha256
  local installed_arbitrary_loads
  local installed_local_networking

  if xcrun simctl get_app_container "${device_id}" "${E2E_APP_ID}" app >/dev/null 2>&1; then
    e2e_record_property ios_bundle_present_before_install true
    e2e_log "E2E iOS bundle unexpectedly exists before the fresh install."
    return 1
  fi
  e2e_record_property ios_bundle_present_before_install false
  xcrun simctl install "${device_id}" "${IOS_E2E_APP_PATH}"
  installed_bundle="$(xcrun simctl get_app_container "${device_id}" "${E2E_APP_ID}" app)"
  installed_info="${installed_bundle}/Info.plist"
  [[ "$(e2e_ios_plist_value "${installed_info}" CFBundleIdentifier)" == "${E2E_APP_ID}" ]] \
    || { e2e_log "Installed E2E iOS bundle ID mismatch."; return 1; }
  [[ "$(e2e_ios_plist_value "${installed_info}" CFBundleShortVersionString)" == "$(e2e_app_version)" ]] \
    || { e2e_log "Installed E2E iOS version mismatch."; return 1; }
  [[ "$(e2e_ios_plist_value "${installed_info}" CFBundleVersion)" == "$(e2e_app_build ios)" ]] \
    || { e2e_log "Installed E2E iOS build number mismatch."; return 1; }
  installed_arbitrary_loads="$(e2e_ios_plist_value "${installed_info}" NSAppTransportSecurity.NSAllowsArbitraryLoads)"
  installed_local_networking="$(e2e_ios_plist_value "${installed_info}" NSAppTransportSecurity.NSAllowsLocalNetworking)"
  [[ "${installed_arbitrary_loads}" == "false" && "${installed_local_networking}" == "true" ]] \
    || { e2e_log "Installed E2E iOS ATS isolation mismatch."; return 1; }
  executable_name="$(e2e_ios_plist_value "${installed_info}" CFBundleExecutable)"
  installed_app_sha256="$(e2e_ios_app_tree_sha256 "${installed_bundle}")"
  installed_executable_sha256="$(shasum -a 256 "${installed_bundle}/${executable_name}" | awk '{print $1}')"
  installed_js_bundle_sha256="$(shasum -a 256 "${installed_bundle}/main.jsbundle" | awk '{print $1}')"
  [[ "${installed_executable_sha256}" == "${IOS_E2E_EXECUTABLE_SHA256}" ]] \
    || { e2e_log "Installed iOS executable differs from the immutable Release artifact."; return 1; }
  [[ "${installed_js_bundle_sha256}" == "${IOS_E2E_JS_BUNDLE_SHA256}" ]] \
    || { e2e_log "Installed iOS JS bundle differs from the immutable Release artifact."; return 1; }
  [[ "${installed_js_bundle_sha256}" == "${IOS_PRODUCTION_JS_BUNDLE_SHA256}" ]] \
    || { e2e_log "Installed iOS JS bundle differs from the production Release JS bundle."; return 1; }
  grep -aFq 'https://release-manifest.invalid' "${installed_bundle}/main.jsbundle" \
    || { e2e_log "Installed E2E JS bundle lost the production HTTPS endpoint sentinel."; return 1; }
  [[ "${installed_app_sha256}" == "${IOS_E2E_APP_SHA256}" ]] \
    || { e2e_log "Installed iOS app tree differs from the immutable Release artifact."; return 1; }
  e2e_record_property installed_app_sha256 "${installed_app_sha256}"
  xcrun simctl launch --terminate-running-process "${device_id}" "${E2E_APP_ID}" \
    >"${E2E_ARTIFACT_DIR}/ios-initial-launch.txt"
}

e2e_reinstall_ios_bundle_without_clearing_data() {
  local device_id="$1"
  local data_before
  local data_after
  local artifact_sha256_after
  local installed_bundle_after
  local installed_info_after
  local executable_name_after
  local installed_app_sha256_after
  local installed_executable_sha256_after
  local installed_js_bundle_sha256_after

  data_before="$(xcrun simctl get_app_container "${device_id}" "${E2E_APP_ID}" data)"
  artifact_sha256_after="$(e2e_ios_app_tree_sha256 "${IOS_E2E_APP_PATH}")"
  [[ "${artifact_sha256_after}" == "${IOS_E2E_APP_SHA256}" ]] \
    || { e2e_log "Immutable iOS Release artifact changed before reinstall."; return 1; }

  xcrun simctl terminate "${device_id}" "${E2E_APP_ID}" 2>/dev/null || true
  xcrun simctl install "${device_id}" "${IOS_E2E_APP_PATH}"
  data_after="$(xcrun simctl get_app_container "${device_id}" "${E2E_APP_ID}" data)"
  installed_bundle_after="$(xcrun simctl get_app_container "${device_id}" "${E2E_APP_ID}" app)"
  installed_info_after="${installed_bundle_after}/Info.plist"
  [[ "$(e2e_ios_plist_value "${installed_info_after}" CFBundleIdentifier)" == "${E2E_APP_ID}" ]] \
    || { e2e_log "Reinstalled E2E iOS bundle ID mismatch."; return 1; }
  [[ "$(e2e_ios_plist_value "${installed_info_after}" CFBundleShortVersionString)" == "$(e2e_app_version)" ]] \
    || { e2e_log "Reinstalled E2E iOS version mismatch."; return 1; }
  [[ "$(e2e_ios_plist_value "${installed_info_after}" CFBundleVersion)" == "$(e2e_app_build ios)" ]] \
    || { e2e_log "Reinstalled E2E iOS build number mismatch."; return 1; }
  executable_name_after="$(e2e_ios_plist_value "${installed_info_after}" CFBundleExecutable)"
  installed_app_sha256_after="$(e2e_ios_app_tree_sha256 "${installed_bundle_after}")"
  installed_executable_sha256_after="$(shasum -a 256 "${installed_bundle_after}/${executable_name_after}" | awk '{print $1}')"
  installed_js_bundle_sha256_after="$(shasum -a 256 "${installed_bundle_after}/main.jsbundle" | awk '{print $1}')"
  [[ "${installed_app_sha256_after}" == "${IOS_E2E_APP_SHA256}" ]] \
    || { e2e_log "Reinstalled iOS app tree differs from the immutable Release artifact."; return 1; }
  [[ "${installed_executable_sha256_after}" == "${IOS_E2E_EXECUTABLE_SHA256}" ]] \
    || { e2e_log "Reinstalled iOS executable differs from the immutable Release artifact."; return 1; }
  [[ "${installed_js_bundle_sha256_after}" == "${IOS_E2E_JS_BUNDLE_SHA256}" ]] \
    || { e2e_log "Reinstalled iOS JS bundle differs from the immutable Release artifact."; return 1; }
  [[ "${data_before}" == "${data_after}" ]] \
    || { e2e_log "iOS data container changed during same-artifact reinstall."; return 1; }

  {
    printf 'bundle_id=%s\n' "${E2E_APP_ID}"
    printf 'data_container_before=%s\n' "${data_before}"
    printf 'data_container_after=%s\n' "${data_after}"
    if [[ "${data_before}" == "${data_after}" ]]; then
      printf 'data_container_path_stable=true\n'
    else
      printf 'data_container_path_stable=false\n'
    fi
    printf 'artifact_sha256_before=%s\n' "${IOS_E2E_APP_SHA256}"
    printf 'artifact_sha256_after=%s\n' "${artifact_sha256_after}"
    printf 'installed_app_sha256_after=%s\n' "${installed_app_sha256_after}"
    printf 'installed_executable_sha256_after=%s\n' "${installed_executable_sha256_after}"
    printf 'installed_js_bundle_sha256_after=%s\n' "${installed_js_bundle_sha256_after}"
    printf 'install_mode=in-place-same-built-app\n'
    printf 'update_artifact_relation=same-built-app-reinstall-not-n-minus-one\n'
    printf 'n_minus_one_coverage=false\n'
    printf 'store_signed_update_coverage=false\n'
    printf 'preservation_authority=secure-store-selected-profile-and-server-confirmed-sentinel-check-in\n'
  } >"${E2E_ARTIFACT_DIR}/ios-upgrade.properties"
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
e2e_ios_prepare_release_apps
e2e_ios_install_and_launch_release_app "${IOS_SIMULATOR_UDID}"

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
if [[ "${E2E_IOS_FOCUSED_ONLY:-false}" == "true" ]]; then
  IOS_EXPECTED_EVIDENCE=(
    45_ios_location_login
    50_ios_location_denied
    55_ios_upgrade_preserves_state
  )
else
  IOS_EXPECTED_EVIDENCE=(
    00_guardian_clean_install
    10_owner_online_core
    15_owner_profile_create
    20_owner_offline_queue
    30_owner_offline_sync
    40_owner_export
    90_owner_delete_account
    95_owner_free_boundaries
    45_ios_location_login
    50_ios_location_denied
    55_ios_upgrade_preserves_state
  )
fi
node "${E2E_ROOT_DIR}/scripts/e2e/assert-junit-evidence.mjs" "${E2E_ARTIFACT_DIR}" \
  "${IOS_EXPECTED_EVIDENCE[@]}" \
  | tee "${E2E_ARTIFACT_DIR}/backend/ios-junit-evidence.json"
E2E_JOURNEY_COMPLETED="true"
