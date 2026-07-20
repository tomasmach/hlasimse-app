#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
trap e2e_cleanup EXIT

e2e_require curl
e2e_require lsof
e2e_require node
e2e_require npx
e2e_require uv
e2e_require xcrun
[[ -x "${E2E_MAESTRO_BIN}" ]] || { e2e_log "Maestro not executable: ${E2E_MAESTRO_BIN}"; exit 1; }
e2e_generate_credential

IOS_SIMULATOR_UDID="${IOS_SIMULATOR_UDID:-${1:-}}"
if [[ -z "${IOS_SIMULATOR_UDID}" ]]; then
  e2e_log "Set IOS_SIMULATOR_UDID or pass the exact simulator UDID as the first argument."
  exit 2
fi
if ! xcrun simctl list devices available | grep -Fq "${IOS_SIMULATOR_UDID}"; then
  e2e_log "Available iOS simulator not found for UDID ${IOS_SIMULATOR_UDID}."
  exit 2
fi

E2E_APP_ID="$(e2e_app_id ios)"
export E2E_APP_ID
e2e_log "iOS app ID: ${E2E_APP_ID}"
e2e_log "Artifact directory: ${E2E_ARTIFACT_DIR}"

xcrun simctl boot "${IOS_SIMULATOR_UDID}" 2>/dev/null || true
xcrun simctl bootstatus "${IOS_SIMULATOR_UDID}" -b
e2e_prepare_backend
e2e_start_metro "http://127.0.0.1:8000"

(
  cd "${E2E_ROOT_DIR}/apps/mobile"
  NODE_PATH="${E2E_NODE_PATH}" EXPO_PUBLIC_API_URL="http://127.0.0.1:8000" EXPO_NO_TELEMETRY=1 \
    npx expo run:ios --device "${IOS_SIMULATOR_UDID}" --no-bundler
) 2>&1 | tee "${E2E_ARTIFACT_DIR}/ios-build.log"

e2e_run_journey "${IOS_SIMULATOR_UDID}"
