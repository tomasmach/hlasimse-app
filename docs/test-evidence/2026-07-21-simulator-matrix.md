# Simulator matrix — 21 July 2026

This record summarizes the final reviewed local Maestro runs after the safety, free-product parity,
and release-readiness hardening. Both platforms exercised the exact same commit
`52111414c86c0f88fc1f23f3167e9c31a098df24` (`5211141`) and Git tree
`d5a809e16f6a2a12f36ebf080a0e33898b5ccc71`.

Both runners started an isolated PostgreSQL database, created a fresh simulator or emulator, ran
every mutating flow exactly once, and completed their source-integrity and cleanup checks.

| Platform | Device | OS/API | Result | Local raw evidence |
| --- | --- | --- | --- | --- |
| iOS | iPhone 17 Pro Simulator | iOS 26.2 (Xcode SDK 26.5) | 14/14 tests passed, 0 failures, 0 errors | `/tmp/hlasimse-e2e-5211141-ios` |
| Android | Medium Phone Emulator | Android 16 / API 36 | 28/28 tests passed, 0 failures, 0 errors | `/tmp/hlasimse-e2e-5211141-android` |

Both runs used Maestro 2.6.1, exited with code 0, and recorded `run_mode=full`,
`release_evidence_eligible=true`, `journey_completed=true`, and clean start/end source trees. Their
start/end commits and trees match. Their `run.properties` SHA-256 values are:

- iOS: `07d8f5bb180806a47f042c378dc676a61cbaf2608e8dc42495e7e3b4f0a5e8e4`
- Android: `8e21831621e3f0efe0afa89a65d1e95b3b244cc821702edeca5067fc52032633`

The iOS runner created device `Hlásím se E2E 20260721T072827Z-21036`
(`C7DACE24-939A-4C28-8DFF-BDEEDA0F9D74`). It verified a release-derived ad-hoc-signed simulator
build, a byte-identical production/E2E embedded JS bundle, packaged-versus-installed app integrity,
and successful backend, PostgreSQL, build, and device cleanup. Its in-place same-build reinstall
retained authentication, the selected non-default profile, credential-free local sentinel state,
and the expected server-confirmed check-in.

The Android runner created AVD `Hlasimse_E2E_20260721T070906Z_95316` from template
`Medium_Phone_API_36.1` and used `emulator-5554`. It verified release-derived embedded-bundle APK
assembly, production-manifest cleartext restrictions, lint, a fresh package install, an in-place
same-APK update, and successful backend, PostgreSQL, and device cleanup. The update retained
onboarding, authentication, and the selected non-default profile. The APK is test-only debug signed,
not store signed.

On both platforms the real foreground-location prompt was denied and the resulting PostgreSQL
check-in was verified without latitude, longitude, or accuracy. The matrix also covers guardian
incident acknowledgement with server identity and timestamp, confirmed check-in, pause/resume,
archived history, an inert archived profile, a distinct 36-hour custom pause, exact account-name
persistence across restart, creation of a second free profile, account export, account deletion, and
the complete free boundaries: five active profiles, five active guardians, prevention of further
additions at those boundaries, and the seven-day maximum interval. No payment or paywall path is
present.

The deterministic AT-08 API-outage journey passed independently on both platforms. It verified that
the unconfirmed request persisted across a process restart in `expo-secure-store`; that an incident
opened while the mobile request remained pending; and that API recovery synchronized the exact
queued check-in and resolved the exact same incident while preserving its audit and outbox identity.
The evidence records `general_purpose_plaintext_storage_absent=true` and
`audit_and_outbox_identity_verified=true` for both runs.

This remains simulator evidence, not production release approval. Both builds still use the
placeholder public application ID `com.anonymous.hlasimse` and a sentinel HTTPS configuration rather
than the real production endpoint. The runs reinstall the same build instead of a signed N-1 store
artifact. They do not prove production APNs/FCM delivery; background or terminated-app behavior;
iOS Focus; Android Doze or OEM restrictions; physical GPS; physical-device VoiceOver/TalkBack; or
real store signing and upgrade behavior. Production infrastructure, store credentials and signing,
approved legal/operator details, and physical iPhone and Android test passes therefore remain
mandatory release blockers.
