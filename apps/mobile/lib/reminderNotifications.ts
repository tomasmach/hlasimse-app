import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

const REMINDER_PREFIX = "checkin-reminder-";

interface ReminderConfig {
  id: string;
  offsetMs: number;
  title: string;
  body: string;
}

export interface ReminderProfile {
  id: string;
  name: string;
  enabled: boolean;
  is_paused: boolean;
  next_deadline_at: string | null;
}

const REMINDERS: ReminderConfig[] = [
  { id: "1h-before", offsetMs: -60 * 60 * 1000, title: "Nezapomeňte na check-in", body: "Do serverového termínu zbývá 1 hodina." },
  { id: "15min-before", offsetMs: -15 * 60 * 1000, title: "Do termínu zbývá 15 minut", body: "Check-in je potvrzený až po přijetí serverem." },
  { id: "deadline", offsetMs: 0, title: "Serverový termín právě vypršel", body: "Otevřete Hlásím se a zkontrolujte stav." },
  { id: "30min-after", offsetMs: 30 * 60 * 1000, title: "Termín už vypršel", body: "Server může vytvořit incident a pokusit se upozornit strážce. Doručení push nelze garantovat." },
];

const reminderPrefixForProfile = (profileId: string) => `${REMINDER_PREFIX}${profileId}-`;

export async function cancelProfileReminders(profileId: string): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const prefix = reminderPrefixForProfile(profileId);
  await Promise.all(
    scheduled.filter((item) => item.identifier.startsWith(prefix)).map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}

export async function scheduleProfileReminders(profile: ReminderProfile): Promise<void> {
  await cancelProfileReminders(profile.id);
  if (!profile.enabled || profile.is_paused || !profile.next_deadline_at) return;
  const deadlineMs = new Date(profile.next_deadline_at).getTime();
  if (!Number.isFinite(deadlineMs)) return;
  const now = Date.now();
  for (const reminder of REMINDERS) {
    const triggerMs = deadlineMs + reminder.offsetMs;
    if (triggerMs <= now) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: `${reminderPrefixForProfile(profile.id)}${reminder.id}`,
      content: {
        title: reminder.title,
        body: `${profile.name}: ${reminder.body}`,
        sound: true,
        data: { type: "reminder", profile_id: profile.id },
        ...(Platform.OS === "android" && { channelId: "reminders" }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.ceil((triggerMs - now) / 1000),
        repeats: false,
      },
    });
  }
}

export async function reconcileReminders(profiles: ReminderProfile[]): Promise<void> {
  await cancelAllReminders();
  for (const profile of profiles) {
    if (!profile.enabled || profile.is_paused || !profile.next_deadline_at) continue;
    await scheduleProfileReminders(profile);
  }
}

/** @deprecated Use profile-specific scheduling. */
export async function scheduleReminders(deadline: string): Promise<void> {
  await scheduleProfileReminders({ id: "legacy", name: "Profil", enabled: true, is_paused: false, next_deadline_at: deadline });
}

export async function cancelAllReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled.filter((item) => item.identifier.startsWith(REMINDER_PREFIX)).map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}
