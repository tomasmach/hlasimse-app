# Release test evidence

This directory documents the evidence format and release gates. Successful local simulator runs
remain in the run-specific artifact directory until their raw evidence is reviewed. The runner
writes logs, JUnit reports, screenshots, build logs, seed output,
the tested Git commit, and exit status to a timestamped directory under `/tmp/hlasimse-e2e/` by
default. Copy an immutable run summary here only after reviewing those raw artifacts.

## Deterministic simulator suite

Prerequisites:

- Node.js compatible with the mobile package, npm dependencies installed, and Expo CLI available
- Python 3.14 and `uv`
- Docker for the runner-owned, pinned PostgreSQL 18.4 E2E database
- Maestro 2.6.1, the pinned and tested harness version (override `E2E_MAESTRO_BIN` when it is installed elsewhere)
- Xcode/iOS Simulator for iOS, or Android SDK/ADB and the named AVD for Android
- ports 8000 and 8081 free; the runner refuses to stop or reuse an unowned backend on 8000
- a development build identity in `apps/mobile/app.json`
- a clean committed runtime/harness source scope; the runner records and rechecks its Git tree

Validate the harness without launching a device:

```bash
scripts/e2e/validate.sh
cd apps/server && uv run pytest \
  tests/test_seed_e2e_command.py \
  tests/test_e2e_offline_deadline_command.py -q
```

Run iOS from one available template simulator by exact UDID:

```bash
IOS_SIMULATOR_UDID=<exact-udid> scripts/e2e/run-ios.sh
```

The runner does not execute the release-evidence journey on that template. It reads the template's
exact device type and runtime from available-device JSON, creates a unique fresh simulator with
the same pair, and uses the new UDID for the complete journey, including the in-place same-bundle
install. `run.properties` distinguishes the template and active device and records
`device_origin=fresh-runner-created` plus `device_owned=true`. Cleanup publishes/redacts evidence
only after it deletes the exact runner-created UDID, removes the runner-owned build directory,
and stops the isolated backend/PostgreSQL. The template and all unrelated simulators remain
untouched even after a failed run. `E2E_IOS_REUSE_TEMPLATE=true` exists only for explicit local diagnosis; runs marked
`device_origin=diagnostic-template-reuse` and `run_mode=diagnostic-template-reuse` are not accepted
as fresh-device release evidence.

The iOS runner compiles one production-like `Release` app with an embedded JS bundle and an HTTPS
endpoint sentinel. Its simulator-only E2E copy keeps that JS bundle byte-identical, changes only
the intended plist identity/ATS values, preserves the extracted entitlements, and is ad-hoc
re-signed (which also updates signature material). The app selects loopback only when the native
application ID ends in `.e2e`; the production identity keeps the HTTPS endpoint. This avoids
environment-sensitive Metro transform-cache reuse while testing the same JS that is present in the
production-like Release artifact. It is simulator evidence, not a store-signed artifact, real
production-endpoint check, or N-1 update test.
Before signing the isolated copy, the runner also verifies that every embedded framework's exact
`CFBundleExecutable` arrives from Xcode with mode `0644` or `0755`, preserves existing `0644`
entries, and normalizes only `0755` entries to CoreSimulator's installed `0644`. The current pinned
dependency packaging is expected to contain both input modes, so an unexpected Xcode or dependency
packaging change fails closed for review.
Byte content and the production app remain unchanged. The installed app must then match the
isolated copy across every path, byte, symlink, and POSIX mode.

Run Android using an existing AVD only as an immutable device/image template:

```bash
ANDROID_TEMPLATE_AVD_NAME=Medium_Phone_API_36.1 scripts/e2e/run-android.sh
```

The Android runner refuses an externally supplied serial. It reads the template's exact device
profile and system image, creates a fresh runner-owned headless AVD in an isolated temporary home,
and deletes only that owned AVD during cleanup. A successful full run records
`release_evidence_eligible=true`; any future mode or device origin that is not exactly `full`,
`fresh-runner-created`, and owned records `false`. Eligibility describes the harness/device scope,
not success: `exit_code=0`, `journey_completed=true`, clean source identity, and successful cleanup
remain mandatory.

The Android in-place install deliberately reuses the exact freshly built APK. Its evidence records
`e2e_local_networking_allowed=true` for the E2E-only cleartext `10.0.2.2` transport,
`production_endpoint_coverage=https-sentinel-release-manifest-configuration-not-real-production-endpoint`,
and `artifact_scope=release-derived-android-emulator-debug-test-signed-not-store-signed`. The
production release manifest task uses the HTTPS sentinel configuration and its merged manifest
does not permit cleartext, but this run does not exercise a real production endpoint or a
store-signed APK. The in-place update evidence additionally records
`update_artifact_relation=same-built-apk-reinstall-not-n-minus-one`,
`n_minus_one_coverage=false`, and `store_signed_update_coverage=false`. It proves state preservation
for that same release-derived test artifact only; it does not satisfy the physical-device N-1 or
store-signing gates below.

## Covered by each simulator journey

| Area | Deterministic assertion |
| --- | --- |
| Clean install | app data is cleared, onboarding completes, verified guardian logs in |
| Incident | seeded overdue deadline is visible; guardian acknowledgement is server-confirmed |
| Guardian relation | guardian sees the watched profile; owner sees the active guardian |
| Check-in | owner resolves the open incident only after the server confirms the check-in |
| Location refusal | the real native permission prompt is denied; check-in still succeeds and the exact new PostgreSQL row has `NULL` latitude, longitude, and accuracy |
| Same-bundle install | a credential-free `0600` Documents sentinel retains its SHA-256 through the newly resolved container path; authenticated state and a non-default SecureStore profile selection survive; the post-install server journey uses that profile exactly once |
| Pause | pause and resume each require a native confirmation and a changed server state |
| Profiles/free tier | owner creates a second 1-hour profile without payment or paywall; a separately seeded boundary fixture shows exactly 5 active profiles and no sixth-profile action |
| Guardian/free tier | the selected boundary profile shows exactly 5/5 active guardians and a disabled invitation action |
| Interval/free tier | the selected boundary profile exposes the server-seeded upper bound of 10,080 minutes (7 days) in profile management |
| History/statistics | server-confirmed check-in, resolved incident, and metric sections load |
| Offline semantics / AT-08 | the owned API process is stopped; the request is stored through `expo-secure-store`, labeled pending, survives an app-process restart and remains pending while the exact server deadline passes |
| Recovery / AT-08 | the real scheduler opens an incident and `alert.opened` outbox event; after API restart the queued request receives a later server acceptance, resolves that exact incident, remains in all three audit records and creates `alert.resolved`; UI shows the pending state, later-sync provenance, incident opening and confirmed resolution |
| Export | server export opens the operating-system share sheet and reports completion |
| Deletion | owner enters the fixture password, confirms destructive action, and returns to login |
| Evidence provenance | the full run uses isolated PostgreSQL and records a clean commit/tree, device/runtime, toolchain, app build, and platform artifact identity |

The delete flow targets only `e2e.owner@hlasimse.invalid`. After it completes, the runner seeds a
separate boundary fixture containing exactly five active profiles and five active guardians on the
selected 7-day profile. Before every seed mode, `seed_e2e` removes delivery attempts and outbox
events belonging to the six exact reserved accounts, then resets only their normal FK graph. It
refuses `DEBUG=False`, non-local SQLite, remote PostgreSQL, and PostgreSQL
database names without a distinct `e2e` or `test` segment.
Each platform runner generates a fresh random login credential in memory and passes it to the seed
and Maestro processes through environment variables. The value is never printed or stored in the
seed output. The runner redacts the value from Maestro console output and all generated textual
artifacts after every flow. Treat screenshots and diagnostic trees as sensitive anyway; keep
`/tmp/hlasimse-e2e/` local and delete it after the evidence review.
After a completely successful journey, `cleanup-only` removes the remaining boundary fixture and
its bounded graph. A failed run intentionally leaves its reserved `.invalid` fixture available for
diagnosis; rerunning the seed or calling its guarded cleanup mode removes it safely.

### AT-08 cross-layer evidence schema

Both full platform runners publish the same credential-free AT-08 evidence set:

- `backend/at08-incident-opened.json` — schema version, exact profile/generation/incident IDs,
  unchanged 3,600-second production interval, scheduler counts, and exact opened audit/outbox IDs;
- `maestro/20_owner_offline_queue/report.xml` — the API is down and the app visibly marks one request
  pending rather than successful;
- `maestro/25_owner_offline_deadline_pending/report.xml` — after the scheduler transition and an app
  process restart, the same SecureStore-backed request is still pending with the original deadline;
- `maestro/30_owner_offline_sync/report.xml` — after API restart, UI shows later synchronization,
  one resolved incident, the retained incident-opened timeline item and confirmed resolution;
- `backend/at08-incident-resolved.json` — exact identity continuity, queued check-in provenance and
  temporal ordering, opened/resolved/check-in audit IDs, and opened/resolved outbox IDs;
- `backend/at08-evidence.json` — fail-closed schema validation joining the three UI reports, both
  database phases, and the tested source's exclusive use of `expo-secure-store` rather than a
  general-purpose plaintext persistence API.

`exercise_e2e_offline_deadline` is disabled outside `DEBUG`, rejects remote or non-E2E databases,
requires the generated run credential plus explicit profile/incident UUIDs, and authenticates the
reserved owner. Its open phase changes only that existing profile's deadline timestamp, runs the
real deadline sweep, and verifies that the production minimum interval remains 3,600 seconds. It
does not relax model/API validation or create an alternate authentication path.

## Physical-device release gates

Simulator green status is necessary but cannot make the product safe to release. Before public
release, retain signed evidence from at least one supported physical iPhone and one representative
physical Android device for all of the following:

- APNs and FCM/Expo token registration, rotation, reinstall, invalid-token cleanup, provider ticket,
  receipt, retry, and dead-letter behavior
- alert reception while foregrounded, backgrounded, force-quit/terminated, screen locked, and after
  device restart
- iOS Focus/notification-summary states and Android Doze, battery optimization, background limits,
  notification channels, and at least one OEM-restricted device
- Wi-Fi-to-cellular transitions, complete loss and restoration of connectivity, clock/time-zone
  change, process death during a pending request, and duplicate-tap idempotency
- notification deep link into the correct incident after cold start, revoked guardian denial, and
  absence of location or other sensitive content on the lock screen
- real foreground location permission grant/deny/limited accuracy and confirmation that refusal
  never blocks a check-in
- actual transactional email delivery through the selected production SMTP provider, verification,
  resend throttling, expiry, replay rejection, invitation, and password reset
- accessibility checks with VoiceOver and TalkBack, large text, reduced motion, color contrast, and
  Czech screen-reader labels
- production monitoring and on-call drill for stalled sweep/outbox/receipt workers, database restore,
  provider outage, and reconciliation gaps

Push remains best-effort even after all gates pass. Evidence must never reword a provider ticket as
delivery, a delivery receipt as reading, or an acknowledgement as physical help. Hlásím se is not a
replacement for 112 or 155.
