# Final simulator matrix — 21 July 2026

This record covers the final local release-derived Maestro matrix after selecting the owned public
application identity `cz.tomasmach.hlasimse` and completing the Django, deployment, legal-document,
native-permission, and release-gate hardening.

The Android application run used commit `0180f1c78e596fc4900ca45100f834ff4031c5c8` and Git tree
`0256b6269815b3c8470955dc7877f56057526814`. The iOS application run used commit
`fc63ae592621b95988b59f700fa46feee7276bf8` and tree
`2bd1da1ec4a900cf8bc571285e256e5b47f1de49`. The only change between those commits is the Maestro
helper fix that limits `hideKeyboard` to Android; no mobile or server application source changed.

Both runners used isolated PostgreSQL databases, fresh runner-owned virtual devices, embedded
release bundles, clean source-integrity checks, and complete owned-resource cleanup.

| Platform | Device | OS/API | Result | Local raw evidence |
| --- | --- | --- | --- | --- |
| Android | Medium Phone API 36.1 emulator | Android 16 / API 36 | 28/28 passed, 0 failures, 0 errors | `/tmp/hlasimse-e2e/android-final-0180f1c-20260721` |
| iOS | iPhone 17 Pro Simulator | iOS 26.5 / Xcode 26.5 | 14/14 passed, 0 failures, 0 errors | `/tmp/hlasimse-e2e/ios-final-fc63ae5-20260721` |

Both final runs used Maestro 2.6.1, exited with code 0, and recorded `run_mode=full`,
`release_evidence_eligible=true`, `journey_completed=true`, `source_clean_start=true`, and
`source_clean_end=true`.

Evidence identities:

- Android `run.properties` SHA-256:
  `ce8c1a18024a57852507f5c8c3dbdaa31213e1f03a13b24c8661b9d407a9c9ff`
- Android combined JUnit evidence SHA-256:
  `ea59bb13b21f18ff5714f98a52b56d5c20154dd4ebdb3ae0be242565cdb9a683`
- Android release-derived APK SHA-256:
  `2b3bd23d1896316413a5d1f1e8b5511ae993718da55a7893678f52ff9a1f9f5b`
- iOS `run.properties` SHA-256:
  `afed5468fa34bba4babd95644ca1aee18e59ac88f12070c442be894a5e054da0`
- iOS evidence-tree SHA-256:
  `6b35918feb488b9d87710e36701d0bcd2c354b97c9502ecab064777c593b694c`
- iOS production app SHA-256:
  `ceecb23c4978aea11a99a9135f079df39f1a51ef613b0089d6072fdab329fd08`
- iOS E2E app SHA-256:
  `6aeb2ab40b4605f70de81493b2050c7b60457f24e5121db03055b155a2cd83e4`
- iOS byte-identical production/E2E JS bundle SHA-256:
  `1df2b3f4f3ed636978dff1e880d87ece22c9ba90c7296711f740c97ab156b8a5`

The Android runner created AVD `Hlasimse_E2E_20260721T141807Z_65029` from the untouched
`Medium_Phone_API_36.1` template, using the Google Play arm64-v8a Android 16 image on
`emulator-5554`. It verified the production base identity `cz.tomasmach.hlasimse`, a fresh
`cz.tomasmach.hlasimse.e2e` package install, production cleartext denial, release-derived embedded
bundle assembly, lint, signing and package identity, then an in-place same-APK reinstall. The
reinstall preserved onboarding, authentication, credential-free local state, and the selected
non-default profile.

The final iOS runner created `Hlásím se E2E 20260721T145435Z-75154` from the untouched iPhone 17 Pro
template. It verified the production bundle identity `cz.tomasmach.hlasimse`, a fresh
`cz.tomasmach.hlasimse.e2e` install, Release build, ATS policy, simulator codesign and entitlements,
byte-identical production/E2E JavaScript, and packaged-versus-installed app-tree integrity. The
same-build reinstall preserved authentication, credential-free local sentinel state, the selected
non-default profile, and the expected server-confirmed check-in.

The first iOS attempt on `0180f1c` correctly failed fast after 12 passing reports when Maestro 2.6.1
could not perform a generic `hideKeyboard` inside the post-location helper. The location denial,
successful check-in, and visible denied state had already passed. Commit `fc63ae5` changed only that
test helper to use the already-proven iOS profile-form scroll behavior, after which a completely new
build, database, simulator, and all 14 flows passed. No mutating flow was resumed or selectively
retried.

Across both platforms the matrix covers registration/authentication, guardian incident
acknowledgement with server identity and timestamp, server-confirmed check-in, pause/resume,
archived history, inert archived profiles, a distinct 36-hour custom pause, exact account-name
persistence across restart, creation of a second free profile, account export, account deletion,
and the free-product boundaries: five active profiles, five guardians per profile, prevention of a
sixth addition, and the seven-day maximum interval. No payment, subscription, premium, trial, or
paywall path exists.

Both platforms denied the real foreground-location prompt and then verified the PostgreSQL check-in
without latitude, longitude, or accuracy. The deterministic API-outage journey verified that an
unconfirmed request survived process restart in `expo-secure-store`, an incident opened while the
mobile request remained pending, and API recovery synchronized that exact queued check-in and
resolved the same incident while preserving audit and outbox identity. General-purpose plaintext
credential storage was absent.

This is strong simulator evidence, not permission to publish. Android uses a debug test certificate;
iOS uses ad-hoc simulator signing. The isolated builds use a sentinel HTTPS production
configuration while routing the E2E identity to the runner-owned backend. Same-build reinstall is
not an N-1 store upgrade. The matrix does not prove production APNs/FCM delivery, provider receipt
reconciliation, background/terminated delivery, iOS Focus, Android Doze/OEM restrictions, physical
GPS, physical-device VoiceOver/TalkBack, or real store signing. Those facts remain fail-closed in
`docs/release/readiness-manifest.json` until the signed TestFlight and Play closed-track builds,
production deployment, physical devices, legal approval, and operations drills actually exist.
