#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
trap e2e_cleanup EXIT

e2e_require adb
e2e_require curl
e2e_require lsof
e2e_require node
e2e_require npx
e2e_require shasum
e2e_require uv
[[ -x "${E2E_MAESTRO_BIN}" ]] || { e2e_log "Maestro not executable: ${E2E_MAESTRO_BIN}"; exit 1; }
e2e_require_maestro_version
e2e_generate_credential

ANDROID_AVD_NAME="${ANDROID_AVD_NAME:-${1:-Medium_Phone_API_36.1}}"
ANDROID_SERIAL="${ANDROID_SERIAL:-}"
E2E_ANDROID_MEMORY_MB="${E2E_ANDROID_MEMORY_MB:-4096}"
E2E_ANDROID_CORES="${E2E_ANDROID_CORES:-4}"
E2E_EMULATOR_PID=""
E2E_DEV_CLIENT_URL="hlasimse://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081"
E2E_DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1,10.0.2.2"
export E2E_DEV_CLIENT_URL E2E_DJANGO_ALLOWED_HOSTS

E2E_APP_ID="$(e2e_app_id android)"
export E2E_APP_ID
E2E_RUN_MODE="full"
e2e_initialize_run_metadata android "${E2E_APP_ID}"

find_android_serial() {
  local serial
  local state
  local detected_avd
  while read -r serial state; do
    [[ "$serial" == emulator-* && "$state" == "device" ]] || continue
    detected_avd="$(adb -s "$serial" shell getprop ro.kernel.qemu.avd_name 2>/dev/null | tr -d '\r')"
    if [[ -z "$detected_avd" ]]; then
      detected_avd="$(adb -s "$serial" shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r')"
    fi
    if [[ "$detected_avd" == "${ANDROID_AVD_NAME}" ]]; then
      printf '%s' "$serial"
      return 0
    fi
  done < <(adb devices | tail -n +2)
  return 1
}

android_package_uid() {
  adb -s "${ANDROID_SERIAL}" shell pm list packages -U "${E2E_APP_ID}" \
    | awk -v expected="package:${E2E_APP_ID}" '
        $1 == expected && $2 ~ /^uid:[0-9]+\r?$/ {
          sub(/^uid:/, "", $2)
          gsub(/\r/, "", $2)
          print $2
        }
      '
}

android_input_text() {
  local value="$1"
  local label="$2"
  local encoded
  local allowed_pattern='^[A-Za-z0-9@._+ -]+$'
  if [[ -z "${value}" ]] || [[ ! "${value}" =~ ${allowed_pattern} ]]; then
    e2e_log "Refusing unsupported ${label} characters for deterministic Android input injection."
    return 1
  fi
  encoded="${value// /%s}"
  adb -s "${ANDROID_SERIAL}" shell input text "${encoded}"
}

find_android_apksigner() {
  local sdk_root
  local candidate
  if command -v apksigner >/dev/null 2>&1; then
    command -v apksigner
    return 0
  fi
  sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
  if [[ -z "${sdk_root}" ]] || [[ ! -d "${sdk_root}/build-tools" ]]; then
    return 1
  fi
  candidate="$(find "${sdk_root}/build-tools" -type f -name apksigner -perm -u+x | sort | tail -n 1)"
  [[ -n "${candidate}" ]] || return 1
  printf '%s' "${candidate}"
}

android_cleanup() {
  local exit_code=$?
  if [[ -n "${ANDROID_SERIAL}" ]] && [[ "$(adb -s "${ANDROID_SERIAL}" get-state 2>/dev/null || true)" == "device" ]]; then
    adb -s "${ANDROID_SERIAL}" logcat -d >"${E2E_ARTIFACT_DIR}/android-logcat.log" 2>&1 || true
  fi
  if [[ "${E2E_STOP_EMULATOR:-false}" == "true" ]] && [[ -n "${E2E_EMULATOR_PID}" ]] && kill -0 "${E2E_EMULATOR_PID}" 2>/dev/null; then
    kill "${E2E_EMULATOR_PID}"
    wait "${E2E_EMULATOR_PID}" 2>/dev/null || true
  fi
  e2e_cleanup "$exit_code"
  return "$exit_code"
}
trap android_cleanup EXIT

if [[ -z "${ANDROID_SERIAL}" ]]; then
  ANDROID_SERIAL="$(find_android_serial || true)"
fi
if [[ -z "${ANDROID_SERIAL}" ]]; then
  e2e_require emulator
  emulator -avd "${ANDROID_AVD_NAME}" -no-snapshot-save \
    -memory "${E2E_ANDROID_MEMORY_MB}" -cores "${E2E_ANDROID_CORES}" \
    >"${E2E_ARTIFACT_DIR}/android-emulator.log" 2>&1 &
  E2E_EMULATOR_PID=$!
  for _ in {1..120}; do
    ANDROID_SERIAL="$(find_android_serial || true)"
    [[ -n "${ANDROID_SERIAL}" ]] && break
    sleep 1
  done
fi
if [[ -z "${ANDROID_SERIAL}" ]]; then
  e2e_log "No Android emulator became available for AVD ${ANDROID_AVD_NAME}."
  exit 2
fi

adb -s "${ANDROID_SERIAL}" wait-for-device
for _ in {1..120}; do
  [[ "$(adb -s "${ANDROID_SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && break
  sleep 1
done
if [[ "$(adb -s "${ANDROID_SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; then
  e2e_log "Android emulator ${ANDROID_SERIAL} did not finish booting."
  exit 2
fi

ANDROID_MEMORY_KB="$(adb -s "${ANDROID_SERIAL}" shell cat /proc/meminfo 2>/dev/null \
  | awk '/^MemTotal:/ {print $2; exit}' | tr -d '\r' || true)"
ANDROID_CORE_COUNT="$(adb -s "${ANDROID_SERIAL}" shell cat /proc/cpuinfo 2>/dev/null \
  | awk '/^processor[[:space:]]*:/ {count += 1} END {if (count) print count}' | tr -d '\r' || true)"
ANDROID_MIN_MEMORY_KB="$((E2E_ANDROID_MEMORY_MB * 900))"
if [[ ! "${ANDROID_MEMORY_KB}" =~ ^[0-9]+$ ]] || ((ANDROID_MEMORY_KB < ANDROID_MIN_MEMORY_KB)); then
  e2e_log "Android emulator has ${ANDROID_MEMORY_KB:-unknown} KiB RAM; the release journey requires about ${E2E_ANDROID_MEMORY_MB} MB."
  exit 2
fi
if [[ ! "${ANDROID_CORE_COUNT}" =~ ^[0-9]+$ ]] || ((ANDROID_CORE_COUNT < E2E_ANDROID_CORES)); then
  e2e_log "Android emulator has ${ANDROID_CORE_COUNT:-unknown} cores; the release journey requires ${E2E_ANDROID_CORES}."
  exit 2
fi
e2e_log "Android emulator resources: ${ANDROID_MEMORY_KB} KiB RAM, ${ANDROID_CORE_COUNT} cores."
adb -s "${ANDROID_SERIAL}" logcat -c

ANDROID_DEVICE_NAME="$(adb -s "${ANDROID_SERIAL}" shell getprop ro.product.model | tr -d '\r')"
ANDROID_OS_VERSION="$(adb -s "${ANDROID_SERIAL}" shell getprop ro.build.version.release | tr -d '\r')"
ANDROID_API_LEVEL="$(adb -s "${ANDROID_SERIAL}" shell getprop ro.build.version.sdk | tr -d '\r')"
ANDROID_BUILD_FINGERPRINT="$(adb -s "${ANDROID_SERIAL}" shell getprop ro.build.fingerprint | tr -d '\r')"
if [[ -z "${ANDROID_DEVICE_NAME}" ]] || [[ ! "${ANDROID_API_LEVEL}" =~ ^[0-9]+$ ]] \
  || [[ -z "${ANDROID_BUILD_FINGERPRINT}" ]]; then
  e2e_log "Could not resolve fail-closed Android device metadata."
  exit 2
fi
e2e_record_property device_id "${ANDROID_SERIAL}"
e2e_record_property device_name "${ANDROID_DEVICE_NAME}"
e2e_record_property os_name "Android"
e2e_record_property os_version "${ANDROID_OS_VERSION}"
e2e_record_property api_level "${ANDROID_API_LEVEL}"
e2e_record_property android_avd "${ANDROID_AVD_NAME}"
e2e_record_property android_build_fingerprint "${ANDROID_BUILD_FINGERPRINT}"
ANDROID_APKSIGNER_BIN="$(find_android_apksigner || true)"
if [[ ! -x "${ANDROID_APKSIGNER_BIN}" ]]; then
  e2e_log "Could not find an executable Android apksigner for release evidence."
  exit 2
fi
e2e_log "Android AVD: ${ANDROID_AVD_NAME}; serial: ${ANDROID_SERIAL}; app ID: ${E2E_APP_ID}"
e2e_log "Artifact directory: ${E2E_ARTIFACT_DIR}"
e2e_prepare_backend
e2e_start_metro "http://10.0.2.2:8000"

(
  cd "${E2E_ROOT_DIR}/apps/mobile"
  NODE_PATH="${E2E_NODE_PATH}" EXPO_PUBLIC_API_URL="http://10.0.2.2:8000" EXPO_NO_TELEMETRY=1 \
    npx expo run:android --device "${ANDROID_AVD_NAME}" --no-bundler
) 2>&1 | tee "${E2E_ARTIFACT_DIR}/android-build.log"

ANDROID_APK_PATH="${E2E_ROOT_DIR}/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -f "${ANDROID_APK_PATH}" ]]; then
  e2e_log "Android debug APK not found after build: ${ANDROID_APK_PATH}"
  exit 2
fi
ANDROID_APK_SHA256="$(shasum -a 256 "${ANDROID_APK_PATH}" | awk '{print $1}')"
"${ANDROID_APKSIGNER_BIN}" verify --print-certs "${ANDROID_APK_PATH}" \
  | tee "${E2E_ARTIFACT_DIR}/android-apk-signature.txt"
ANDROID_SIGNER_CERT_SHA256="$(
  awk -F': ' '/Signer #1 certificate SHA-256 digest:/ {print $2; exit}' \
    "${E2E_ARTIFACT_DIR}/android-apk-signature.txt"
)"
if [[ ! "${ANDROID_APK_SHA256}" =~ ^[0-9a-f]{64}$ ]] \
  || [[ ! "${ANDROID_SIGNER_CERT_SHA256}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  e2e_log "Could not resolve fail-closed APK digest and signing-certificate metadata."
  exit 2
fi
ANDROID_INSTALLED_UID="$(android_package_uid)"
if [[ ! "${ANDROID_INSTALLED_UID}" =~ ^[0-9]+$ ]]; then
  e2e_log "Could not resolve installed Android package UID after build."
  exit 2
fi
e2e_record_property apk_sha256 "${ANDROID_APK_SHA256}"
e2e_record_property apk_signer_cert_sha256 "${ANDROID_SIGNER_CERT_SHA256,,}"
e2e_record_property android_package_uid "${ANDROID_INSTALLED_UID}"

e2e_run_flow "${ANDROID_SERIAL}" 00a_android_guardian_onboarding_focus_email
android_input_text "${E2E_GUARDIAN_EMAIL}" "guardian email"
e2e_run_flow "${ANDROID_SERIAL}" 00b_android_guardian_focus_password
android_input_text "${E2E_RUN_CREDENTIAL}" "generated credential"
e2e_run_flow "${ANDROID_SERIAL}" 00c_android_guardian_after_login

e2e_run_flow "${ANDROID_SERIAL}" 06_android_prepare_location_denial
android_input_text "${E2E_OWNER_EMAIL}" "owner email"
e2e_run_flow "${ANDROID_SERIAL}" 06a_android_focus_owner_password
android_input_text "${E2E_RUN_CREDENTIAL}" "generated credential"
e2e_run_flow "${ANDROID_SERIAL}" 06b_android_submit_location_owner
e2e_run_flow "${ANDROID_SERIAL}" 03a_android_upgrade_sentinel_focus_name
android_input_text "E2E update sentinel" "upgrade sentinel name"
e2e_run_flow "${ANDROID_SERIAL}" 03b_android_upgrade_sentinel_after_name

ANDROID_UID_BEFORE="$(android_package_uid)"
if [[ ! "${ANDROID_UID_BEFORE}" =~ ^[0-9]+$ ]]; then
  e2e_log "Could not resolve Android package UID before the in-place update."
  exit 2
fi
if [[ "${ANDROID_UID_BEFORE}" != "${ANDROID_INSTALLED_UID}" ]]; then
  e2e_log "Android package UID changed before the explicit in-place update (${ANDROID_INSTALLED_UID} -> ${ANDROID_UID_BEFORE})."
  exit 1
fi
adb -s "${ANDROID_SERIAL}" shell dumpsys package "${E2E_APP_ID}" \
  >"${E2E_ARTIFACT_DIR}/android-package-before-update.txt"
e2e_log "Installing the freshly built APK as an in-place package update; application data must remain intact."
adb -s "${ANDROID_SERIAL}" install -r "${ANDROID_APK_PATH}" \
  | tee "${E2E_ARTIFACT_DIR}/android-package-update.log"
ANDROID_UID_AFTER="$(android_package_uid)"
adb -s "${ANDROID_SERIAL}" shell dumpsys package "${E2E_APP_ID}" \
  >"${E2E_ARTIFACT_DIR}/android-package-after-update.txt"
if [[ "${ANDROID_UID_AFTER}" != "${ANDROID_UID_BEFORE}" ]]; then
  e2e_log "Android package UID changed during update (${ANDROID_UID_BEFORE} -> ${ANDROID_UID_AFTER}); app data preservation is unproven."
  exit 1
fi
e2e_run_flow "${ANDROID_SERIAL}" 05_android_update_preserves_state

e2e_run_flow "${ANDROID_SERIAL}" 06_android_prepare_location_denial
android_input_text "${E2E_OWNER_EMAIL}" "owner email"
e2e_run_flow "${ANDROID_SERIAL}" 06a_android_focus_owner_password
android_input_text "${E2E_RUN_CREDENTIAL}" "generated credential"
e2e_run_flow "${ANDROID_SERIAL}" 06b_android_submit_location_owner
for permission in android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION; do
  adb -s "${ANDROID_SERIAL}" shell pm revoke "${E2E_APP_ID}" "${permission}"
  adb -s "${ANDROID_SERIAL}" shell pm clear-permission-flags \
    "${E2E_APP_ID}" "${permission}" user-set user-fixed
done
adb -s "${ANDROID_SERIAL}" shell dumpsys package "${E2E_APP_ID}" \
  >"${E2E_ARTIFACT_DIR}/android-package-after-location-reset.txt"
for permission in android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION; do
  permission_state="$(grep -F "${permission}:" \
    "${E2E_ARTIFACT_DIR}/android-package-after-location-reset.txt" | tail -n 1)"
  if [[ "${permission_state}" != *"granted=false"* ]] \
    || [[ "${permission_state}" == *"USER_SET"* ]] \
    || [[ "${permission_state}" == *"USER_FIXED"* ]]; then
    e2e_log "Location permission reset is not a fresh, revocable denial precondition: ${permission_state:-missing}."
    exit 2
  fi
done
adb -s "${ANDROID_SERIAL}" shell am force-stop "${E2E_APP_ID}"
adb -s "${ANDROID_SERIAL}" shell am start -W \
  -a android.intent.action.VIEW \
  -d "${E2E_DEV_CLIENT_URL}" \
  "${E2E_APP_ID}" | tee "${E2E_ARTIFACT_DIR}/android-location-relaunch.log"
ANDROID_OWNER_CHECKIN_COUNT_BEFORE="$(
  cd "${E2E_ROOT_DIR}/apps/server"
  uv run python manage.py shell --verbosity 0 -c '
from core.models import CheckIn

print(CheckIn.objects.filter(profile__owner__email="e2e.owner@hlasimse.invalid").count())
'
)"
if [[ ! "${ANDROID_OWNER_CHECKIN_COUNT_BEFORE}" =~ ^[0-9]+$ ]]; then
  e2e_log "Could not establish the owner check-in count before location denial."
  exit 2
fi
e2e_run_flow "${ANDROID_SERIAL}" 07_android_location_denied
(
  cd "${E2E_ROOT_DIR}/apps/server"
  E2E_CHECKIN_COUNT_BEFORE="${ANDROID_OWNER_CHECKIN_COUNT_BEFORE}" uv run python manage.py shell --verbosity 0 -c '
import os

from core.models import CheckIn

owner_check_ins = CheckIn.objects.filter(profile__owner__email="e2e.owner@hlasimse.invalid")
count_before = int(os.environ["E2E_CHECKIN_COUNT_BEFORE"])
count_after = owner_check_ins.count()
assert count_after == count_before + 1, (
    f"Android location-denial flow created {count_after - count_before} check-ins instead of exactly one"
)
check_in = owner_check_ins.order_by("-accepted_at").first()
assert check_in is not None, "Android location-denial flow did not create a check-in"
assert check_in.latitude is None, "Denied location unexpectedly stored latitude"
assert check_in.longitude is None, "Denied location unexpectedly stored longitude"
assert check_in.location_accuracy_meters is None, "Denied location unexpectedly stored accuracy"
print(
    f"check_in_count_before={count_before} check_in_count_after={count_after} "
    f"latest_check_in={check_in.id} accepted_without_location=true"
)
'
) | tee "${E2E_ARTIFACT_DIR}/backend/android-location-denial-assertion.log"

e2e_run_flow "${ANDROID_SERIAL}" 10_owner_online_core
e2e_run_flow "${ANDROID_SERIAL}" 15a_android_profile_focus_name
android_input_text "E2E Druhy profil" "profile name"
e2e_run_flow "${ANDROID_SERIAL}" 15b_android_profile_after_name

e2e_log "Stopping only the owned backend PID for the deterministic API-outage check."
e2e_stop_backend
e2e_run_flow "${ANDROID_SERIAL}" 20_owner_offline_queue
e2e_start_backend
e2e_run_flow "${ANDROID_SERIAL}" 30_owner_offline_sync

e2e_run_flow "${ANDROID_SERIAL}" 40_owner_export
e2e_run_flow "${ANDROID_SERIAL}" 90a_android_delete_focus_password
android_input_text "${E2E_RUN_CREDENTIAL}" "account deletion credential"
e2e_run_flow "${ANDROID_SERIAL}" 90b_android_delete_after_password
e2e_seed_dataset free-boundaries boundary-seed.json
e2e_run_flow "${ANDROID_SERIAL}" 95a_android_boundaries_focus_email
android_input_text "${E2E_OWNER_EMAIL}" "boundary owner email"
e2e_run_flow "${ANDROID_SERIAL}" 95b_android_boundaries_focus_password
android_input_text "${E2E_RUN_CREDENTIAL}" "boundary owner credential"
e2e_run_flow "${ANDROID_SERIAL}" 95c_android_boundaries_after_login
e2e_seed_dataset cleanup-only cleanup.json
