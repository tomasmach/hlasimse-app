# Simulator matrix — 20 July 2026

This record summarizes the reviewed local Maestro runs for the application and backend at commit
`83cd6107d98c527828dd7e152919fe5cedaa1650` (`83cd610`). The Android run uses subsequent commit
`030c9b1317f8a175e6412cf9a5c399682a5623b0` (`030c9b1`), which changes only the Android evidence
harness and its documentation. Both runners started an isolated PostgreSQL database, used a fresh
runner-created simulator/emulator, executed every flow once, and finished with source and cleanup
checks intact.

| Platform | Device | OS/API | Result | Local raw evidence |
| --- | --- | --- | --- | --- |
| iOS | iPhone 17 Pro Simulator | iOS 26.5 | 11/11 flows passed, no retry | `/tmp/hlasimse-e2e/ios-release-full-retry1-83cd610` |
| Android | Medium Phone Emulator | Android 16 / API 36.1 | 24/24 flows passed, no retry | `/tmp/hlasimse-e2e/android-full-030c9b1` |

Both runs used Maestro 2.6.1 and exited with code 0. Their `run.properties` SHA-256 values are:

- iOS: `a3bf08919fde89e7d81aaadfcb6289ca55fe48657df87e8e2a74fded247e311c`
- Android: `e3a16ad89514217716921d57c824bd7b280d67b6863f7c82c5c319c9d18dce0a`

The iOS run records `run_mode=full`, `release_evidence_eligible=true`, a fresh owned simulator,
byte-identical production/E2E JS bundles, a complete packaged-versus-installed app-tree match, and
successful cleanup. Its same-bundle reinstall retained a credential-free `0600` Documents sentinel,
the authenticated session, the selected non-default profile, and exactly one server-confirmed
check-in on that profile. The absolute CoreSimulator data-container path changed and is correctly
treated as diagnostic rather than a preservation invariant.

The Android run records `run_mode=full`, `release_evidence_eligible=true`, a fresh owned AVD, an
embedded JS bundle, a fresh package install, and successful cleanup. It explicitly records the
E2E-only local networking allowance, the HTTPS-sentinel/non-production endpoint coverage, and its
release-derived emulator/debug-test-signed/non-store-signed artifact scope. It also records
`update_artifact_relation=same-built-apk-reinstall-not-n-minus-one`, `n_minus_one_coverage=false`,
and `store_signed_update_coverage=false`. The reinstall retained onboarding, authentication, and
the selected non-default profile. The real foreground-location prompt was denied on both platforms;
each resulting PostgreSQL check-in row was verified without latitude, longitude, or accuracy.

The matrix also covers guardian incident acknowledgement, server-confirmed check-in, pause/resume,
history, a second free profile, an owned API outage with visibly unconfirmed offline state, recovery
and synchronization, account export, account deletion, and the complete free boundaries: 5 active
profiles, no sixth-profile action, 5/5 active guardians, disabled further invitation, and the 7-day
maximum interval. No paywall or payment path is present in these journeys.

This is simulator evidence only. The iOS artifact is ad-hoc signed and the Android artifact uses a
test-only debug certificate. Both still use the placeholder public application ID
`com.anonymous.hlasimse`; choosing and configuring the final owned ID is a release blocker. These
production-like builds use a sentinel HTTPS configuration rather than the real production endpoint;
the isolated E2E identities route only to the runner-owned local backend. The runs reinstall the
same build rather than an N-1 store artifact and do not prove production APNs/FCM delivery,
background or terminated-app behavior, Focus/Doze/OEM restrictions, real GPS behavior, or
physical-device accessibility. Those store, production-infrastructure, and physical-device checks
remain mandatory release blockers.
