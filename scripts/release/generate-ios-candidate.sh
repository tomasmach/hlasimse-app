#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mobile_root="$repo_root/apps/mobile"
evidence_root="${RELEASE_EVIDENCE_DIR:-$repo_root/release-evidence/ios}"
mkdir -p "$evidence_root"

export NODE_ENV=production
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://release-audit.invalid}"

cd "$mobile_root"
npx expo prebuild --platform ios --no-install --clean

project_file="$(find ios -maxdepth 2 -name project.pbxproj -print -quit)"
privacy_file="$(find ios -maxdepth 3 -name PrivacyInfo.xcprivacy -print -quit)"
info_file="$(find ios -maxdepth 3 -name Info.plist -not -path '*/Pods/*' -print -quit)"
test -n "$project_file"
test -n "$privacy_file"
test -n "$info_file"

cd "$repo_root"
node scripts/release/audit-native-candidate.mjs \
  --platform ios \
  --privacy "$mobile_root/$privacy_file" \
  --info "$mobile_root/$info_file" \
  --project "$mobile_root/$project_file" \
  --evidence "$evidence_root/evidence.json"
