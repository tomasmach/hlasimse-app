# Release test evidence

This directory documents the evidence format and release gates. It does not contain a successful
simulator run yet. The runner writes raw logs, JUnit reports, screenshots, build logs, seed output,
the tested Git commit, and exit status to a timestamped directory under `/tmp/hlasimse-e2e/` by
default. Copy an immutable run summary here only after reviewing those raw artifacts.

## Deterministic simulator suite

Prerequisites:

- Node.js compatible with the mobile package, npm dependencies installed, and Expo CLI available
- Python 3.14 and `uv`
- Maestro 2.4 or newer (override `E2E_MAESTRO_BIN` when it is installed elsewhere)
- Xcode/iOS Simulator for iOS, or Android SDK/ADB and the named AVD for Android
- ports 8000 and 8081 free; the runner refuses to stop or reuse an unowned backend on 8000
- a development build identity in `apps/mobile/app.json`

Validate the harness without launching a device:

```bash
scripts/e2e/validate.sh
cd apps/server && uv run pytest tests/test_seed_e2e_command.py -q
```

Run one available iOS simulator by exact UDID:

```bash
IOS_SIMULATOR_UDID=<exact-udid> scripts/e2e/run-ios.sh
```

Run Android on an already booted emulator, or let the runner start the configured AVD:

```bash
ANDROID_AVD_NAME=Medium_Phone_API_36.1 scripts/e2e/run-android.sh
```

The Android runner leaves a simulator it started running unless
`E2E_STOP_EMULATOR=true` is set. Both runners stop only backend/Metro processes they started. Expo
may generate managed native `ios/` or `android/` build directories when they are absent; review
those generated files after a run instead of deleting pre-existing native projects.
An already-running Metro process is rejected because its baked-in API URL cannot be inferred. Set
`E2E_REUSE_METRO=true` only after independently proving it was started with the platform-specific
URL (`127.0.0.1` for iOS Simulator, `10.0.2.2` for Android Emulator).

## Covered by each simulator journey

| Area | Deterministic assertion |
| --- | --- |
| Clean install | app data is cleared, onboarding completes, verified guardian logs in |
| Incident | seeded overdue deadline is visible; guardian acknowledgement is server-confirmed |
| Guardian relation | guardian sees the watched profile; owner sees the active guardian |
| Check-in | owner resolves the open incident only after the server confirms the check-in |
| Pause | pause and resume each require a native confirmation and a changed server state |
| Profiles/free tier | owner creates a second 120-minute profile without payment or paywall |
| History/statistics | server-confirmed check-in, resolved incident, and metric sections load |
| Offline semantics | owned API process is stopped; request is labeled pending and deadline unchanged |
| Recovery | API returns; queued request syncs and appears as later synchronization in history |
| Export | server export opens the operating-system share sheet and reports completion |
| Deletion | owner enters the fixture password, confirms destructive action, and returns to login |

The delete flow targets only `e2e.owner@hlasimse.invalid`. Before every run, `seed_e2e` removes
delivery attempts and outbox events belonging to the two exact reserved accounts, then resets only
their normal FK graph. It refuses `DEBUG=False`, non-local SQLite, remote PostgreSQL, and PostgreSQL
database names without a distinct `e2e` or `test` segment.
Each platform runner generates a fresh random login credential in memory and passes it to the seed
and Maestro processes through environment variables. The value is never printed or stored in the
seed output. The runner redacts the value from Maestro console output and all generated textual
artifacts after every flow. Treat screenshots and diagnostic trees as sensitive anyway; keep
`/tmp/hlasimse-e2e/` local and delete it after the evidence review.
After a completely successful journey, `cleanup-only` removes the remaining guardian fixture and
its bounded graph. A failed run intentionally leaves its reserved `.invalid` fixture available for
diagnosis; rerunning the seed or calling its guarded cleanup mode removes it safely.

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
