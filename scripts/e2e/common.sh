#!/usr/bin/env bash

set -Eeuo pipefail

E2E_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_NODE_PATH="${E2E_ROOT_DIR}/apps/mobile/node_modules:${E2E_ROOT_DIR}/node_modules"
if [[ -n "${NODE_PATH:-}" ]]; then
  E2E_NODE_PATH="${E2E_NODE_PATH}:${NODE_PATH}"
fi
E2E_MAESTRO_BIN="${E2E_MAESTRO_BIN:-/Users/tomasmach/.maestro/bin/maestro}"
E2E_ARTIFACT_DIR="${E2E_ARTIFACT_DIR:-/tmp/hlasimse-e2e/$(date -u +%Y%m%dT%H%M%SZ)}"
E2E_OWNER_EMAIL="e2e.owner@hlasimse.invalid"
E2E_GUARDIAN_EMAIL="e2e.guardian@hlasimse.invalid"
unset E2E_RUN_CREDENTIAL || true
E2E_BACKEND_PID=""
E2E_METRO_PID=""

mkdir -p "${E2E_ARTIFACT_DIR}/backend" "${E2E_ARTIFACT_DIR}/maestro"

e2e_log() {
  printf '[e2e] %s\n' "$*"
}

e2e_require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    e2e_log "Missing required command: $1"
    return 1
  fi
}

e2e_generate_credential() {
  if [[ -z "${E2E_RUN_CREDENTIAL:-}" ]]; then
    E2E_RUN_CREDENTIAL="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))')"
  fi
  if [[ ${#E2E_RUN_CREDENTIAL} -lt 32 ]]; then
    e2e_log "E2E_RUN_CREDENTIAL must contain at least 32 generated characters."
    return 1
  fi
  export E2E_RUN_CREDENTIAL
}

e2e_wait_for_url() {
  local url="$1"
  local attempts="${2:-60}"
  local index
  for ((index = 1; index <= attempts; index += 1)); do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  e2e_log "Timed out waiting for ${url}"
  return 1
}

e2e_assert_backend_port_free() {
  if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
    e2e_log "TCP port 8000 is already in use. Refusing to stop or reuse an unowned server."
    return 1
  fi
}

e2e_prepare_backend() {
  e2e_assert_backend_port_free
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    uv sync --frozen
    uv run python manage.py migrate --noinput
    HLASIMSE_E2E_CREDENTIAL="${E2E_RUN_CREDENTIAL}" uv run python manage.py seed_e2e \
      --confirm-local-e2e \
      --mode guardian-open
  ) | tee "${E2E_ARTIFACT_DIR}/backend/seed.json"
  e2e_start_backend
}

e2e_start_backend() {
  if [[ -n "${E2E_BACKEND_PID}" ]] && kill -0 "${E2E_BACKEND_PID}" 2>/dev/null; then
    e2e_log "Backend already running with PID ${E2E_BACKEND_PID}"
    return 0
  fi
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    exec uv run python manage.py runserver 0.0.0.0:8000 --noreload
  ) >"${E2E_ARTIFACT_DIR}/backend/server.log" 2>&1 &
  E2E_BACKEND_PID=$!
  e2e_wait_for_url "http://127.0.0.1:8000/health/ready/" 60
  e2e_log "Backend ready with PID ${E2E_BACKEND_PID}"
}

e2e_stop_backend() {
  if [[ -n "${E2E_BACKEND_PID}" ]] && kill -0 "${E2E_BACKEND_PID}" 2>/dev/null; then
    kill "${E2E_BACKEND_PID}"
    wait "${E2E_BACKEND_PID}" 2>/dev/null || true
  fi
  E2E_BACKEND_PID=""
  if curl --fail --silent "http://127.0.0.1:8000/health/live/" >/dev/null 2>&1; then
    e2e_log "Port 8000 still serves after stopping the owned PID; refusing offline test."
    return 1
  fi
}

e2e_start_metro() {
  local api_url="$1"
  if curl --fail --silent "http://127.0.0.1:8081/status" 2>/dev/null | grep -q 'packager-status:running'; then
    if [[ "${E2E_REUSE_METRO:-false}" == "true" ]]; then
      e2e_log "Reusing Metro on 8081 by explicit request; caller is responsible for API URL ${api_url}."
      return 0
    fi
    e2e_log "Metro already owns 8081. Refusing an unverifiable bundle; stop it or explicitly set E2E_REUSE_METRO=true."
    return 1
  fi
  (
    cd "${E2E_ROOT_DIR}/apps/mobile"
    NODE_PATH="${E2E_NODE_PATH}" EXPO_PUBLIC_API_URL="${api_url}" EXPO_NO_TELEMETRY=1 CI=1 \
      exec npx expo start --dev-client --clear --port 8081
  ) >"${E2E_ARTIFACT_DIR}/metro.log" 2>&1 &
  E2E_METRO_PID=$!
  e2e_wait_for_url "http://127.0.0.1:8081/status" 90
  e2e_log "Metro ready with PID ${E2E_METRO_PID}"
}

e2e_stop_metro() {
  if [[ -n "${E2E_METRO_PID}" ]] && kill -0 "${E2E_METRO_PID}" 2>/dev/null; then
    kill "${E2E_METRO_PID}"
    wait "${E2E_METRO_PID}" 2>/dev/null || true
  fi
  E2E_METRO_PID=""
}

e2e_app_id() {
  local platform="$1"
  node -e '
    const config = require(process.argv[1]);
    const platform = process.argv[2];
    const value = platform === "ios" ? config.expo.ios.bundleIdentifier : config.expo.android.package;
    if (!value) process.exit(2);
    process.stdout.write(value);
  ' "${E2E_ROOT_DIR}/apps/mobile/app.json" "$platform"
}

e2e_run_flow() {
  local device_id="$1"
  local flow_name="$2"
  local flow_path="${E2E_ROOT_DIR}/.maestro/flows/${flow_name}.yaml"
  local output_root="${E2E_ARTIFACT_DIR}/maestro/${flow_name}"
  local attempt=1
  while ((attempt <= 2)); do
    local output_dir="$output_root"
    if ((attempt > 1)); then
      output_dir="${output_root}/attempt-${attempt}"
    fi
    mkdir -p "$output_dir"
    e2e_log "Running ${flow_name} on ${device_id} (attempt ${attempt}/2)"
    set +e
    "${E2E_MAESTRO_BIN}" test \
      --udid "$device_id" \
      --format JUNIT \
      --output "${output_dir}/report.xml" \
      --debug-output "${output_dir}/debug" \
      --test-output-dir "${output_dir}/artifacts" \
      -e "APP_ID=${E2E_APP_ID}" \
      -e "OWNER_EMAIL=${E2E_OWNER_EMAIL}" \
      -e "GUARDIAN_EMAIL=${E2E_GUARDIAN_EMAIL}" \
      -e "E2E_CREDENTIAL=${E2E_RUN_CREDENTIAL}" \
      "$flow_path" 2>&1 \
      | E2E_REDACTION_VALUE="${E2E_RUN_CREDENTIAL}" node \
        "${E2E_ROOT_DIR}/scripts/e2e/redact-output.mjs" --stream \
      | tee "${output_dir}/maestro.log"
    local maestro_status="${PIPESTATUS[0]}"
    set -e
    E2E_REDACTION_VALUE="${E2E_RUN_CREDENTIAL}" node \
      "${E2E_ROOT_DIR}/scripts/e2e/redact-output.mjs" --directory "$output_dir"
    if [[ "$maestro_status" -eq 0 ]]; then
      return 0
    fi
    if ((attempt == 1)) && grep -Rqs --fixed-strings "Failed to connect to /127.0.0.1:7001" "$output_dir"; then
      e2e_log "Maestro lost its local XCUITest bridge; retrying this flow once with fresh artifacts."
      attempt=$((attempt + 1))
      continue
    fi
    return "$maestro_status"
  done
}

e2e_run_journey() {
  local device_id="$1"
  e2e_run_flow "$device_id" 00_guardian_clean_install
  e2e_run_flow "$device_id" 10_owner_online_core
  e2e_run_flow "$device_id" 15_owner_profile_create

  e2e_log "Stopping only the owned backend PID for the deterministic API-outage check."
  e2e_stop_backend
  e2e_run_flow "$device_id" 20_owner_offline_queue
  e2e_start_backend
  e2e_run_flow "$device_id" 30_owner_offline_sync

  e2e_run_flow "$device_id" 40_owner_export
  e2e_run_flow "$device_id" 90_owner_delete_account
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    uv run python manage.py seed_e2e \
      --confirm-local-e2e \
      --mode cleanup-only
  ) | tee "${E2E_ARTIFACT_DIR}/backend/cleanup.json"
}

e2e_cleanup() {
  local exit_code=$?
  if [[ $# -gt 0 ]]; then
    exit_code="$1"
  fi
  e2e_stop_backend || true
  e2e_stop_metro || true
  {
    printf 'finished_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'exit_code=%s\n' "$exit_code"
    printf 'git_commit=%s\n' "$(git -C "${E2E_ROOT_DIR}" rev-parse HEAD)"
  } >"${E2E_ARTIFACT_DIR}/run.properties"
  e2e_log "Artifacts: ${E2E_ARTIFACT_DIR}"
  return "$exit_code"
}
