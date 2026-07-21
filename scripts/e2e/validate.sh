#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "${ROOT_DIR}/scripts/e2e/common.sh"
bash -n "${ROOT_DIR}/scripts/e2e/postgres.sh"
bash -n "${ROOT_DIR}/scripts/e2e/run-ios.sh"
bash -n "${ROOT_DIR}/scripts/e2e/run-android.sh"
node --check "${ROOT_DIR}/scripts/e2e/redact-output.mjs"
node --check "${ROOT_DIR}/scripts/e2e/assert-junit-evidence.mjs"
node --check "${ROOT_DIR}/scripts/e2e/assert-at08-evidence.mjs"
node --check "${ROOT_DIR}/apps/mobile/plugins/with-android-e2e-build.js"
NODE_PATH="${ROOT_DIR}/apps/mobile/node_modules:${ROOT_DIR}/node_modules" \
  node -e 'require.resolve("expo-router/_ctx-shared"); require.resolve("expo-secure-store")'

VALIDATION_DIR="$(mktemp -d "${TMPDIR:-/tmp}/hlasimse-e2e-validate.XXXXXX")"
cleanup_validation() {
  rm -r -- "${VALIDATION_DIR}"
}
trap cleanup_validation EXIT
REDACTION_FIXTURE="${VALIDATION_DIR}/redaction"
mkdir -p "${REDACTION_FIXTURE}"
printf 'safe_value=validation-redaction-sentinel\n' >"${REDACTION_FIXTURE}/run.properties.partial"
E2E_REDACTION_VALUE="validation-redaction-sentinel" node \
  "${ROOT_DIR}/scripts/e2e/redact-output.mjs" --directory "${REDACTION_FIXTURE}"
grep -Fxq 'safe_value=[REDACTED-RUN-CREDENTIAL]' \
  "${REDACTION_FIXTURE}/run.properties.partial"

JUNIT_FIXTURE="${VALIDATION_DIR}/junit"
for key in flow_one flow_two; do
  mkdir -p "${JUNIT_FIXTURE}/maestro/${key}"
  printf '%s\n' '<testsuites><testsuite tests="1" failures="0"><testcase status="SUCCESS" /></testsuite></testsuites>' \
    >"${JUNIT_FIXTURE}/maestro/${key}/report.xml"
  printf 'redacted log\n' >"${JUNIT_FIXTURE}/maestro/${key}/maestro.log"
done
node "${ROOT_DIR}/scripts/e2e/assert-junit-evidence.mjs" "${JUNIT_FIXTURE}" flow_one flow_two \
  >"${JUNIT_FIXTURE}/summary.json"
grep -Fq '"report_count":2' "${JUNIT_FIXTURE}/summary.json"
! node "${ROOT_DIR}/scripts/e2e/assert-junit-evidence.mjs" "${JUNIT_FIXTURE}" flow_one \
  >/dev/null 2>&1

AT08_FIXTURE="${VALIDATION_DIR}/at08"
mkdir -p "${AT08_FIXTURE}/backend"
for key in 20_owner_offline_queue 25_owner_offline_deadline_pending 30_owner_offline_sync; do
  mkdir -p "${AT08_FIXTURE}/maestro/${key}"
  printf '%s\n' '<testsuites><testsuite tests="1" failures="0"><testcase status="SUCCESS" /></testsuite></testsuites>' \
    >"${AT08_FIXTURE}/maestro/${key}/report.xml"
done
printf '%s\n' '{"acceptance_test":"AT-08","schema_version":1,"phase":"incident_opened_while_mobile_pending","profile_id":"11111111-1111-4111-8111-111111111111","deadline_generation":7,"original_deadline_was_future":true,"deadline_forced_past_for_e2e":true,"production_interval_unchanged":true,"profile_interval_seconds":3600,"server_queued_checkin_count":0,"incident_id":"22222222-2222-4222-8222-222222222222","incident_status":"open","opened_audit_id":"33333333-3333-4333-8333-333333333333","opened_audit_system_actor":true,"opened_outbox_id":"44444444-4444-4444-8444-444444444444","opened_outbox_status":"pending","scheduler_incidents_created":1,"scheduler_events_created":1}' \
  >"${AT08_FIXTURE}/backend/at08-incident-opened.json"
printf '%s\n' '{"acceptance_test":"AT-08","schema_version":1,"phase":"exact_incident_resolved_after_api_restart","profile_id":"11111111-1111-4111-8111-111111111111","deadline_generation":7,"incident_id":"22222222-2222-4222-8222-222222222222","incident_status":"resolved","queued_check_in_id":"55555555-5555-4555-8555-555555555555","submitted_from_queue":true,"client_recorded_before_incident":true,"server_accepted_after_incident":true,"opened_audit_id":"33333333-3333-4333-8333-333333333333","resolved_audit_id":"66666666-6666-4666-8666-666666666666","check_in_audit_id":"77777777-7777-4777-8777-777777777777","owner_audit_actor_verified":true,"opened_outbox_id":"44444444-4444-4444-8444-444444444444","resolved_outbox_id":"88888888-8888-4888-8888-888888888888","opened_outbox_preserved":true,"audit_event_types":["incident.opened","incident.resolved","checkin.confirmed"],"outbox_event_types":["alert.opened","alert.resolved"]}' \
  >"${AT08_FIXTURE}/backend/at08-incident-resolved.json"
node "${ROOT_DIR}/scripts/e2e/assert-at08-evidence.mjs" \
  "${AT08_FIXTURE}" "${ROOT_DIR}/apps/mobile/lib/offlineQueue.ts" \
  >"${AT08_FIXTURE}/backend/at08-evidence.json"
grep -Fq '"audit_and_outbox_identity_verified":true' \
  "${AT08_FIXTURE}/backend/at08-evidence.json"
rm -f -- "${AT08_FIXTURE}/maestro/25_owner_offline_deadline_pending/report.xml"
! node "${ROOT_DIR}/scripts/e2e/assert-at08-evidence.mjs" \
  "${AT08_FIXTURE}" "${ROOT_DIR}/apps/mobile/lib/offlineQueue.ts" \
  >/dev/null 2>&1
E2E_ARTIFACT_DIR="${VALIDATION_DIR}" bash -c '
  set -Eeuo pipefail
  source "$1"
  e2e_generate_credential
  [[ ${#E2E_RUN_CREDENTIAL} -ge 32 ]]
  [[ "${E2E_POSTGRES_IMAGE}" == "postgres:18.4-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296" ]]
  [[ "${E2E_POSTGRES_DB}" == *e2e* || "${E2E_POSTGRES_DB}" == *test* ]]
  [[ "${E2E_POSTGRES_USER}" == *e2e* || "${E2E_POSTGRES_USER}" == *test* ]]
  declare -F e2e_start_postgres >/dev/null
  declare -F e2e_assert_postgres_backend >/dev/null
  declare -F e2e_stop_postgres >/dev/null
  declare -F e2e_initialize_run_metadata >/dev/null
  declare -F e2e_source_is_clean >/dev/null
  declare -F e2e_record_property >/dev/null
  declare -F e2e_finalize_run_properties >/dev/null
  declare -F e2e_run_at08_offline_deadline >/dev/null
  declare -F e2e_open_at08_incident >/dev/null
  declare -F e2e_verify_at08_resolution >/dev/null
  ! e2e_record_property access_token forbidden
  e2e_record_property zeta last
  e2e_record_property alpha first
  e2e_finalize_run_properties
  [[ "$(sed -n "1p" "${E2E_RUN_PROPERTIES}")" == "alpha=first" ]]
  [[ "$(sed -n "2p" "${E2E_RUN_PROPERTIES}")" == "zeta=last" ]]
  [[ ! -e "${E2E_RUN_PROPERTIES_STAGING}" ]]
' _ "${ROOT_DIR}/scripts/e2e/common.sh"

for failure_command in mktemp mv; do
  FINALIZATION_FIXTURE="${VALIDATION_DIR}/finalization-${failure_command}"
  E2E_ARTIFACT_DIR="${FINALIZATION_FIXTURE}" FAILURE_COMMAND="${failure_command}" bash -c '
    set -Eeuo pipefail
    source "$1"
    e2e_record_property alpha first
    if [[ "${FAILURE_COMMAND}" == "mktemp" ]]; then
      mktemp() { return 1; }
    else
      mv() { return 1; }
    fi
    set +e
    e2e_finalize_run_properties
    finalization_status=$?
    set -e
    [[ "${finalization_status}" -ne 0 ]]
    [[ -f "${E2E_RUN_PROPERTIES_STAGING}" ]]
    [[ ! -e "${E2E_RUN_PROPERTIES}" ]]
  ' _ "${ROOT_DIR}/scripts/e2e/common.sh"
done

E2E_ARTIFACT_DIR="${VALIDATION_DIR}/finalization-grep" bash -c '
  set -Eeuo pipefail
  source "$1"
  E2E_RUN_CREDENTIAL="validation-credential-sentinel"
  e2e_record_property safe_value "${E2E_RUN_CREDENTIAL}"
  grep() { return 2; }
  set +e
  e2e_finalize_run_properties
  finalization_status=$?
  set -e
  [[ "${finalization_status}" -ne 0 ]]
  [[ -f "${E2E_RUN_PROPERTIES_STAGING}" ]]
  [[ ! -e "${E2E_RUN_PROPERTIES}" ]]
' _ "${ROOT_DIR}/scripts/e2e/common.sh"

SOURCE_FIXTURE="${VALIDATION_DIR}/source-fixture"
mkdir -p "${SOURCE_FIXTURE}/apps/mobile" "${SOURCE_FIXTURE}/apps/server"
printf 'tracked\n' >"${SOURCE_FIXTURE}/apps/mobile/runtime.txt"
git -C "${SOURCE_FIXTURE}" init -q
git -C "${SOURCE_FIXTURE}" config user.email "e2e-validator@hlasimse.invalid"
git -C "${SOURCE_FIXTURE}" config user.name "Hlásím se E2E validator"
git -C "${SOURCE_FIXTURE}" add apps/mobile/runtime.txt
git -C "${SOURCE_FIXTURE}" commit -qm "test fixture"
E2E_ARTIFACT_DIR="${VALIDATION_DIR}/source-artifacts" \
  E2E_SOURCE_ROOT_DIR="${SOURCE_FIXTURE}" bash -c '
    set -Eeuo pipefail
    source "$1"

    # Unrelated user-owned root documents must not invalidate release evidence.
    printf "draft\n" >"${E2E_SOURCE_ROOT_DIR}/PRIVACY_POLICY.md"
    e2e_source_is_clean unrelated-root-doc

    printf "dirty\n" >>"${E2E_SOURCE_ROOT_DIR}/apps/mobile/runtime.txt"
    ! e2e_source_is_clean tracked-diff
    git -C "${E2E_SOURCE_ROOT_DIR}" restore apps/mobile/runtime.txt

    printf "cached\n" >>"${E2E_SOURCE_ROOT_DIR}/apps/mobile/runtime.txt"
    git -C "${E2E_SOURCE_ROOT_DIR}" add apps/mobile/runtime.txt
    ! e2e_source_is_clean cached-diff
    git -C "${E2E_SOURCE_ROOT_DIR}" restore --staged --worktree apps/mobile/runtime.txt

    printf "untracked\n" >"${E2E_SOURCE_ROOT_DIR}/apps/server/new-runtime.py"
    ! e2e_source_is_clean relevant-untracked
  ' _ "${ROOT_DIR}/scripts/e2e/common.sh"

CLEANUP_FIXTURE="${VALIDATION_DIR}/cleanup-fixture"
mkdir -p "${CLEANUP_FIXTURE}/apps/mobile"
printf 'tracked\n' >"${CLEANUP_FIXTURE}/apps/mobile/runtime.txt"
git -C "${CLEANUP_FIXTURE}" init -q
git -C "${CLEANUP_FIXTURE}" config user.email "e2e-validator@hlasimse.invalid"
git -C "${CLEANUP_FIXTURE}" config user.name "Hlásím se E2E validator"
git -C "${CLEANUP_FIXTURE}" add apps/mobile/runtime.txt
git -C "${CLEANUP_FIXTURE}" commit -qm "test fixture"
E2E_ARTIFACT_DIR="${VALIDATION_DIR}/cleanup-artifacts" \
  E2E_SOURCE_ROOT_DIR="${CLEANUP_FIXTURE}" bash -c '
    set -Eeuo pipefail
    source "$1"
    E2E_MAESTRO_VERSION="2.6.1"
    e2e_initialize_run_metadata android "$(e2e_app_id android)"
    printf "dirty during run\n" >>"${E2E_SOURCE_ROOT_DIR}/apps/mobile/runtime.txt"
    set +e
    e2e_cleanup 7
    cleanup_status=$?
    set -e
    [[ "${cleanup_status}" -eq 7 ]]
    [[ "$(grep -c "^source_clean_end=false$" "${E2E_RUN_PROPERTIES}")" -eq 1 ]]
    [[ "$(grep -c "^exit_code=7$" "${E2E_RUN_PROPERTIES}")" -eq 1 ]]
    LC_ALL=C sort -c -t= -k1,1 "${E2E_RUN_PROPERTIES}"
    [[ ! -e "${E2E_RUN_PROPERTIES_STAGING}" ]]
    ! grep -Eq "^[^=]*(credential|password|secret|token)[^=]*=" "${E2E_RUN_PROPERTIES}"
  ' _ "${ROOT_DIR}/scripts/e2e/common.sh"

COMPLETION_FIXTURE="${VALIDATION_DIR}/completion-fixture"
mkdir -p "${COMPLETION_FIXTURE}/apps/mobile"
printf 'tracked\n' >"${COMPLETION_FIXTURE}/apps/mobile/runtime.txt"
git -C "${COMPLETION_FIXTURE}" init -q
git -C "${COMPLETION_FIXTURE}" config user.email "e2e-validator@hlasimse.invalid"
git -C "${COMPLETION_FIXTURE}" config user.name "Hlásím se E2E validator"
git -C "${COMPLETION_FIXTURE}" add apps/mobile/runtime.txt
git -C "${COMPLETION_FIXTURE}" commit -qm "test fixture"
E2E_ARTIFACT_DIR="${VALIDATION_DIR}/completion-artifacts" \
  E2E_SOURCE_ROOT_DIR="${COMPLETION_FIXTURE}" bash -c '
    set -Eeuo pipefail
    source "$1"
    E2E_MAESTRO_VERSION="2.6.1"
    e2e_initialize_run_metadata android "$(e2e_app_id android)"
    set +e
    e2e_cleanup 0
    cleanup_status=$?
    set -e
    [[ "${cleanup_status}" -eq 1 ]]
    [[ "$(grep -c "^journey_completed=false$" "${E2E_RUN_PROPERTIES}")" -eq 1 ]]
    [[ "$(grep -c "^exit_code=1$" "${E2E_RUN_PROPERTIES}")" -eq 1 ]]
  ' _ "${ROOT_DIR}/scripts/e2e/common.sh"

METADATA_FAILURE_FIXTURE="${VALIDATION_DIR}/cleanup-metadata-failure"
mkdir -p "${METADATA_FAILURE_FIXTURE}/source/apps/mobile"
printf 'tracked\n' >"${METADATA_FAILURE_FIXTURE}/source/apps/mobile/runtime.txt"
git -C "${METADATA_FAILURE_FIXTURE}/source" init -q
git -C "${METADATA_FAILURE_FIXTURE}/source" config user.email "e2e-validator@hlasimse.invalid"
git -C "${METADATA_FAILURE_FIXTURE}/source" config user.name "Hlásím se E2E validator"
git -C "${METADATA_FAILURE_FIXTURE}/source" add apps/mobile/runtime.txt
git -C "${METADATA_FAILURE_FIXTURE}/source" commit -qm "test fixture"
E2E_ARTIFACT_DIR="${METADATA_FAILURE_FIXTURE}/artifacts" \
  E2E_SOURCE_ROOT_DIR="${METADATA_FAILURE_FIXTURE}/source" bash -c '
    set -Eeuo pipefail
    source "$1"
    E2E_SOURCE_PATHS=("apps/mobile")
    E2E_MAESTRO_VERSION="2.6.1"
    e2e_initialize_run_metadata android "$(e2e_app_id android)"
    E2E_JOURNEY_COMPLETED="true"
    eval "$(declare -f e2e_record_property | sed "1s/e2e_record_property/e2e_record_property_original/")"
    e2e_record_property() {
      if [[ "$1" == "backend_cleanup_completed" ]]; then
        return 1
      fi
      e2e_record_property_original "$@"
    }
    set +e
    e2e_cleanup 0
    cleanup_status=$?
    set -e
    [[ "${cleanup_status}" -eq 1 ]]
    [[ -f "${E2E_RUN_PROPERTIES_STAGING}" ]]
    [[ ! -e "${E2E_RUN_PROPERTIES}" ]]
  ' _ "${ROOT_DIR}/scripts/e2e/common.sh"

IOS_EARLY_FAILURE_ARTIFACTS="${VALIDATION_DIR}/ios-early-failure-artifacts"
set +e
E2E_ARTIFACT_DIR="${IOS_EARLY_FAILURE_ARTIFACTS}" bash -c '
  set -Eeuo pipefail
  source "$1"
  eval "$(sed -n "/^IOS_TEMPLATE_SIMULATOR_UDID=/,/^trap .*EXIT$/p" "$2")"
  exit 7
' _ "${ROOT_DIR}/scripts/e2e/common.sh" "${ROOT_DIR}/scripts/e2e/run-ios.sh" \
  >"${VALIDATION_DIR}/ios-early-failure.log" 2>&1
ios_early_failure_status=$?
set -e
[[ "${ios_early_failure_status}" -eq 7 ]]
! grep -Fq "unbound variable" "${VALIDATION_DIR}/ios-early-failure.log"
[[ ! -e "${IOS_EARLY_FAILURE_ARTIFACTS}/run.properties.partial" ]]
[[ ! -e "${IOS_EARLY_FAILURE_ARTIFACTS}/run.properties" ]]

ruby -e '
  common = File.read(ARGV.fetch(0))
  ios = File.read(ARGV.fetch(1))
  android = File.read(ARGV.fetch(2))

  required_common = %w[
    git_commit git_tree run_mode platform app_id source_clean_start source_clean_end
    app_version app_build maestro_version db_vendor journey_completed
    backend_cleanup_completed metro_cleanup_completed postgres_cleanup_completed
  ]
  missing_common = required_common.reject { |key| common.include?("e2e_record_property #{key}") }
  abort("Missing required run metadata keys: #{missing_common.join(", ")}") unless missing_common.empty?

  required_source_paths = %w[
    apps/mobile apps/server .maestro scripts/e2e package.json package-lock.json
    compose.production.yml README.md docs/store scripts/check-public-contract.mjs
    scripts/public-contract-manifest.json scripts/fixtures/public-contract
  ]
  missing_paths = required_source_paths.reject { |path| common.include?(%Q{"#{path}"}) }
  abort("Missing source-traceability paths: #{missing_paths.join(", ")}") unless missing_paths.empty?

  abort("Whole-flow retry loop remains enabled") if common.include?("attempt <= 2")
  abort("Whole-flow retry escape hatch remains enabled") if common.include?("E2E_DISABLE_FLOW_RETRY")
  abort("iOS completion marker is missing") unless ios.include?(%q{E2E_JOURNEY_COMPLETED="true"})
  abort("Android completion marker is missing") unless android.include?(%q{E2E_JOURNEY_COMPLETED="true"})

  required_ios = %w[
    device_id device_name device_origin device_owned device_type_identifier
    template_device_id template_device_name os_name os_version api_level
    ios_runtime_id xcode_version xcode_build host_architecture simulator_reported_machine simulator_arm64_capable
    production_app_id release_evidence_eligible device_cleanup_completed build_cleanup_completed build_configuration packaged_app_version packaged_app_build js_bundle_mode
    metro_used native_project_origin expo_prebuild_version cocoapods_version
    podfile_lock_sha256 native_project_sha256 production_app_sha256 production_app_sha256_after_isolation e2e_source_app_sha256 production_js_bundle_sha256 e2e_app_sha256
    e2e_executable_sha256 e2e_js_bundle_sha256 e2e_info_plist_sha256 installed_app_sha256
    e2e_codesign_cdhash signing_authority bundle_identity_derivation
    js_bundle_relation production_entitlements_sha256 e2e_entitlements_sha256 bundle_bound_entitlements_present
    framework_executable_mode_normalization framework_executable_count normalized_framework_executable_count preexisting_framework_executable_0644_count framework_executable_content_preserved
    production_cleartext_allowed e2e_local_networking_allowed initial_install_mode
    update_artifact_relation n_minus_one_coverage store_signed_update_coverage
    production_endpoint_coverage artifact_scope
    ios_architectures ios_bundle_present_before_install
  ]
  missing_ios = required_ios.reject { |key| ios.include?("e2e_record_property #{key}") }
  abort("Missing iOS metadata keys: #{missing_ios.join(", ")}") unless missing_ios.empty?

  required_lifecycle = [
    %q{E2E_IOS_REUSE_TEMPLATE:-false},
    %q{E2E_RUN_MODE="diagnostic-template-reuse"},
    %q{xcrun simctl create "${IOS_CREATED_DEVICE_NAME}" "${IOS_DEVICE_TYPE_ID}" "${IOS_RUNTIME_ID}"},
    %q{IOS_DEVICE_ORIGIN="fresh-runner-created"},
    %q{IOS_OWNED_SIMULATOR_UDID=""},
    %q{local device_id="${IOS_OWNED_SIMULATOR_UDID}"},
    %q{xcrun simctl shutdown "${device_id}"},
    %q{xcrun simctl delete "${device_id}"},
    %q{npx expo prebuild --clean --platform ios --no-install},
    %q{.hlasimse-prebuild-stale-sentinel},
    %q{pod install},
    %q{-configuration Release},
    %q{EXPO_PUBLIC_API_URL="https://release-manifest.invalid"},
    %q{E2E_APP_ID="${IOS_PRODUCTION_APP_ID}.e2e"},
    %q{ONLY_ACTIVE_ARCH=YES build},
    %q{xcrun simctl spawn "${IOS_SIMULATOR_UDID}" /usr/sbin/sysctl -n hw.machine},
    %q{xcrun simctl spawn "${IOS_SIMULATOR_UDID}" /usr/sbin/sysctl -n hw.optional.arm64},
    %q{[[ "${ios_architectures}" == "${IOS_BUILD_ARCHITECTURE}" ]]},
    %q{main.jsbundle},
    %q{ditto "${IOS_PRODUCTION_APP_PATH}" "${IOS_E2E_APP_PATH}"},
    %q{Set :CFBundleIdentifier ${E2E_APP_ID}},
    %q{Set :NSAppTransportSecurity:NSAllowsLocalNetworking true},
    %q{codesign --force --sign - --timestamp=none --entitlements},
    %q{bundle_bound_entitlement in application-identifier com.apple.developer.team-identifier keychain-access-groups},
    %q{[[ ! "${framework_executable}" =~ ^[A-Za-z0-9._+-]+$ ]]},
    %q{stat -f %Lp "${framework_executable_path}"},
    %q{case "${framework_executable_mode}" in},
    %q{755)},
    %q{644)},
    %q{Unexpected packaged framework executable mode},
    %q{chmod 0644 "${framework_executable_path}"},
    %q{[[ "$(stat -f %Lp "${framework_executable_path}")" == "644" ]]},
    %q{[[ "${framework_executable_sha256_after}" == "${framework_executable_sha256_before}" ]]},
    %q{[[ "${framework_executable_count}" -gt 0 ]]},
    %q{[[ "${normalized_framework_executable_count}" -gt 0 ]]},
    %q{[[ "${preexisting_framework_executable_0644_count}" -gt 0 ]]},
    %q{[[ "${framework_executable_count}" -eq "$((normalized_framework_executable_count + preexisting_framework_executable_0644_count))" ]]},
    %q{e2e_record_property framework_executable_content_preserved true},
    %q{release-postbuild-identity-ats-and-coresimulator-mode-isolated},
    %q{xcrun simctl install "${device_id}" "${IOS_E2E_APP_PATH}"},
    %q{xcrun simctl launch --terminate-running-process},
    %q{ios-install-tree.diff},
    %q{same-built-app-reinstall-not-n-minus-one},
    %q{Documents/.hlasimse-e2e-reinstall-sentinel},
    %q{umask 077},
    %q{data_container_content_preserved=true},
    %q{data_container_path_stable=%s},
    %q{e2e_finalize_ios_upgrade_evidence},
    %q{server_confirmed_sentinel_check_in=true},
    %q{ios_bundle_present_before_install},
  ]
  missing_lifecycle = required_lifecycle.reject { |fragment| ios.include?(fragment) }
  abort("Missing fail-closed iOS lifecycle fragments: #{missing_lifecycle.join(", ")}") unless missing_lifecycle.empty?

  framework_mode_case = ios[/case "\$\{framework_executable_mode\}" in(.*?)^    esac$/m, 1]
  abort("Could not inspect iOS framework executable mode branches") unless framework_mode_case
  mode_755_branch = framework_mode_case[/^      755\)(.*?)^        ;;$/m, 1]
  mode_644_branch = framework_mode_case[/^      644\)(.*?)^        ;;$/m, 1]
  unexpected_mode_branch = framework_mode_case[/^      \*\)(.*?)^        ;;$/m, 1]
  abort("iOS 0755 framework mode branch is incomplete") unless mode_755_branch&.include?(%q{chmod 0644 "${framework_executable_path}"}) && mode_755_branch.include?(%q{normalized_framework_executable_count=$((normalized_framework_executable_count + 1))})
  abort("iOS 0644 framework mode branch is incomplete") unless mode_644_branch&.include?(%q{preexisting_framework_executable_0644_count=$((preexisting_framework_executable_0644_count + 1))}) && !mode_644_branch.include?("chmod")
  abort("Unexpected iOS framework modes do not fail closed") unless unexpected_mode_branch&.include?("Unexpected packaged framework executable mode") && unexpected_mode_branch.include?("return 1")

  cleanup_body = ios[/e2e_ios_cleanup\(\) \{(.*?)\n\}/m, 1]
  abort("Could not inspect iOS cleanup") unless cleanup_body
  ownership_init = ios.index(%q{IOS_DEVICE_OWNED="false"})
  cleanup_trap = ios.index(%q{trap } + 39.chr + %q{e2e_ios_cleanup "$?"} + 39.chr + %q{ EXIT})
  abort("iOS ownership state is not initialized before the EXIT trap") unless ownership_init && cleanup_trap && ownership_init < cleanup_trap
  evidence_cleanup = cleanup_body.index(%q{e2e_cleanup "${exit_code}"})
  simulator_cleanup = cleanup_body.index("e2e_ios_delete_owned_simulator")
  cleanup_record = cleanup_body.index(%q{e2e_record_property device_cleanup_completed true})
  abort("iOS cleanup is not recorded before evidence finalization") unless evidence_cleanup && simulator_cleanup && cleanup_record && simulator_cleanup < cleanup_record && cleanup_record < evidence_cleanup

  forbidden_ios_release = [
    "e2e_start_metro",
    "expo run:ios",
    "DEV_CLIENT_URL",
    "expo-development-client",
  ]
  ios_release_violation = forbidden_ios_release.find { |fragment| ios.include?(fragment) }
  abort("iOS release evidence still contains development tooling: #{ios_release_violation}") if ios_release_violation
  abort("iOS release evidence contains a Debug build configuration") if ios.match?(/-configuration\s+Debug/)
  production_release_build = ios.match?(/EXPO_PUBLIC_API_URL="https:\/\/release-manifest\.invalid".*?xcodebuild.*?-configuration Release.*?-derivedDataPath "\$\{production_derived_data\}".*?ONLY_ACTIVE_ARCH=YES build/m)
  abort("Production iOS build is not structurally tied to Release and its own DerivedData") unless production_release_build
  release_build_count = ios.scan("ONLY_ACTIVE_ARCH=YES build").length
  abort("iOS harness must contain exactly one Xcode app build") unless release_build_count == 1
  abort("iOS E2E transport must not depend on a separate loopback-configured JS build") if ios.match?(/EXPO_PUBLIC_API_URL="http:\/\//) || ios.include?("e2e_derived_data")
  abort("iOS E2E JS must be byte-identical to production") unless ios.include?(%q{[[ "${IOS_PRODUCTION_JS_BUNDLE_SHA256}" == "${IOS_E2E_JS_BUNDLE_SHA256}" ]]})
  abort("iOS reinstall still treats the absolute data-container path as an invariant") if ios.include?("iOS data container changed during same-artifact reinstall")
  sentinel_before = ios.index(%q{>"${data_sentinel_before}"})
  reinstall = ios.index(%q{xcrun simctl install "${device_id}" "${IOS_E2E_APP_PATH}"}, sentinel_before.to_i)
  sentinel_after = ios.index(%q{[[ "${data_sentinel_sha256_after}" == "${data_sentinel_sha256_before}" ]]})
  upgrade_flow = ios.index(%q{e2e_run_flow "${IOS_SIMULATOR_UDID}" 55_ios_upgrade_preserves_state})
  upgrade_database_assertion = ios.rindex(%q{e2e_assert_latest_owner_checkin_uses_upgrade_sentinel})
  upgrade_evidence_finalization = ios.rindex(%q{e2e_finalize_ios_upgrade_evidence})
  ordered_upgrade_proof = [sentinel_before, reinstall, sentinel_after, upgrade_flow, upgrade_database_assertion, upgrade_evidence_finalization]
  abort("iOS reinstall preservation proof is not ordered sentinel-before/install/sentinel-after/UI/database/finalize") unless ordered_upgrade_proof.all? && ordered_upgrade_proof.each_cons(2).all? { |left, right| left < right }
  abort("Production iOS ID does not reserve the E2E suffix") unless ios.include?(%q{[[ "${IOS_PRODUCTION_APP_ID}" == *.e2e ]]})

  forbidden_lifecycle = [
    /simctl\s+delete\s+(?:all|unavailable)/,
    /simctl\s+delete\s+"?\$\{IOS_TEMPLATE_SIMULATOR_UDID\}"?/,
    /simctl\s+(?:erase|keychain)/,
  ]
  violation = forbidden_lifecycle.find { |pattern| ios.match?(pattern) }
  abort("Unsafe iOS simulator lifecycle command: #{violation.inspect}") if violation

  required_android = %w[
    device_id device_name device_origin device_owned device_type_identifier
    template_device_id template_device_name os_name os_version api_level android_avd
    android_device_profile android_system_image_package android_system_image_revision
    android_platform_package android_platform_revision
    android_command_line_tools_revision
    android_sdk_toolchain_origin android_build_tools_revision android_adb_version
    android_emulator_version emulator_display_mode
    android_build_fingerprint apk_sha256 apk_signer_cert_sha256 android_package_uid
    production_app_id release_evidence_eligible
    android_package_present_before_install android_first_install_time build_variant
    js_bundle_mode signing_authority production_cleartext_allowed e2e_local_networking_allowed
    production_endpoint_coverage artifact_scope initial_install_mode
    update_artifact_relation n_minus_one_coverage store_signed_update_coverage
    android_launcher_component native_project_origin
    expo_prebuild_version device_cleanup_completed
  ]
  missing_android = required_android.reject { |key| android.include?("e2e_record_property #{key}") }
  abort("Missing Android metadata keys: #{missing_android.join(", ")}") unless missing_android.empty?

  required_android_lifecycle = [
    %q{ANDROID_DEVICE_ORIGIN="fresh-runner-created"},
    %q{ANDROID_DEVICE_OWNED="true"},
    %q{if [[ "${E2E_RUN_MODE}" == "full"},
    %q{&& "${ANDROID_DEVICE_OWNED}" == "true"},
    %q{&& "${ANDROID_DEVICE_ORIGIN}" == "fresh-runner-created" ]]; then},
    %q{e2e_record_property release_evidence_eligible true},
    %q{e2e_record_property release_evidence_eligible false},
    %q{mktemp -d "${temp_base}/hlasimse-e2e-avd.XXXXXX"},
    %q{--package "${system_image_package}"},
    %q{-wipe-data},
    %q{-no-snapshot},
    %q{-no-window},
    %q{-gpu swiftshader_indirect},
    %q{shell pm path "${E2E_APP_ID}"},
    %q{install "${ANDROID_APK_PATH}"},
    %q{npx expo prebuild --platform android --no-install},
    %q{.hlasimse-prebuild-stale-sentinel},
    %q{:app:processReleaseManifest --no-daemon},
    %q{:app:assembleE2e --no-daemon},
    %q{assets/index.android.bundle},
    %q{e2e_record_property e2e_local_networking_allowed "true"},
    %q{e2e_record_property production_endpoint_coverage "https-sentinel-release-manifest-configuration-not-real-production-endpoint"},
    %q{e2e_record_property artifact_scope "release-derived-android-emulator-debug-test-signed-not-store-signed"},
    %q{same-built-apk-reinstall-not-n-minus-one},
    %q{e2e_record_property n_minus_one_coverage "false"},
    %q{e2e_record_property store_signed_update_coverage "false"},
  ]
  missing_android_lifecycle = required_android_lifecycle.reject { |fragment| android.include?(fragment) }
  abort("Missing fail-closed Android lifecycle fragments: #{missing_android_lifecycle.join(", ")}") unless missing_android_lifecycle.empty?

  abort("Android release evidence still starts Metro") if android.include?("e2e_start_metro")
  abort("Android release evidence still launches Expo debug tooling") if android.include?("expo run:android") || android.include?("DEV_CLIENT_URL")
  abort("Android release evidence uses a spoofable public E2E flag") if android.include?("EXPO_PUBLIC_E2E")
  abort("Android full run accepts a pre-existing serial") if android.include?(%q{ANDROID_SERIAL="${ANDROID_SERIAL:-}"})
  abort("Android cleanup is not sentinel-scoped") unless android.include?(".hlasimse-runner-owned-avd")
  abort("Android cleanup may target the persistent template") unless android.include?("Refusing AVD cleanup because the target overlaps")
  production_manifest_configuration = android.match?(/EXPO_PUBLIC_API_URL="https:\/\/release-manifest\.invalid".*?\.\/gradlew :app:processReleaseManifest --no-daemon/m)
  abort("Android production manifest task is not tied to the HTTPS endpoint sentinel") unless production_manifest_configuration
  e2e_runtime_configuration = android.match?(/EXPO_PUBLIC_API_URL="http:\/\/10\.0\.2\.2:8000".*?\.\/gradlew :app:assembleE2e --no-daemon/m)
  abort("Android E2E APK build is not tied to the exact emulator-local endpoint") unless e2e_runtime_configuration

  create_owned_avd = android.index("\ncreate_owned_android_avd\n")
  release_eligibility = android.index(%q{e2e_record_property release_evidence_eligible true}, create_owned_avd.to_i)
  apk_digest = android.index(%q{ANDROID_APK_SHA256="$(shasum -a 256})
  initial_install = android.index(%q{install "${ANDROID_APK_PATH}"}, apk_digest.to_i)
  local_networking_scope = android.index(%q{e2e_record_property e2e_local_networking_allowed "true"})
  production_endpoint_scope = android.index(%q{e2e_record_property production_endpoint_coverage "https-sentinel-release-manifest-configuration-not-real-production-endpoint"})
  artifact_scope = android.index(%q{e2e_record_property artifact_scope "release-derived-android-emulator-debug-test-signed-not-store-signed"})
  update_relation = android.index(%q{e2e_record_property update_artifact_relation "same-built-apk-reinstall-not-n-minus-one"})
  n_minus_one_scope = android.index(%q{e2e_record_property n_minus_one_coverage "false"})
  store_signed_scope = android.index(%q{e2e_record_property store_signed_update_coverage "false"})
  update_sentinel = android.index(%q{android_input_text "E2E update sentinel" "upgrade sentinel name"})
  reinstall = android.index(%q{install -r "${ANDROID_APK_PATH}"}, update_sentinel.to_i)
  update_flow = android.index(%q{e2e_run_flow "${ANDROID_SERIAL}" 05_android_update_preserves_state})
  completion = android.rindex(%q{E2E_JOURNEY_COMPLETED="true"})
  ordered_android_proof = [
    create_owned_avd, release_eligibility, apk_digest, initial_install, local_networking_scope,
    production_endpoint_scope, artifact_scope, update_relation,
    n_minus_one_scope, store_signed_scope, update_sentinel, reinstall, update_flow, completion,
  ]
  abort("Android evidence is not ordered owned-AVD/eligible/build/install/scope/sentinel/reinstall/UI/complete") unless ordered_android_proof.all? && ordered_android_proof.each_cons(2).all? { |left, right| left < right }

  at08_stop = common.index(%q{e2e_stop_backend}, common.index("e2e_run_at08_offline_deadline").to_i)
  at08_queue = common.index(%q{20_owner_offline_queue}, at08_stop.to_i)
  at08_open = common.index(%q{e2e_open_at08_incident}, at08_queue.to_i)
  at08_pending = common.index(%q{25_owner_offline_deadline_pending}, at08_open.to_i)
  at08_restart = common.index(%q{e2e_start_backend}, at08_pending.to_i)
  at08_sync = common.index(%q{30_owner_offline_sync}, at08_restart.to_i)
  at08_verify = common.index(%q{e2e_verify_at08_resolution}, at08_sync.to_i)
  ordered_at08 = [at08_stop, at08_queue, at08_open, at08_pending, at08_restart, at08_sync, at08_verify]
  abort("AT-08 is not ordered API-stop/queue/sweep/persist/restart/sync/exact-verify") unless ordered_at08.all? && ordered_at08.each_cons(2).all? { |left, right| left < right }
  abort("iOS JUnit evidence omits AT-08 persistent pending flow") unless ios.include?("25_owner_offline_deadline_pending")
  abort("Android JUnit evidence omits AT-08 persistent pending flow") unless android.include?("25_owner_offline_deadline_pending")

  ios_core = common.index(%q{e2e_run_flow "$device_id" 12_owner_parity_core})
  ios_pause_assertion = common.index("e2e_assert_owner_parity_pause", ios_core.to_i)
  ios_name = common.index(%q{e2e_run_flow "$device_id" 13_ios_owner_name_update}, ios_pause_assertion.to_i)
  ios_final_assertion = common.index("e2e_assert_owner_parity_final", ios_name.to_i)
  ios_next_profile = common.index(%q{e2e_run_flow "$device_id" 15_owner_profile_create}, ios_final_assertion.to_i)
  ordered_ios_parity = [ios_core, ios_pause_assertion, ios_name, ios_final_assertion, ios_next_profile]
  abort("iOS parity proof is not ordered UI/pause-database/name-restart/database/next-profile") unless ordered_ios_parity.all? && ordered_ios_parity.each_cons(2).all? { |left, right| left < right }

  android_core = android.index(%q{e2e_run_flow "${ANDROID_SERIAL}" 12_owner_parity_core})
  android_pause_assertion = android.index("e2e_assert_owner_parity_pause", android_core.to_i)
  android_name_focus = android.index(%q{e2e_run_flow "${ANDROID_SERIAL}" 13a_android_owner_name_focus}, android_pause_assertion.to_i)
  android_name_input = android.index(%q{android_input_text "E2E Potvrzeno" "confirmed account name"}, android_name_focus.to_i)
  android_name_save = android.index(%q{e2e_run_flow "${ANDROID_SERIAL}" 13b_android_owner_name_after_input}, android_name_input.to_i)
  android_final_assertion = android.index("e2e_assert_owner_parity_final", android_name_save.to_i)
  android_next_profile = android.index(%q{e2e_run_flow "${ANDROID_SERIAL}" 15a_android_profile_focus_name}, android_final_assertion.to_i)
  ordered_android_parity = [android_core, android_pause_assertion, android_name_focus, android_name_input, android_name_save, android_final_assertion, android_next_profile]
  abort("Android parity proof is not ordered UI/pause-database/focus/ADB-input/name-restart/database/next-profile") unless ordered_android_parity.all? && ordered_android_parity.each_cons(2).all? { |left, right| left < right }

  required_parity_fragments = [
    "acknowledgement_server_timestamp",
    "archive_audit_event_present",
    "custom_pause_server_timestamp",
    "account_name_server_confirmed",
    "active_profile_resumed",
  ]
  missing_parity_fragments = required_parity_fragments.reject { |fragment| common.include?(fragment) }
  abort("Parity backend evidence is incomplete: #{missing_parity_fragments.join(", ")}") unless missing_parity_fragments.empty?
' "${ROOT_DIR}/scripts/e2e/common.sh" "${ROOT_DIR}/scripts/e2e/run-ios.sh" \
  "${ROOT_DIR}/scripts/e2e/run-android.sh"

ruby -e '
  app = File.read(ARGV.fetch(0))
  plugin = File.read(ARGV.fetch(1))
  abort("Android E2E config plugin is not registered") unless app.include?(%q{"./plugins/with-android-e2e-build"})
  abort("Android E2E config plugin does not define a release-derived build") unless plugin.include?("initWith release")
  abort("Android E2E config plugin does not isolate the application ID") unless plugin.include?(%q{applicationIdSuffix ".e2e"})
  abort("Android E2E config plugin permits debugging") unless plugin.include?("debuggable false")
  abort("Android cleartext override is not isolated to the e2e manifest") unless plugin.match?(/"src",\s*"e2e",\s*"AndroidManifest\.xml"/m)
  abort("Android E2E manifest does not opt in to local cleartext") unless plugin.include?(%q{android:usesCleartextTraffic="true"})
' "${ROOT_DIR}/apps/mobile/app.json" "${ROOT_DIR}/apps/mobile/plugins/with-android-e2e-build.js"

ruby -rjson -e '
  app = JSON.parse(File.read(ARGV.fetch(0)))
  api = File.read(ARGV.fetch(1))
  config = File.read(ARGV.fetch(2))
  ats = app.dig("expo", "ios", "infoPlist", "NSAppTransportSecurity")
  ios_bundle_id = app.dig("expo", "ios", "bundleIdentifier")
  android_package = app.dig("expo", "android", "package")
  abort("Production iOS bundle ID is missing") unless ios_bundle_id.is_a?(String) && !ios_bundle_id.empty?
  abort("Production Android package is missing") unless android_package.is_a?(String) && !android_package.empty?
  abort("Production iOS bundle ID must not use the reserved .e2e suffix") if ios_bundle_id.end_with?(".e2e")
  abort("Production Android package must not use the reserved .e2e suffix") if android_package.end_with?(".e2e")
  abort("Production iOS ATS must reject arbitrary loads") unless ats.is_a?(Hash) && ats["NSAllowsArbitraryLoads"] == false
  abort("Production iOS ATS must reject local networking") unless ats["NSAllowsLocalNetworking"] == false
  abort("iOS E2E transport is not tied to the native application identity") unless api.include?(%q{Platform.OS === "ios" && Application.applicationId?.endsWith(".e2e") === true})
  abort("iOS E2E loopback URL is not exact") unless config.include?(%q{const IOS_SIMULATOR_E2E_URL = "http://127.0.0.1:8000"})
  identity_override = config.index(%q{if (isIosE2E)})
  configured_resolution = config.index(%q{const baseUrl = configuredBaseUrl})
  abort("iOS native E2E identity does not override the production JS endpoint") unless identity_override && configured_resolution && identity_override < configured_resolution
  abort("Mobile API config uses a spoofable public E2E flag") if api.include?("EXPO_PUBLIC_E2E") || config.include?("EXPO_PUBLIC_E2E")
' "${ROOT_DIR}/apps/mobile/app.json" "${ROOT_DIR}/apps/mobile/lib/api.ts" \
  "${ROOT_DIR}/apps/mobile/lib/apiConfig.ts"

ruby -e '
  require "yaml"
  ARGV.each do |path|
    documents = YAML.load_stream(File.read(path))
    abort("#{path}: expected Maestro config and command documents") unless documents.length == 2
    abort("#{path}: first document must contain appId") unless documents[0].is_a?(Hash) && documents[0]["appId"]
    abort("#{path}: second document must be a non-empty command list") unless documents[1].is_a?(Array) && !documents[1].empty?
  end
' "${ROOT_DIR}"/.maestro/flows/*.yaml

ruby -e '
  root = ARGV.fetch(0)
  parity = File.read(File.join(root, ".maestro/flows/12_owner_parity_core.yaml"))
  ios_name = File.read(File.join(root, ".maestro/flows/13_ios_owner_name_update.yaml"))
  android_focus = File.read(File.join(root, ".maestro/flows/13a_android_owner_name_focus.yaml"))
  android_save = File.read(File.join(root, ".maestro/flows/13b_android_owner_name_after_input.yaml"))
  offline_sync = File.read(File.join(root, ".maestro/flows/30_owner_offline_sync.yaml"))

  required_parity = [
    %q{Potvrzení znamená jen to, že strážce otevřel incident v aplikaci},
    %q{E2E Strážce},
    %q{Incident zobrazen},
    %q{id: "timeline-profile-picker"},
    %q{retryTapIfNoChange: true},
    %q{Archivované profily},
    %q{id: "timeline-profile-archived-.*"},
    %q{Historie profilu: E2E archiv historie},
    %q{Pouze historie — profil je archivovaný},
    %q{id: "checkin-submit"},
    %q{id: "profile-pause"},
    %q{Profil archivován},
    %q{Vybraný profil E2E bezpečnostní profil},
    %q{id: "pause-duration-custom"},
    %q{id: "pause-custom-datetime-picker"},
    %q{id: "pause-custom-date-open"},
    %q{id: "pause-custom-time-open"},
    %q{id: "pause-confirm"},
    %q{Obnovení potvrzené serverem},
  ]
  missing_parity = required_parity.reject { |fragment| parity.include?(fragment) }
  abort("Owner parity Maestro contract is incomplete: #{missing_parity.join(", ")}") unless missing_parity.empty?
  archived_id = %q{id: "timeline-profile-archived-.*"}
  abort("Archived profile must be located and selected by stable id") unless parity.scan(archived_id).length == 2
  archived_journey = [
    %q{id: "timeline-profile-picker"},
    %q{retryTapIfNoChange: true},
    %q{Archivované profily},
    archived_id,
    %q{Pouze historie — profil je archivovaný},
    %q{Historie profilu: E2E archiv historie},
    %q{Profil archivován},
    %q{Vybraný profil E2E bezpečnostní profil},
  ]
  archived_positions = archived_journey.map { |fragment| parity.index(fragment) }
  abort("Archived profile journey must preserve its evidence order") unless archived_positions.each_cons(2).all? { |left, right| left < right }

  required_ios_name = [
    %q{id: "profile-resume"},
    %q{id: "account-name-open"},
    %q{id: "account-first-name"},
    %q{eraseText: 100},
    %q{inputText: "E2E Potvrzeno"},
    %q{hideKeyboard},
    %q{id: "account-name-submit"},
    %q{id: "account-name-open"},
    %q{stopApp},
    %q{launchApp},
  ]
  missing_ios_name = required_ios_name.reject { |fragment| ios_name.include?(fragment) }
  abort("iOS account-name restart contract is incomplete: #{missing_ios_name.join(", ")}") unless missing_ios_name.empty?
  ios_name_journey = [
    %q{inputText: "E2E Potvrzeno"},
    %q{hideKeyboard},
    %q{id: "account-name-submit"},
    %q{id: "account-name-open"},
    %q{assertVisible: "E2E Potvrzeno"},
    %q{stopApp},
    %q{launchApp},
    %q{id: "tab-settings"},
    %q{visible: "E2E Potvrzeno"},
  ]
  ios_name_cursor = -1
  ios_name_journey.each do |fragment|
    ios_name_cursor = ios_name.index(fragment, ios_name_cursor + 1)
    abort("iOS account-name journey must save before restart and reassert persistence") unless ios_name_cursor
  end

  required_android_name = [
    %q{id: "profile-resume"},
    %q{id: "account-first-name"},
    %q{eraseText: 100},
  ]
  missing_android_focus = required_android_name.reject { |fragment| android_focus.include?(fragment) }
  abort("Android account-name focus contract is incomplete: #{missing_android_focus.join(", ")}") unless missing_android_focus.empty?
  abort("Android name focus flow must leave text injection to adb") if android_focus.include?("inputText") || android_focus.include?("pasteText")
  abort("Android account-name save flow omits the server submit") unless android_save.include?(%q{id: "account-name-submit"})
  abort("Android account-name save flow omits restart verification") unless android_save.include?("stopApp") && android_save.scan("launchApp").length >= 1 && android_save.scan("E2E Potvrzeno").length >= 2

  required_offline_sync = [
    %q{id: "tab-activity"},
    %q{id: "timeline-profile-picker"},
    %q{direction: UP},
    %q{retryTapIfNoChange: true},
    %q{Aktivní profily},
    %q{E2E druhý profil},
    %q{Historie profilu: E2E druhý profil},
    %q{E2E Druhy profil},
    %q{Historie profilu: E2E Druhy profil},
    %q{Synchronizováno později z offline fronty},
    %q{Incident vyřešen potvrzeným check-inem},
    %q{Server otevřel incident},
  ]
  missing_offline_sync = required_offline_sync.reject { |fragment| offline_sync.include?(fragment) }
  abort("Offline sync journey does not select the active AT-08 profile: #{missing_offline_sync.join(", ")}") unless missing_offline_sync.empty?
  abort("Offline sync journey must not retry mutating evidence steps") if offline_sync.include?("retry:")
  offline_sync_cursor = -1
  required_offline_sync.each do |fragment|
    offline_sync_cursor = offline_sync.index(fragment, offline_sync_cursor + 1)
    abort("Offline sync journey must select its active profile before asserting AT-08 events") unless offline_sync_cursor
  end
' "${ROOT_DIR}"

ruby -e '
  focused_login = File.read(ARGV.fetch(0))
  entry_state = focused_login.index(%q{id: "^(login-screen|onboarding-persona-screen)$"})
  onboarding_condition = focused_login.index(%q{id: "onboarding-persona-screen"}, entry_state.to_i + 1)
  existing_account = focused_login.index(%q{id: "onboarding-existing-account-button"})
  required_login = focused_login.rindex(%q{id: "login-screen"})
  abort("Focused iOS login does not wait for a deterministic fresh-install entry state") unless entry_state
  abort("Focused iOS login does not escape fresh-install onboarding") unless onboarding_condition && existing_account && required_login && entry_state < onboarding_condition && onboarding_condition < existing_account && existing_account < required_login
' "${ROOT_DIR}/.maestro/flows/45_ios_location_login.yaml"

ruby -ryaml -e '
  root = ARGV.fetch(0)
  online_submit_count = 0
  Dir.glob(File.join(root, ".maestro/flows/*.yaml")).sort.each do |path|
    metadata, commands = YAML.load_stream(File.read(path))
    next if Array(metadata["tags"]).map(&:to_s).include?("offline")

    event_for = lambda do |command|
      next unless command.is_a?(Hash)
      tap = command["tapOn"]
      next ["tap", tap["id"], tap["optional"] == true] if tap.is_a?(Hash) && tap["id"]
      wait = command["extendedWaitUntil"]
      visible = wait["visible"] if wait.is_a?(Hash)
      next ["wait-visible", visible["id"], wait["optional"] == true] if visible.is_a?(Hash) && visible["id"]
      nil
    end

    validate_commands = nil
    visit_nested = nil
    visit_nested = lambda do |value, context|
      case value
      when Array
        value.each_with_index { |item, index| visit_nested.call(item, "#{context}[#{index}]") }
      when Hash
        value.each do |key, child|
          if key.to_s == "commands" && child.is_a?(Array)
            validate_commands.call(child, "#{context}.commands")
          else
            visit_nested.call(child, "#{context}.#{key}")
          end
        end
      end
    end

    validate_commands = lambda do |command_array, context|
      events = command_array.map { |command| event_for.call(command) }
      submit_indexes = events.each_index.select do |index|
        events[index]&.first(2) == ["tap", "checkin-submit"]
      end
      online_submit_count += submit_indexes.length
      submit_indexes.each_with_index do |submit_index, occurrence|
        abort("#{File.basename(path)} #{context}: online check-in submit must not be optional") if events[submit_index][2]
        next_submit = submit_indexes[occurrence + 1] || events.length
        wait_index = ((submit_index + 1)...next_submit).find do |index|
          events[index] == ["wait-visible", "checkin-success-overlay", false]
        end
        abort("#{File.basename(path)} #{context}: online check-in does not await the confirmation modal in the same command path") unless wait_index
        continue_index = ((wait_index + 1)...next_submit).find do |index|
          events[index] == ["tap", "checkin-success-continue", false]
        end
        abort("#{File.basename(path)} #{context}: confirmation modal is not explicitly dismissed in the same command path") unless continue_index
      end
      command_array.each_with_index do |command, index|
        visit_nested.call(command, "#{context}[#{index}]")
      end
    end
    validate_commands.call(commands, "root")
  end
  abort("No online check-in submit was discovered") if online_submit_count.zero?
' "${ROOT_DIR}"

ruby -ryaml -e '
  root = ARGV.fetch(0)
  runner = File.read(File.join(root, "scripts/e2e/run-android.sh"))
  entrypoints = runner.scan(/e2e_run_flow\s+"\$\{ANDROID_SERIAL\}"\s+([A-Za-z0-9_-]+)/).flatten.uniq
  abort("Android runner has no statically discoverable flow entrypoints") if entrypoints.empty?

  banned = %w[setClipboard pasteText inputText]
  visited = {}
  violations = []

  scan_commands = nil
  scan_flow = nil
  scan_flow = lambda do |name|
    name = name.sub(/\.ya?ml\z/, "")
    return if visited[name]
    visited[name] = true
    path = File.join(root, ".maestro/flows/#{name}.yaml")
    abort("Android runner references missing flow #{path}") unless File.file?(path)
    documents = YAML.load_stream(File.read(path))
    abort("#{path}: expected command document") unless documents[1].is_a?(Array)
    scan_commands.call(documents[1], name)
  end

  scan_commands = lambda do |value, flow_name|
    case value
    when Array
      value.each_cons(2) do |current, following|
        next unless current.is_a?(Hash) && following.is_a?(Hash)
        if current.key?("launchApp") && following.key?("openLink")
          violations << "#{flow_name}: launchApp immediately followed by openLink can lose the initial deep link"
        end
      end
      value.each { |item| scan_commands.call(item, flow_name) }
    when Hash
      value.each do |key, child|
        violations << "#{flow_name}: #{key}" if banned.include?(key.to_s)
        next unless key.to_s == "runFlow"
        if child.is_a?(String)
          scan_flow.call(child)
          next
        end
        next unless child.is_a?(Hash)
        platform = child.dig("when", "platform")
        next if platform == "iOS"
        scan_flow.call(child["file"]) if child["file"].is_a?(String)
        scan_commands.call(child["commands"], flow_name) if child.key?("commands")
      end
      value.each do |key, child|
        next if key.to_s == "runFlow"
        scan_commands.call(child, flow_name)
      end
    end
  end

  entrypoints.each { |name| scan_flow.call(name) }
  abort("Android-reachable Maestro text injection is forbidden:\n#{violations.join("\n")}") unless violations.empty?
  puts "Validated #{visited.length} Android-reachable flows without Maestro text injection."
' "${ROOT_DIR}"

printf 'E2E shell and YAML validation passed.\n'
