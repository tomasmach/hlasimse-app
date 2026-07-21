# Final signed native artifact audit

This audit verifies the identity and signing facts of one already-built Android AAB or iOS IPA/Xcode archive. It is intentionally separate from the source-level candidate gate: the candidate gate uses a debug-signed Android bundle and generated iOS configuration, while this command accepts only distribution artifacts.

Passing this audit does **not** make a release eligible. TestFlight or Play closed-track installation, physical-device tests, N-1 upgrade, production API, legal/store approval, migration, monitoring and operational gates remain mandatory.

## Prerequisites

- Run from a clean checkout of the exact commit used to create the artifact.
- Keep `apps/mobile/app.json` and `scripts/release/native-release-policy.json` identical to the build inputs.
- Use an immutable artifact downloaded from the build system; never rebuild it during the audit.
- Obtain the Android upload-certificate SHA-256 or Apple Team ID from a separately authenticated account/credential record. Do not derive the expected value from the artifact being checked.
- Keep artifacts and evidence in a restricted release directory. Provisioning metadata and certificate subjects are not secrets, but they are operationally sensitive.
- Android requires Java, `jarsigner`, `keytool` and an explicitly supplied official `bundletool-all` JAR. iOS requires macOS with `codesign`, `security`, `plutil` and `unzip`.

The audit never downloads or silently updates bundletool. At the time this runbook was reviewed on 21 July 2026, Google's latest official release was [`bundletool` 1.18.3](https://github.com/google/bundletool/releases/tag/1.18.3). GitHub's release asset metadata published this SHA-256 for `bundletool-all-1.18.3.jar`:

```text
a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29
```

Recheck the authenticated [official Google bundletool releases](https://github.com/google/bundletool/releases) before each release. Record the selected version and obtain its digest independently of the local JAR. A newer reviewed release is allowed; the audit binds the exact local tool to the explicit digest instead of trusting its filename or the network.

## Android AAB

```bash
npm run release:audit-native -- \
  --platform android \
  --artifact /absolute/path/to/app-production.aab \
  --bundletool /absolute/path/to/bundletool-all-1.18.3.jar \
  --expected-bundletool-sha256 a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29 \
  --expected-certificate-sha256 'AA:BB:...:FF' \
  --evidence /absolute/restricted/path/android-final-artifact.json
```

The command:

1. verifies every signed AAB entry with `jarsigner` and rejects unsigned content;
2. reads the signer certificate with `keytool`, rejects an Android Debug subject and compares its SHA-256 with the independently supplied upload-certificate fingerprint;
3. verifies the exact bundletool JAR SHA-256 before executing it, then extracts the compiled base-module manifest directly from the AAB with `java -jar bundletool-all.jar dump manifest`;
4. compares application ID, version name, version code, min/target SDK and the exact permission set with `app.json` and the native release policy;
5. records artifact size and SHA-256 together with the verified facts.

After the audit, upload the same SHA-256-identical AAB to the Play closed track. Play App Signing may replace the upload signature for delivered APKs, so record the Play signing-certificate fingerprint separately and verify the installed closed-track build through Play Console/device evidence.

## iOS IPA or `.xcarchive`

```bash
npm run release:audit-native -- \
  --platform ios \
  --artifact /absolute/path/to/HlasimSe.ipa \
  --expected-team-id A1B2C3D4E5 \
  --evidence /absolute/restricted/path/ios-final-artifact.json
```

An `.xcarchive` directory is also accepted. The command:

1. requires exactly one application bundle and verifies its nested code signatures with strict `codesign` verification;
2. rejects ad-hoc and Apple Development signatures;
3. compares the codesign Team ID, provisioning Team ID, bundle ID, marketing version and build number with the explicit Team ID and `app.json`;
4. requires App Store distribution provisioning rather than a device-bound or enterprise profile, a future expiry, `get-task-allow=false` and production APNs entitlements in both the signature and profile;
5. compares the app-target `PrivacyInfo.xcprivacy` including collected-data purposes and accessed-API reason codes with `app.json`;
6. records an IPA SHA-256 or deterministic `.xcarchive` tree hash, app-bundle hash, provisioning UUID/expiry and privacy-manifest hash.

Upload the exact audited archive/export to TestFlight and preserve the App Store Connect build ID. Xcode's aggregated privacy report must still be reviewed because dependency manifests are not proven by checking only the app-target manifest.

## Evidence handling and failure semantics

The command always writes JSON when it reaches argument validation and the evidence path is usable. Evidence contains:

- `artifactAuditPassed`: the result of this bounded audit;
- `releaseEligible: false`: deliberately fixed because this tool cannot prove the complete release gate;
- artifact hashes, identity, bounded signing facts and sanitized errors.

Any missing tool, malformed archive, signature failure, unexpected certificate, identity/version drift, permission drift, invalid provisioning, APNs mismatch or privacy-manifest mismatch exits non-zero. Never edit the evidence JSON to turn a failure into a pass. Fix or rebuild the artifact, then audit the new immutable artifact and retain both records in the restricted release log.
