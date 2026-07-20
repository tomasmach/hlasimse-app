import * as Notifications from "expo-notifications";
import { cancelAllReminders, reconcileReminders, scheduleProfileReminders } from "../lib/reminderNotifications";

jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue("mock-id"),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 1 },
  AndroidImportance: { HIGH: 4 },
}));

const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const getAll = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const profile = (id: string, deadline = new Date(Date.now() + 3 * 3600000).toISOString()) => ({ id, name: `Profil ${id}`, enabled: true, is_paused: false, next_deadline_at: deadline });

beforeEach(() => { jest.clearAllMocks(); getAll.mockResolvedValue([]); });

it("uses profile-specific identifiers and schedules every active confirmed profile", async () => {
  await reconcileReminders([profile("a"), profile("b")]);
  expect(schedule).toHaveBeenCalledTimes(8);
  const identifiers = schedule.mock.calls.map(([input]) => input.identifier);
  expect(identifiers).toContain("checkin-reminder-a-deadline");
  expect(identifiers).toContain("checkin-reminder-b-deadline");
  expect(identifiers.every((id: string) => id.startsWith("checkin-reminder-a-") || id.startsWith("checkin-reminder-b-"))).toBe(true);
});

it("does not schedule paused, disabled, or missing-deadline profiles", async () => {
  await reconcileReminders([
    { ...profile("paused"), is_paused: true },
    { ...profile("disabled"), enabled: false },
    { ...profile("missing"), next_deadline_at: null },
  ]);
  expect(schedule).not.toHaveBeenCalled();
});

it("replaces reminders only for the updated profile", async () => {
  getAll.mockResolvedValue([
    { identifier: "checkin-reminder-a-deadline" },
    { identifier: "checkin-reminder-b-deadline" },
    { identifier: "some-other-notification" },
  ]);
  await scheduleProfileReminders(profile("a"));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith("checkin-reminder-a-deadline");
});

it("states that provider notification is best-effort after the deadline", async () => {
  await scheduleProfileReminders(profile("safety"));
  const afterDeadline = schedule.mock.calls.map(([input]) => input).find((input) => input.identifier.endsWith("30min-after"));
  expect(afterDeadline.content.body).toContain("pokusit se upozornit");
  expect(afterDeadline.content.body).toContain("nelze garantovat");
});

it("skips reminder times already in the past", async () => {
  await scheduleProfileReminders(profile("soon", new Date(Date.now() + 10 * 60000).toISOString()));
  const identifiers = schedule.mock.calls.map(([input]) => input.identifier);
  expect(identifiers).not.toContain("checkin-reminder-soon-1h-before");
  expect(identifiers).toContain("checkin-reminder-soon-deadline");
});

it("cancels only reminders owned by Hlásím se", async () => {
  getAll.mockResolvedValue([{ identifier: "checkin-reminder-a-deadline" }, { identifier: "other" }]);
  await cancelAllReminders();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith("checkin-reminder-a-deadline");
});
