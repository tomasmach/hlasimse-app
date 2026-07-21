# Simulator end-to-end flows

These flows exercise the local Django API through a native Expo development build. Run them
through `scripts/e2e/run-ios.sh` or `scripts/e2e/run-android.sh`; their order is significant.

Both runners require Docker. Each run creates its own pinned PostgreSQL 18.4 container with an
explicit `hlasimse_e2e` database, tmpfs-only data, and a Docker-assigned port published only on
`127.0.0.1`. The harness replaces any inherited `DATABASE_URL`, migrates this isolated database,
and writes a credential-free PostgreSQL vendor assertion to
`backend/database-assertion.json`. Cleanup records the exact container ID and verifies its unique
run label before removal; it never reuses or removes an unrelated container, database, or volume.

Release evidence is accepted only from committed, clean runtime and harness inputs. Before device
work starts, the runners fail closed on tracked, staged, or relevant untracked changes. At cleanup
they verify the same commit and tree again, then atomically publish sorted `run.properties` with
the source tree, run mode, app version/build, device/runtime identity, toolchain version, and
platform artifact identity. Unrelated user-owned root documents are outside this source gate.
Every Maestro flow is single-attempt; a failed mutating flow is never replayed automatically.

The runner first seeds two reserved `.invalid` accounts plus one inert archived-history profile,
acknowledges an already-open incident as the guardian, resolves it with an owner check-in, and
then proves that the owner sees the guardian acknowledgement name, server timestamp, and its
limited "incident was opened" meaning. The Activity archive picker must expose the archived
profile and its `profile.archived` event without changing the operational profile or exposing
check-in, pause, or edit controls. A custom native date/time pause is server-confirmed before the
profile is resumed. The owner then changes the account name, verifies it after an app restart,
and the harness checks both changes directly in PostgreSQL. It continues with a second free profile,
forces a local API outage to prove that an offline request remains visibly unconfirmed, advances
the exact selected profile through a scheduler-created incident without changing its one-hour
production interval, restarts the app while that encrypted SecureStore request is still pending,
then restores the API and proves that sync resolves that same audited incident while preserving
both opened/resolved outbox events. It then requests an export and deletes the owner fixture before reseeding a bounded
six-account fixture to assert the visible 5-profile, 5-guardian, and 7-day free-tier boundaries
before guarded cleanup.

For accepted full-run evidence, the iOS UDID is a template only. The runner resolves that exact
available simulator's `deviceTypeIdentifier` and runtime from `simctl` JSON, creates a uniquely
named simulator with the same pair, and records both identities plus
`device_origin=fresh-runner-created` and `device_owned=true`. The fresh simulator is used for the
entire baseline, location-denial, and same-bundle-install journey. Only after evidence is
redacted/finalized and the owned PostgreSQL/backend processes are stopped does cleanup shut down
and delete that one runner-created UDID. It never erases or deletes the template or another
simulator. `E2E_IOS_REUSE_TEMPLATE=true` is an explicit diagnostic escape hatch; its metadata says
`device_origin=diagnostic-template-reuse` and the resulting run is not fresh-device release
evidence; its run mode is `diagnostic-template-reuse`, never `full`. No lifecycle path performs a
broad keychain reset.

The iOS runner additionally resets foreground-location permission, proves that denying the native
prompt does not block a server-confirmed check-in, verifies the resulting database row contains no
coordinates, and performs an in-place same-bundle install. Before that install it selects a
non-default profile whose ID is persisted in SecureStore. The post-install flow proves that local
selection survives and creates exactly one server-confirmed check-in on that profile. The
runner also writes a credential-free `0600` sentinel into the app's `Documents` directory before
reinstall and verifies its exact SHA-256 through the newly resolved container path afterwards.
The absolute CoreSimulator data-container path remains diagnostic only because the simulator may
relocate it during installation. The final preservation claim is published only after the sentinel,
authenticated UI state, selected profile, exactly-one check-in delta, and database profile assertion
all pass. This is an installation-preservation gate; a true N-1-to-N migration still requires a
signed previous-release artifact. Set
`E2E_IOS_FOCUSED_ONLY=true` only when rerunning these focused iOS gates after a separately recorded
green baseline journey on the same commit.

The flows deliberately avoid claiming push delivery. iOS Simulator and Android Emulator do not
prove the production APNs/FCM path or background delivery behavior on physical devices.

The Android runner additionally reinstalls the freshly built APK with Package Manager's in-place
update mode and proves that completed onboarding, the authenticated session, selected profile,
and authenticated API access survive. It then denies the real
foreground-location system prompt, confirms that check-in still succeeds, and verifies in Django
that the accepted record contains no coordinates. This proves same-schema update/data retention
semantics for the tested build; a migration from an older released artifact requires that exact
signed predecessor APK and is a separate release gate.

Selectors prefer stable React Native `testID` values. Czech text selectors are limited to native
confirmation dialogs, share-sheet behavior, and assertions whose wording is itself part of the
safety contract.
