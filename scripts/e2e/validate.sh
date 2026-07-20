#!/usr/bin/env bash

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "${ROOT_DIR}/scripts/e2e/common.sh"
bash -n "${ROOT_DIR}/scripts/e2e/run-ios.sh"
bash -n "${ROOT_DIR}/scripts/e2e/run-android.sh"
node --check "${ROOT_DIR}/scripts/e2e/redact-output.mjs"

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
