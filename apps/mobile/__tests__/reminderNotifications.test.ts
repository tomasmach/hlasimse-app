import * as Notifications from "expo-notifications";
import { cancelAllReminders, reconcileReminders, scheduleProfileReminders } from "../lib/reminderNotifications";
import { calibrateServerClock, resetServerClockForTests } from "../lib/serverClock";

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
const profile = (id: string, deadline = new Date(Date.now() + 3 * 3600000).toISOString()) => ({ id, name: `Profil ${id}`, enabled: true, is_paused: false, paused_until: null, next_deadline_at: deadline });

beforeEach(() => {
  jest.clearAllMocks();
  getAll.mockResolvedValue([]);
  const now = Date.now();
  calibrateServerClock(new Date(now).toISOString(), now, now);
});
afterEach(() => resetServerClockForTests());

it("uses profile-specific identifiers and schedules every active confirmed profile", async () => {
  await reconcileReminders([profile("a"), profile("b")]);
  expect(schedule).toHaveBeenCalledTimes(8);
  const identifiers = schedule.mock.calls.map(([input]) => input.identifier);
  expect(identifiers).toContain("checkin-reminder-a-deadline");
  expect(identifiers).toContain("checkin-reminder-b-deadline");
  expect(identifiers.every((id: string) => id.startsWith("checkin-reminder-a-") || id.startsWith("checkin-reminder-b-"))).toBe(true);
});

it("schedules one daily best-effort reminder only for an indefinite pause", async () => {
  await reconcileReminders([
    { ...profile("indefinite"), is_paused: true, next_deadline_at: null },
    { ...profile("scheduled"), is_paused: true, paused_until: "2026-07-22T12:00:00.000Z", next_deadline_at: null },
    { ...profile("disabled"), enabled: false, is_paused: true, next_deadline_at: null },
    { ...profile("missing"), next_deadline_at: null },
  ]);
  expect(schedule).toHaveBeenCalledTimes(1);
  expect(schedule).toHaveBeenCalledWith(expect.objectContaining({
    identifier: "checkin-reminder-indefinite-indefinite-pause",
    content: expect.objectContaining({
      title: "Zkontrolujte pauzu bez konce",
      body: expect.stringContaining("lokální připomínku"),
      data: {
        type: "reminder",
        profile_id: "indefinite",
        reminder_kind: "indefinite_pause",
      },
    }),
    trigger: {
      type: 1,
      seconds: 86_400,
      repeats: true,
    },
  }));
  const body = schedule.mock.calls[0][0].content.body;
  expect(body).toContain("může odložit nebo potlačit");
  expect(body).not.toContain("server potvrdil");
});

it("replaces an indefinite-pause reminder with deadline reminders after resume", async () => {
  getAll.mockResolvedValue([
    { identifier: "checkin-reminder-a-indefinite-pause" },
    { identifier: "checkin-reminder-b-indefinite-pause" },
  ]);

  await scheduleProfileReminders(profile("a"));

  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith("checkin-reminder-a-indefinite-pause");
  expect(schedule.mock.calls.map(([input]) => input.identifier)).toContain("checkin-reminder-a-deadline");
});

it("removes pause reminders when a profile is archived from reconciliation", async () => {
  getAll.mockResolvedValue([
    { identifier: "checkin-reminder-archived-indefinite-pause" },
    { identifier: "other" },
  ]);

  await reconcileReminders([]);

  expect(cancel).toHaveBeenCalledTimes(1);
  expect(cancel).toHaveBeenCalledWith("checkin-reminder-archived-indefinite-pause");
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
