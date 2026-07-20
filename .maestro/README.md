# Simulator end-to-end flows

These flows exercise the local Django API through a native Expo development build. Run them
through `scripts/e2e/run-ios.sh` or `scripts/e2e/run-android.sh`; their order is significant.

The runner seeds exactly two reserved `.invalid` accounts, acknowledges an already-open incident
as the guardian, resolves it with an owner check-in, tests pause/resume and a second free profile,
forces a local API outage to prove that an offline request remains visibly unconfirmed, restores
the API and syncs it, requests an export, and deletes the owner fixture last.

The flows deliberately avoid claiming push delivery. iOS Simulator and Android Emulator do not
prove the production APNs/FCM path or background delivery behavior on physical devices.

Selectors should prefer stable React Native `testID` values. Czech text selectors are currently
limited to native confirmation dialogs, share-sheet behavior, and onboarding screens that do not
yet expose stable IDs.
