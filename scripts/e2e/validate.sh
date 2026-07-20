#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "${ROOT_DIR}/scripts/e2e/common.sh"
bash -n "${ROOT_DIR}/scripts/e2e/postgres.sh"
bash -n "${ROOT_DIR}/scripts/e2e/run-ios.sh"
bash -n "${ROOT_DIR}/scripts/e2e/run-android.sh"
node --check "${ROOT_DIR}/scripts/e2e/redact-output.mjs"
NODE_PATH="${ROOT_DIR}/apps/mobile/node_modules:${ROOT_DIR}/node_modules" \
  node -e 'require.resolve("expo-router/_ctx-shared")'

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
  ! e2e_record_property access_token forbidden
  e2e_record_property zeta last
  e2e_record_property alpha first
  e2e_finalize_run_properties
  [[ "$(sed -n "1p" "${E2E_RUN_PROPERTIES}")" == "alpha=first" ]]
  [[ "$(sed -n "2p" "${E2E_RUN_PROPERTIES}")" == "zeta=last" ]]
  [[ ! -e "${E2E_RUN_PROPERTIES_STAGING}" ]]
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

ruby -e '
  common = File.read(ARGV.fetch(0))
  ios = File.read(ARGV.fetch(1))
  android = File.read(ARGV.fetch(2))

  required_common = %w[
    git_commit git_tree run_mode platform app_id source_clean_start source_clean_end
    app_version app_build maestro_version db_vendor journey_completed
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
    ios_runtime_id xcode_version xcode_build
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
  ]
  missing_lifecycle = required_lifecycle.reject { |fragment| ios.include?(fragment) }
  abort("Missing fail-closed iOS lifecycle fragments: #{missing_lifecycle.join(", ")}") unless missing_lifecycle.empty?

  cleanup_body = ios[/e2e_ios_cleanup\(\) \{(.*?)\n\}/m, 1]
  abort("Could not inspect iOS cleanup") unless cleanup_body
  evidence_cleanup = cleanup_body.index(%q{e2e_cleanup "${exit_code}"})
  simulator_cleanup = cleanup_body.index("e2e_ios_delete_owned_simulator")
  abort("iOS simulator cleanup runs before evidence/PostgreSQL cleanup") unless evidence_cleanup && simulator_cleanup && evidence_cleanup < simulator_cleanup

  forbidden_lifecycle = [
    /simctl\s+delete\s+(?:all|unavailable)/,
    /simctl\s+delete\s+"?\$\{IOS_TEMPLATE_SIMULATOR_UDID\}"?/,
    /simctl\s+(?:erase|keychain)/,
  ]
  violation = forbidden_lifecycle.find { |pattern| ios.match?(pattern) }
  abort("Unsafe iOS simulator lifecycle command: #{violation.inspect}") if violation

  required_android = %w[
    device_id device_name os_name os_version api_level android_avd android_build_fingerprint
    apk_sha256 apk_signer_cert_sha256 android_package_uid
  ]
  missing_android = required_android.reject { |key| android.include?("e2e_record_property #{key}") }
  abort("Missing Android metadata keys: #{missing_android.join(", ")}") unless missing_android.empty?
' "${ROOT_DIR}/scripts/e2e/common.sh" "${ROOT_DIR}/scripts/e2e/run-ios.sh" \
  "${ROOT_DIR}/scripts/e2e/run-android.sh"

ruby -e '
  require "yaml"
  ARGV.each do |path|
    documents = YAML.load_stream(File.read(path))
    abort("#{path}: expected Maestro config and command documents") unless documents.length == 2
    abort("#{path}: first document must contain appId") unless documents[0].is_a?(Hash) && documents[0]["appId"]
    abort("#{path}: second document must be a non-empty command list") unless documents[1].is_a?(Array) && !documents[1].empty?
  end
' "${ROOT_DIR}"/.maestro/flows/*.yaml

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
