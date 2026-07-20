import * as Notifications from "expo-notifications";
import type { AlertIncident } from "@/types/product";

export async function syncIncidentBadge(alerts: Pick<AlertIncident, "status">[]): Promise<number> {
  const openCount = alerts.filter((alert) => alert.status === "open").length;
  try {
    await Notifications.setBadgeCountAsync(openCount);
  } catch {
    // Badges are best-effort and some launchers do not support them.
  }
  return openCount;
}
