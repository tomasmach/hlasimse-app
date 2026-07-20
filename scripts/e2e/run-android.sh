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
e2e_require uv
[[ -x "${E2E_MAESTRO_BIN}" ]] || { e2e_log "Maestro not executable: ${E2E_MAESTRO_BIN}"; exit 1; }
e2e_generate_credential

ANDROID_AVD_NAME="${ANDROID_AVD_NAME:-${1:-Medium_Phone_API_36.1}}"
ANDROID_SERIAL="${ANDROID_SERIAL:-}"
E2E_EMULATOR_PID=""

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

android_cleanup() {
  local exit_code=$?
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

E2E_APP_ID="$(e2e_app_id android)"
export E2E_APP_ID
e2e_log "Android AVD: ${ANDROID_AVD_NAME}; serial: ${ANDROID_SERIAL}; app ID: ${E2E_APP_ID}"
e2e_log "Artifact directory: ${E2E_ARTIFACT_DIR}"
e2e_prepare_backend
e2e_start_metro "http://10.0.2.2:8000"

(
  cd "${E2E_ROOT_DIR}/apps/mobile"
  NODE_PATH="${E2E_NODE_PATH}" EXPO_PUBLIC_API_URL="http://10.0.2.2:8000" EXPO_NO_TELEMETRY=1 \
    npx expo run:android --device "${ANDROID_SERIAL}" --no-bundler
) 2>&1 | tee "${E2E_ARTIFACT_DIR}/android-build.log"

e2e_run_journey "${ANDROID_SERIAL}"
