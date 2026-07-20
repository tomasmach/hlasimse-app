# Simulator end-to-end flows

These flows exercise the local Django API through a native Expo development build. Run them
through `scripts/e2e/run-ios.sh` or `scripts/e2e/run-android.sh`; their order is significant.

The runner first seeds two reserved `.invalid` accounts, acknowledges an already-open incident
as the guardian, resolves it with an owner check-in, tests pause/resume and a second free profile,
forces a local API outage to prove that an offline request remains visibly unconfirmed, restores
the API and syncs it, requests an export, and deletes the owner fixture. It then reseeds a bounded
six-account fixture to assert the visible 5-profile, 5-guardian, and 7-day free-tier boundaries
before guarded cleanup.

The flows deliberately avoid claiming push delivery. iOS Simulator and Android Emulator do not
prove the production APNs/FCM path or background delivery behavior on physical devices.

Selectors prefer stable React Native `testID` values. Czech text selectors are limited to native
confirmation dialogs, share-sheet behavior, and assertions whose wording is itself part of the
safety contract.
