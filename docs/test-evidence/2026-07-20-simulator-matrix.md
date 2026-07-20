# Simulator matrix — 20 July 2026

This record summarizes the reviewed local Maestro runs for commit
`85023be21dee9ed57dbffbd8599f0f89047c7c69`. The subsequent commit `5c45922` changes only
construction of non-production credentials in the container CI harness; it does not change the
mobile application, backend behavior, or E2E flows.

| Platform | Device | OS/API | Result | Local raw evidence |
| --- | --- | --- | --- | --- |
| iOS | iPhone 17 Pro Simulator | iOS 26.5 | 8/8 flows passed, no retry | `/tmp/hlasimse-e2e/20260720T125246Z` |
| Android | Medium Phone Emulator | API 36.1 | 8/8 flows passed, no retry | `/tmp/hlasimse-e2e/20260720T125922Z` |

Both runs used Maestro 2.6.1 and exited with code 0. Their `run.properties` SHA-256 values are:

- iOS: `dca402aa5e6bea335a8a95ae509df1c67760d1a8d92272f02a771e9bd0977214`
- Android: `8037342a25048dcf05aa900e3072a8ca72852bc13bd9de18594f7e631de7676a`

The matrix covers clean onboarding, guardian incident acknowledgement, server-confirmed check-in,
pause/resume, history, a second free profile, an API outage with visibly unconfirmed offline queue,
recovery and synchronization, account export, account deletion, and the complete free boundaries:
5 profiles, no sixth-profile action, 5/5 active guardians, disabled further invitation, and the
7-day maximum interval.

This is simulator evidence only. It does not prove production APNs/FCM delivery, background or
terminated-app behavior, Focus/Doze/OEM restrictions, real GPS behavior, or physical-device
accessibility. Those physical-device checks remain mandatory release blockers.
