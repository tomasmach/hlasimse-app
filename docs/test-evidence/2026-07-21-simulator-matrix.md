# Simulator matrix — 21 July 2026

This record summarizes the final reviewed local Maestro runs after the safety and release-readiness
hardening. The iOS run exercised commit `120e49b2ae31b101911fe1460a41a483b9afbc5f`
(`120e49b`). The Android run exercised commit `74ee535c180077604b2c169d60c2389344511fca`
(`74ee535`). The only changes between those commits are visible-wait anchors in two Android-only
Maestro flows (`00c_android_guardian_after_login` and `05_android_update_preserves_state`); no iOS
flow or runtime source changed.

Both runners started an isolated PostgreSQL database, created a fresh simulator or emulator, ran
every mutating flow exactly once, and completed their source-integrity and cleanup checks.

| Platform | Device | OS/API | Result | Local raw evidence |
| --- | --- | --- | --- | --- |
| iOS | iPhone 17 Pro Simulator | iOS 26.5 | 12/12 tests passed, 0 failures, 0 errors | `/tmp/hlasimse-e2e-final-120e49b-ios` |
| Android | Medium Phone Emulator | Android 16 / API 36.1 | 25/25 tests passed, 0 failures, 0 errors | `/tmp/hlasimse-e2e-final-74ee535-android` |

Both runs used Maestro 2.6.1, exited with code 0, and recorded `run_mode=full`,
`release_evidence_eligible=true`, `journey_completed=true`, and clean start/end source trees. Their
`run.properties` SHA-256 values are:

- iOS: `2198c595da76c6cdfbb7e3a590f62f23ffcb869beaee769a4a1640350abe1f53`
- Android: `efccc1b008c3a1ab78549a2ef7a5421d79cab4c47bf8e94cd3b9f5320ce2ff6b`

The iOS runner created device `Hlásím se E2E 20260721T010212Z-45287`
(`D2F9E541-9CBA-42F9-A0D5-F9F99D1CFCA4`). It verified a release-derived ad-hoc-signed simulator
build, a byte-identical production/E2E embedded JS bundle, packaged-versus-installed app integrity,
and successful cleanup. Its in-place same-build reinstall retained authentication, the selected
non-default profile, credential-free local sentinel state, and the expected server-confirmed
check-in.

The Android runner created AVD `Hlasimse_E2E_20260721T012221Z_64890` from template
`Medium_Phone_API_36.1` and used `emulator-5554`. It verified release-derived embedded-bundle APK
assembly, a fresh package install, an in-place same-APK update, and successful cleanup. The update
retained onboarding, authentication, and the selected non-default profile. The APK is test-only
debug signed, not store signed.

On both platforms the real foreground-location prompt was denied and the resulting PostgreSQL
check-in was verified without latitude, longitude, or accuracy. The matrix also covers guardian
incident acknowledgement, confirmed check-in, pause/resume, history, creation of a second free
profile, account export, account deletion, and the complete free boundaries: five active profiles,
five active guardians, prevention of further additions at those boundaries, and the seven-day
maximum interval. No payment or paywall path is present.

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
iOS Focus; Android Doze or OEM restrictions; physical GPS; physical-device accessibility; or real
store signing and upgrade behavior. Production infrastructure, store credentials and signing,
approved legal/operator details, and physical iPhone and Android test passes therefore remain
mandatory release blockers.
