#!/usr/bin/env bash

set -Eeuo pipefail

E2E_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
E2E_NODE_PATH="${E2E_ROOT_DIR}/apps/mobile/node_modules:${E2E_ROOT_DIR}/node_modules"
if [[ -n "${NODE_PATH:-}" ]]; then
  E2E_NODE_PATH="${E2E_NODE_PATH}:${NODE_PATH}"
fi
E2E_MAESTRO_BIN="${E2E_MAESTRO_BIN:-$(command -v maestro || true)}"
E2E_REQUIRED_MAESTRO_VERSION="${E2E_REQUIRED_MAESTRO_VERSION:-2.6.1}"
E2E_MAESTRO_VERSION=""
E2E_ARTIFACT_DIR="${E2E_ARTIFACT_DIR:-/tmp/hlasimse-e2e/$(date -u +%Y%m%dT%H%M%SZ)}"
E2E_OWNER_EMAIL="e2e.owner@hlasimse.invalid"
E2E_GUARDIAN_EMAIL="e2e.guardian@hlasimse.invalid"
E2E_DEV_CLIENT_URL="${E2E_DEV_CLIENT_URL:-}"
E2E_DJANGO_ALLOWED_HOSTS="${E2E_DJANGO_ALLOWED_HOSTS:-localhost,127.0.0.1}"
E2E_RUN_MODE="${E2E_RUN_MODE:-full}"
E2E_PLATFORM=""
E2E_SOURCE_ROOT_DIR="${E2E_SOURCE_ROOT_DIR:-${E2E_ROOT_DIR}}"
E2E_SOURCE_CLEAN_START="unknown"
E2E_GIT_COMMIT_START=""
E2E_GIT_TREE_START=""
E2E_RUN_PROPERTIES="${E2E_ARTIFACT_DIR}/run.properties"
E2E_RUN_PROPERTIES_STAGING="${E2E_ARTIFACT_DIR}/run.properties.partial"
E2E_METADATA_INITIALIZED="false"
E2E_JOURNEY_COMPLETED="false"
unset E2E_RUN_CREDENTIAL || true
E2E_BACKEND_PID=""
E2E_METRO_PID=""
E2E_AT08_PROFILE_ID=""
E2E_AT08_INCIDENT_ID=""

# Release evidence is valid only when every runtime/release input below comes
# from the recorded Git tree. Deliberately exclude unrelated root documents so
# a user's local legal/launch drafts cannot invalidate simulator evidence.
E2E_SOURCE_PATHS=(
  "apps/mobile"
  "apps/server"
  ".maestro"
  "scripts/e2e"
  "package.json"
  "package-lock.json"
  "compose.production.yml"
  "README.md"
  "docs/store"
  "scripts/check-public-contract.mjs"
  "scripts/check-public-contract.test.mjs"
  "scripts/public-contract-manifest.json"
  "scripts/fixtures/public-contract"
  ".github/workflows/ci.yml"
)

mkdir -p "${E2E_ARTIFACT_DIR}/backend" "${E2E_ARTIFACT_DIR}/maestro"

source "${E2E_ROOT_DIR}/scripts/e2e/postgres.sh"

e2e_log() {
  printf '[e2e] %s\n' "$*"
}

e2e_require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    e2e_log "Missing required command: $1"
    return 1
  fi
}

e2e_record_property() {
  local key="$1"
  local value="$2"
  if [[ ! "${key}" =~ ^[a-z0-9_]+$ ]]; then
    e2e_log "Refusing invalid run metadata key: ${key}"
    return 1
  fi
  if [[ "${key}" =~ (credential|password|secret|token) ]]; then
    e2e_log "Refusing secret-bearing run metadata key: ${key}"
    return 1
  fi
  if [[ "${value}" == *$'\n'* ]] || [[ "${value}" == *$'\r'* ]]; then
    e2e_log "Refusing multiline run metadata value for ${key}."
    return 1
  fi
  printf '%s=%s\n' "${key}" "${value}" >>"${E2E_RUN_PROPERTIES_STAGING}"
}

e2e_finalize_run_properties() {
  local duplicate_keys
  local sorted_properties
  local credential_scan_status
  if [[ ! -f "${E2E_RUN_PROPERTIES_STAGING}" ]]; then
    e2e_log "Run metadata staging file is missing."
    return 1
  fi
  if ! duplicate_keys="$(cut -d= -f1 "${E2E_RUN_PROPERTIES_STAGING}" | LC_ALL=C sort | uniq -d)"; then
    e2e_log "Failed to inspect run metadata keys."
    return 1
  fi
  if [[ -n "${duplicate_keys}" ]]; then
    e2e_log "Refusing duplicate run metadata keys: ${duplicate_keys//$'\n'/, }."
    return 1
  fi
  if [[ -n "${E2E_RUN_CREDENTIAL:-}" ]]; then
    if grep -Fq -- "${E2E_RUN_CREDENTIAL}" "${E2E_RUN_PROPERTIES_STAGING}"; then
      credential_scan_status=0
    else
      credential_scan_status=$?
    fi
    if [[ "${credential_scan_status}" -eq 0 ]]; then
      e2e_log "Refusing to publish run metadata containing the generated credential."
      return 1
    fi
    if [[ "${credential_scan_status}" -ne 1 ]]; then
      e2e_log "Failed to scan run metadata for the generated credential."
      return 1
    fi
  fi
  if ! sorted_properties="$(mktemp "${E2E_ARTIFACT_DIR}/run.properties.sorted.XXXXXX")"; then
    e2e_log "Failed to allocate sorted run metadata staging."
    return 1
  fi
  if ! LC_ALL=C sort -t= -k1,1 "${E2E_RUN_PROPERTIES_STAGING}" >"${sorted_properties}"; then
    rm -f -- "${sorted_properties}" || true
    e2e_log "Failed to sort run metadata."
    return 1
  fi
  if ! mv -f -- "${sorted_properties}" "${E2E_RUN_PROPERTIES_STAGING}"; then
    rm -f -- "${sorted_properties}" || true
    e2e_log "Failed to replace run metadata staging with its sorted form."
    return 1
  fi
  if ! mv -f -- "${E2E_RUN_PROPERTIES_STAGING}" "${E2E_RUN_PROPERTIES}"; then
    e2e_log "Failed to publish finalized run metadata."
    return 1
  fi
}

e2e_capture_source_status() {
  local phase="$1"
  git -C "${E2E_SOURCE_ROOT_DIR}" status --short --untracked-files=all -- \
    "${E2E_SOURCE_PATHS[@]}" >"${E2E_ARTIFACT_DIR}/source-status-${phase}.txt"
}

e2e_source_is_clean() {
  local phase="$1"
  local untracked
  if ! e2e_capture_source_status "${phase}"; then
    return 1
  fi
  if ! git -C "${E2E_SOURCE_ROOT_DIR}" diff --quiet -- "${E2E_SOURCE_PATHS[@]}"; then
    return 1
  fi
  if ! git -C "${E2E_SOURCE_ROOT_DIR}" diff --cached --quiet -- "${E2E_SOURCE_PATHS[@]}"; then
    return 1
  fi
  if ! untracked="$(git -C "${E2E_SOURCE_ROOT_DIR}" ls-files --others --exclude-standard -- \
    "${E2E_SOURCE_PATHS[@]}")"; then
    return 1
  fi
  [[ -z "${untracked}" ]]
}

e2e_app_version() {
  node -e '
    const config = require(process.argv[1]);
    if (!config.expo.version) process.exit(2);
    process.stdout.write(String(config.expo.version));
  ' "${E2E_ROOT_DIR}/apps/mobile/app.json"
}

e2e_app_build() {
  local platform="$1"
  node -e '
    const config = require(process.argv[1]);
    const platform = process.argv[2];
    const value = platform === "ios" ? config.expo.ios.buildNumber : config.expo.android.versionCode;
    if (value === undefined || value === null || value === "") process.exit(2);
    process.stdout.write(String(value));
  ' "${E2E_ROOT_DIR}/apps/mobile/app.json" "${platform}"
}

e2e_initialize_run_metadata() {
  local platform="$1"
  local app_id="$2"
  local source_clean="false"
  if [[ -e "${E2E_RUN_PROPERTIES}" ]] || [[ -e "${E2E_RUN_PROPERTIES_STAGING}" ]]; then
    e2e_log "Artifact directory already contains run metadata; refusing to overwrite evidence."
    return 1
  fi
  E2E_PLATFORM="${platform}"
  E2E_GIT_COMMIT_START="$(git -C "${E2E_ROOT_DIR}" rev-parse HEAD)"
  E2E_GIT_TREE_START="$(git -C "${E2E_ROOT_DIR}" rev-parse 'HEAD^{tree}')"
  : >"${E2E_RUN_PROPERTIES_STAGING}"
  E2E_METADATA_INITIALIZED="true"
  e2e_record_property started_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  e2e_record_property git_commit "${E2E_GIT_COMMIT_START}"
  e2e_record_property git_tree "${E2E_GIT_TREE_START}"
  e2e_record_property run_mode "${E2E_RUN_MODE}"
  e2e_record_property platform "${platform}"
  e2e_record_property app_id "${app_id}"
  e2e_record_property app_version "$(e2e_app_version)"
  e2e_record_property app_build "$(e2e_app_build "${platform}")"
  e2e_record_property maestro_version "${E2E_MAESTRO_VERSION}"
  e2e_record_property db_vendor "postgresql"

  if e2e_source_is_clean start; then
    source_clean="true"
  fi
  E2E_SOURCE_CLEAN_START="${source_clean}"
  e2e_record_property source_clean_start "${source_clean}"
  if [[ "${source_clean}" != "true" ]]; then
    e2e_log "Runtime/release inputs are dirty. Refusing to create evidence; inspect ${E2E_ARTIFACT_DIR}/source-status-start.txt."
    return 1
  fi
}

e2e_require_maestro_version() {
  local actual_version
  local required_version="${E2E_REQUIRED_MAESTRO_VERSION}"

  actual_version="$("${E2E_MAESTRO_BIN}" --version | tr -d '\r' | head -n 1)"
  if [[ ! "${actual_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    e2e_log "Could not parse Maestro version: ${actual_version}"
    return 1
  fi
  if [[ ! "${required_version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    e2e_log "Invalid E2E_REQUIRED_MAESTRO_VERSION: ${required_version}"
    return 1
  fi
  if [[ "${actual_version}" != "${required_version}" ]] && [[ "${E2E_ALLOW_UNTESTED_MAESTRO:-false}" != "true" ]]; then
    e2e_log "Maestro ${required_version} is required; found ${actual_version}. Set E2E_ALLOW_UNTESTED_MAESTRO=true only for an explicit compatibility run."
    return 1
  fi
  E2E_MAESTRO_VERSION="${actual_version}"
  export E2E_MAESTRO_VERSION
  e2e_log "Using Maestro ${actual_version}; tested release version is ${required_version}."
}

e2e_generate_credential() {
  if [[ -z "${E2E_RUN_CREDENTIAL:-}" ]]; then
    E2E_RUN_CREDENTIAL="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
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
  e2e_start_postgres
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    uv sync --frozen
    uv run python manage.py migrate --noinput
  )
  e2e_assert_postgres_backend
  e2e_seed_dataset guardian-open seed.json
  e2e_start_backend
}

e2e_seed_dataset() {
  local mode="$1"
  local artifact_name="$2"
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    HLASIMSE_E2E_CREDENTIAL="${E2E_RUN_CREDENTIAL}" uv run python manage.py seed_e2e \
      --confirm-local-e2e \
      --mode "$mode"
  ) | tee "${E2E_ARTIFACT_DIR}/backend/${artifact_name}"
}

e2e_start_backend() {
  if [[ -n "${E2E_BACKEND_PID}" ]] && kill -0 "${E2E_BACKEND_PID}" 2>/dev/null; then
    e2e_log "Backend already running with PID ${E2E_BACKEND_PID}"
    return 0
  fi
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    export DJANGO_ALLOWED_HOSTS="${E2E_DJANGO_ALLOWED_HOSTS}"
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
  local evidence_key="${3:-$flow_name}"
  local flow_path="${E2E_ROOT_DIR}/.maestro/flows/${flow_name}.yaml"
  local output_root="${E2E_ARTIFACT_DIR}/maestro/${evidence_key}"
  local output_dir="$output_root"
  if [[ ! "${evidence_key}" =~ ^[A-Za-z0-9_-]+$ ]]; then
    e2e_log "Refusing invalid flow evidence key: ${evidence_key}."
    return 1
  fi
  if [[ -e "${output_root}" ]]; then
    e2e_log "Refusing to overwrite existing flow evidence: ${output_root}."
    return 1
  fi
  mkdir -p "$output_dir"
  e2e_log "Running ${flow_name} as ${evidence_key} on ${device_id} (single attempt; mutating flows are never replayed)."
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
    -e "DEV_CLIENT_URL=${E2E_DEV_CLIENT_URL}" \
    "$flow_path" 2>&1 \
    | E2E_REDACTION_VALUE="${E2E_RUN_CREDENTIAL}" node \
      "${E2E_ROOT_DIR}/scripts/e2e/redact-output.mjs" --stream \
    | tee "${output_dir}/maestro.log"
  local maestro_status="${PIPESTATUS[0]}"
  set -e
  E2E_REDACTION_VALUE="${E2E_RUN_CREDENTIAL}" node \
    "${E2E_ROOT_DIR}/scripts/e2e/redact-output.mjs" --directory "$output_dir"
  return "$maestro_status"
}

e2e_resolve_at08_profile_id() {
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    uv run python manage.py shell --verbosity 0 -c '
from core.models import CheckInProfile

profiles = list(
    CheckInProfile.objects.filter(
        owner__email="e2e.owner@hlasimse.invalid",
        archived_at__isnull=True,
        enabled=True,
        is_paused=False,
    ).order_by("created_at", "id")
)
assert 2 <= len(profiles) <= 3, (
    f"AT-08 requires the baseline and selected profile, plus only the optional Android update sentinel; found {len(profiles)}"
)
selected = profiles[-1]
assert selected.interval_seconds == 3600, "AT-08 selected profile is not at the production minimum"
assert not selected.guardians.exists(), "AT-08 selected profile unexpectedly has a guardian"
print(selected.id)
'
  )
}

e2e_open_at08_incident() {
  E2E_AT08_PROFILE_ID="$(e2e_resolve_at08_profile_id)"
  if [[ ! "${E2E_AT08_PROFILE_ID}" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    e2e_log "Could not resolve the exact AT-08 profile identity."
    return 1
  fi
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    HLASIMSE_E2E_CREDENTIAL="${E2E_RUN_CREDENTIAL}" \
      uv run python manage.py exercise_e2e_offline_deadline \
        --confirm-local-e2e \
        --phase open-incident \
        --profile-id "${E2E_AT08_PROFILE_ID}"
  ) | tee "${E2E_ARTIFACT_DIR}/backend/at08-incident-opened.json"
  E2E_AT08_INCIDENT_ID="$(node -e '
const fs = require("node:fs");
const evidence = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.stdout.write(String(evidence.incident_id || ""));
' "${E2E_ARTIFACT_DIR}/backend/at08-incident-opened.json")"
  if [[ ! "${E2E_AT08_INCIDENT_ID}" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    e2e_log "AT-08 open evidence did not return an exact incident identity."
    return 1
  fi
}

e2e_verify_at08_resolution() {
  if [[ ! "${E2E_AT08_PROFILE_ID}" =~ ^[0-9a-fA-F-]{36}$ ]] \
    || [[ ! "${E2E_AT08_INCIDENT_ID}" =~ ^[0-9a-fA-F-]{36}$ ]]; then
    e2e_log "AT-08 identities are missing before resolution verification."
    return 1
  fi
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    HLASIMSE_E2E_CREDENTIAL="${E2E_RUN_CREDENTIAL}" \
      uv run python manage.py exercise_e2e_offline_deadline \
        --confirm-local-e2e \
        --phase verify-resolution \
        --profile-id "${E2E_AT08_PROFILE_ID}" \
        --incident-id "${E2E_AT08_INCIDENT_ID}"
  ) | tee "${E2E_ARTIFACT_DIR}/backend/at08-incident-resolved.json"
  node "${E2E_ROOT_DIR}/scripts/e2e/assert-at08-evidence.mjs" \
    "${E2E_ARTIFACT_DIR}" \
    "${E2E_ROOT_DIR}/apps/mobile/lib/offlineQueue.ts" \
    | tee "${E2E_ARTIFACT_DIR}/backend/at08-evidence.json"
}

e2e_run_at08_offline_deadline() {
  local device_id="$1"
  e2e_log "Stopping only the owned backend PID for the deterministic AT-08 API outage."
  e2e_stop_backend
  e2e_run_flow "${device_id}" 20_owner_offline_queue
  e2e_open_at08_incident
  e2e_run_flow "${device_id}" 25_owner_offline_deadline_pending
  e2e_start_backend
  e2e_run_flow "${device_id}" 30_owner_offline_sync
  e2e_verify_at08_resolution
}

e2e_run_journey() {
  local device_id="$1"
  e2e_run_flow "$device_id" 00_guardian_clean_install
  e2e_run_flow "$device_id" 10_owner_online_core
  e2e_run_flow "$device_id" 15_owner_profile_create

  e2e_run_at08_offline_deadline "$device_id"

  e2e_run_flow "$device_id" 40_owner_export
  e2e_run_flow "$device_id" 90_owner_delete_account
  e2e_seed_dataset free-boundaries boundary-seed.json
  e2e_run_flow "$device_id" 95_owner_free_boundaries
  e2e_seed_dataset cleanup-only cleanup.json
}

e2e_cleanup() {
  local exit_code=$?
  local journey_completed="false"
  local source_clean_end="false"
  local git_commit_end
  local git_tree_end
  local backend_cleanup_completed="true"
  local metro_cleanup_completed="true"
  local postgres_cleanup_completed="true"
  local metadata_write_failed="false"
  local finished_at
  if [[ $# -gt 0 ]]; then
    exit_code="$1"
  fi
  if [[ "${E2E_JOURNEY_COMPLETED:-false}" == "true" ]]; then
    journey_completed="true"
  else
    e2e_log "The release journey did not reach its explicit completion marker."
    if [[ "${exit_code}" -eq 0 ]]; then
      exit_code=1
    fi
  fi
  if ! e2e_stop_backend; then
    backend_cleanup_completed="false"
  fi
  if ! e2e_stop_metro; then
    metro_cleanup_completed="false"
  fi
  if ! e2e_stop_postgres; then
    postgres_cleanup_completed="false"
  fi
  if [[ "${backend_cleanup_completed}" != "true" ]] \
    || [[ "${metro_cleanup_completed}" != "true" ]] \
    || [[ "${postgres_cleanup_completed}" != "true" ]]; then
    e2e_log "Owned service cleanup did not complete; the run cannot be accepted as evidence."
    if [[ "${exit_code}" -eq 0 ]]; then
      exit_code=1
    fi
  fi
  if [[ "${E2E_METADATA_INITIALIZED}" != "true" ]]; then
    e2e_log "Run metadata was not initialized; no evidence file was published."
    if [[ "${exit_code}" -eq 0 ]]; then
      exit_code=1
    fi
    e2e_log "Artifacts: ${E2E_ARTIFACT_DIR}"
    return "${exit_code}"
  fi
  if ! e2e_record_property backend_cleanup_completed "${backend_cleanup_completed}"; then
    metadata_write_failed="true"
  fi
  if ! e2e_record_property metro_cleanup_completed "${metro_cleanup_completed}"; then
    metadata_write_failed="true"
  fi
  if ! e2e_record_property postgres_cleanup_completed "${postgres_cleanup_completed}"; then
    metadata_write_failed="true"
  fi
  if ! git_commit_end="$(git -C "${E2E_ROOT_DIR}" rev-parse HEAD)"; then
    git_commit_end="unavailable"
  fi
  if ! git_tree_end="$(git -C "${E2E_ROOT_DIR}" rev-parse 'HEAD^{tree}')"; then
    git_tree_end="unavailable"
  fi
  if ! e2e_record_property git_commit_end "${git_commit_end}"; then
    metadata_write_failed="true"
  fi
  if ! e2e_record_property git_tree_end "${git_tree_end}"; then
    metadata_write_failed="true"
  fi
  if e2e_source_is_clean end \
    && [[ "${git_commit_end}" == "${E2E_GIT_COMMIT_START}" ]] \
    && [[ "${git_tree_end}" == "${E2E_GIT_TREE_START}" ]]; then
    source_clean_end="true"
  fi
  if ! e2e_record_property source_clean_end "${source_clean_end}"; then
    metadata_write_failed="true"
  fi
  if ! e2e_record_property journey_completed "${journey_completed}"; then
    metadata_write_failed="true"
  fi
  if [[ "${E2E_SOURCE_CLEAN_START}" != "true" ]] || [[ "${source_clean_end}" != "true" ]]; then
    e2e_log "Source traceability failed (start=${E2E_SOURCE_CLEAN_START}, end=${source_clean_end})."
    if [[ "${exit_code}" -eq 0 ]]; then
      exit_code=1
    fi
  fi
  if finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"; then
    if ! e2e_record_property finished_at "${finished_at}"; then
      metadata_write_failed="true"
    fi
  else
    e2e_log "Failed to capture the evidence completion timestamp."
    metadata_write_failed="true"
  fi
  if [[ -n "${E2E_RUN_CREDENTIAL:-}" ]]; then
    if ! E2E_REDACTION_VALUE="${E2E_RUN_CREDENTIAL}" node \
      "${E2E_ROOT_DIR}/scripts/e2e/redact-output.mjs" --directory "${E2E_ARTIFACT_DIR}"; then
      e2e_log "Artifact redaction failed; the run cannot be accepted as evidence."
      if [[ "${exit_code}" -eq 0 ]]; then
        exit_code=1
      fi
    fi
  fi
  if [[ "${metadata_write_failed}" == "true" ]]; then
    e2e_log "Required cleanup metadata could not be recorded; evidence will not be published."
    if [[ "${exit_code}" -eq 0 ]]; then
      exit_code=1
    fi
  fi
  if ! e2e_record_property exit_code "${exit_code}"; then
    metadata_write_failed="true"
    if [[ "${exit_code}" -eq 0 ]]; then
      exit_code=1
    fi
  fi
  if [[ "${metadata_write_failed}" == "true" ]]; then
    e2e_log "Atomic run metadata finalization skipped because required metadata is incomplete."
    e2e_log "Artifacts: ${E2E_ARTIFACT_DIR}"
    return "${exit_code}"
  fi
  if ! e2e_finalize_run_properties; then
    e2e_log "Atomic run metadata finalization failed."
    if [[ "${exit_code}" -eq 0 ]]; then
      exit_code=1
    fi
  fi
  e2e_log "Artifacts: ${E2E_ARTIFACT_DIR}"
  return "$exit_code"
}
