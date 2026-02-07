import {
  scheduleReminders,
  cancelAllReminders,
} from "../lib/reminderNotifications";
import * as Notifications from "expo-notifications";

// Mock expo-notifications
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn().mockResolvedValue("mock-id"),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: 1,
  },
  AndroidImportance: {
    HIGH: 4,
  },
}));

const mockSchedule = Notifications.scheduleNotificationAsync as jest.Mock;
const mockGetAll = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
const mockCancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAll.mockResolvedValue([]);
});

describe("scheduleReminders", () => {
  it("schedules 4 notifications for a deadline far in the future", async () => {
    const deadline = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(); // 3 hours from now

    await scheduleReminders(deadline);

    expect(mockSchedule).toHaveBeenCalledTimes(4);

    // Check identifiers
    const identifiers = mockSchedule.mock.calls.map(
      (call: unknown[]) => (call[0] as { identifier: string }).identifier
    );
    expect(identifiers).toContain("checkin-reminder-1h-before");
    expect(identifiers).toContain("checkin-reminder-15min-before");
    expect(identifiers).toContain("checkin-reminder-deadline");
    expect(identifiers).toContain("checkin-reminder-30min-after");
  });

  it("skips notifications whose time has already passed", async () => {
    // Deadline is 10 minutes from now — 1h-before is in the past
    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await scheduleReminders(deadline);

    const identifiers = mockSchedule.mock.calls.map(
      (call: unknown[]) => (call[0] as { identifier: string }).identifier
    );
    expect(identifiers).not.toContain("checkin-reminder-1h-before");
    expect(identifiers).not.toContain("checkin-reminder-15min-before");
    expect(identifiers).toContain("checkin-reminder-deadline");
    expect(identifiers).toContain("checkin-reminder-30min-after");
  });

  it("skips all notifications if deadline is in the past", async () => {
    const deadline = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago

    await scheduleReminders(deadline);

    // Only the +30min-after could be in the future if deadline was -1h ago => -1h + 30min = -30min => still past
    // All should be skipped
    expect(mockSchedule).not.toHaveBeenCalled();
  });

  it("cancels existing reminders before scheduling new ones", async () => {
    mockGetAll.mockResolvedValue([
      { identifier: "checkin-reminder-1h-before" },
      { identifier: "checkin-reminder-deadline" },
      { identifier: "some-other-notification" },
    ]);

    const deadline = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await scheduleReminders(deadline);

    // Should cancel only the 2 with our prefix
    expect(mockCancel).toHaveBeenCalledTimes(2);
    expect(mockCancel).toHaveBeenCalledWith("checkin-reminder-1h-before");
    expect(mockCancel).toHaveBeenCalledWith("checkin-reminder-deadline");
  });

  it("uses correct titles and bodies", async () => {
    const deadline = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    await scheduleReminders(deadline);

    const calls = mockSchedule.mock.calls.map(
      (call: unknown[]) => call[0] as { identifier: string; content: { title: string; body: string } }
    );

    const find = (id: string) => calls.find((c) => c.identifier === `checkin-reminder-${id}`);

    expect(find("1h-before")?.content.title).toBe("Nezapomeň se ohlásit");
    expect(find("1h-before")?.content.body).toBe("Do dalšího hlášení zbývá 1 hodina.");
    expect(find("15min-before")?.content.title).toBe("Zbývá 15 minut!");
    expect(find("deadline")?.content.title).toBe("Prošel čas, ohlásíš se?");
    expect(find("30min-after")?.content.title).toBe("Stále čekáme...");
    expect(find("30min-after")?.content.body).toBe("Ohlásíš se? Tvoji strážci budou brzy upozorněni.");
  });

  it("uses TIME_INTERVAL trigger with correct seconds", async () => {
    const now = Date.now();
    const deadline = new Date(now + 2 * 60 * 60 * 1000).toISOString(); // 2h from now

    await scheduleReminders(deadline);

    const deadlineCall = mockSchedule.mock.calls.find(
      (call: unknown[]) => (call[0] as { identifier: string }).identifier === "checkin-reminder-deadline"
    );

    expect(deadlineCall).toBeDefined();
    const trigger = (deadlineCall![0] as { trigger: { type: number; seconds: number; repeats: boolean } }).trigger;
    expect(trigger.type).toBe(Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL);
    expect(trigger.repeats).toBe(false);
    // Should be approximately 2 hours in seconds (allow some margin for test execution)
    expect(trigger.seconds).toBeGreaterThan(7100);
    expect(trigger.seconds).toBeLessThan(7300);
  });
});

describe("cancelAllReminders", () => {
  it("cancels only notifications with reminder prefix", async () => {
    mockGetAll.mockResolvedValue([
      { identifier: "checkin-reminder-1h-before" },
      { identifier: "checkin-reminder-15min-before" },
      { identifier: "checkin-reminder-deadline" },
      { identifier: "checkin-reminder-30min-after" },
      { identifier: "some-other-notification" },
    ]);

    await cancelAllReminders();

    expect(mockCancel).toHaveBeenCalledTimes(4);
    expect(mockCancel).not.toHaveBeenCalledWith("some-other-notification");
  });

  it("does nothing when no reminders exist", async () => {
    mockGetAll.mockResolvedValue([
      { identifier: "some-other-notification" },
    ]);

    await cancelAllReminders();

    expect(mockCancel).not.toHaveBeenCalled();
  });
});
