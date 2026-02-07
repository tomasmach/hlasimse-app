import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const REMINDER_PREFIX = "checkin-reminder-";

interface ReminderConfig {
  id: string;
  offsetMs: number;
  title: string;
  body: string;
}

const REMINDERS: ReminderConfig[] = [
  {
    id: "1h-before",
    offsetMs: -60 * 60 * 1000,
    title: "Nezapomeň se ohlásit",
    body: "Do dalšího hlášení zbývá 1 hodina.",
  },
  {
    id: "15min-before",
    offsetMs: -15 * 60 * 1000,
    title: "Zbývá 15 minut!",
    body: "Nezapomeň se ohlásit.",
  },
  {
    id: "deadline",
    offsetMs: 0,
    title: "Prošel čas, ohlásíš se?",
    body: "Tvůj čas na hlášení právě vypršel.",
  },
  {
    id: "30min-after",
    offsetMs: 30 * 60 * 1000,
    title: "Stále čekáme...",
    body: "Ohlásíš se? Tvoji strážci budou brzy upozorněni.",
  },
];

export async function scheduleReminders(deadline: string): Promise<void> {
  // Cancel any existing reminders first
  await cancelAllReminders();

  const deadlineMs = new Date(deadline).getTime();
  const now = Date.now();

  for (const reminder of REMINDERS) {
    const triggerMs = deadlineMs + reminder.offsetMs;

    // Skip notifications that would be in the past
    if (triggerMs <= now) {
      continue;
    }

    const secondsFromNow = Math.ceil((triggerMs - now) / 1000);

    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_PREFIX + reminder.id,
      content: {
        title: reminder.title,
        body: reminder.body,
        sound: true,
        ...(Platform.OS === "android" && { channelId: "reminders" }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsFromNow,
        repeats: false,
      },
    });
  }
}

export async function cancelAllReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();

  for (const notification of scheduled) {
    if (notification.identifier.startsWith(REMINDER_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(
        notification.identifier
      );
    }
  }
}
