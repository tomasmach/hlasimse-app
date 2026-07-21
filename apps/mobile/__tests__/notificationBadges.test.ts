import * as Notifications from "expo-notifications";
import { syncIncidentBadge } from "@/lib/notificationBadges";

const setBadge = Notifications.setBadgeCountAsync as jest.Mock;
beforeEach(() => jest.clearAllMocks());

it("recomputes the badge from open incidents and clears a stale badge", async () => {
  await expect(syncIncidentBadge([{ status: "open" }, { status: "resolved" }, { status: "open" }])).resolves.toBe(2);
  expect(setBadge).toHaveBeenLastCalledWith(2);
  await expect(syncIncidentBadge([{ status: "resolved" }])).resolves.toBe(0);
  expect(setBadge).toHaveBeenLastCalledWith(0);
});

it("keeps badge failures best-effort", async () => {
  setBadge.mockRejectedValueOnce(new Error("unsupported launcher"));
  await expect(syncIncidentBadge([{ status: "open" }])).resolves.toBe(1);
});
