#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "${ROOT_DIR}/scripts/e2e/common.sh"
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
E2E_ARTIFACT_DIR="${VALIDATION_DIR}" bash -c '
  set -Eeuo pipefail
  source "$1"
  e2e_generate_credential
  [[ ${#E2E_RUN_CREDENTIAL} -ge 32 ]]
' _ "${ROOT_DIR}/scripts/e2e/common.sh"

ruby -e '
  require "yaml"
  ARGV.each do |path|
    documents = YAML.load_stream(File.read(path))
    abort("#{path}: expected Maestro config and command documents") unless documents.length == 2
    abort("#{path}: first document must contain appId") unless documents[0].is_a?(Hash) && documents[0]["appId"]
    abort("#{path}: second document must be a non-empty command list") unless documents[1].is_a?(Array) && !documents[1].empty?
  end
' "${ROOT_DIR}"/.maestro/flows/*.yaml

printf 'E2E shell and YAML validation passed.\n'
