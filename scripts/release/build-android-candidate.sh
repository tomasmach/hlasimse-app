#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mobile_root="$repo_root/apps/mobile"
evidence_root="${RELEASE_EVIDENCE_DIR:-$repo_root/release-evidence/android}"
mkdir -p "$evidence_root"

export NODE_ENV=production
export EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-https://release-audit.invalid}"

cd "$mobile_root"
npx expo prebuild --platform android --no-install --clean
cd android
./gradlew --no-daemon :app:bundleRelease

aab="$mobile_root/android/app/build/outputs/bundle/release/app-release.aab"
merged_manifest="$mobile_root/android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml"
manifest="$evidence_root/merged-release-AndroidManifest.xml"
test -s "$aab"
unzip -t "$aab" >/dev/null
test "$(unzip -p "$aab" base/manifest/AndroidManifest.xml | wc -c | tr -d ' ')" -gt 0
if command -v sha256sum >/dev/null; then
  bundle_manifest_sha256="$(unzip -p "$aab" base/manifest/AndroidManifest.xml | sha256sum | awk '{print $1}')"
else
  bundle_manifest_sha256="$(unzip -p "$aab" base/manifest/AndroidManifest.xml | shasum -a 256 | awk '{print $1}')"
fi
cp "$merged_manifest" "$manifest"

cd "$repo_root"
node scripts/release/audit-native-candidate.mjs \
  --platform android \
  --manifest "$manifest" \
  --artifact "$aab" \
  --bundle-manifest-sha256 "$bundle_manifest_sha256" \
  --evidence "$evidence_root/evidence.json"
