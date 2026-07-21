export type NotificationDestination =
  | { kind: "incident"; incidentId: string }
  | { kind: "reminder" }
  | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function notificationDestination(data: Record<string, unknown>): NotificationDestination {
  const isIncidentEvent = data.type === "alert" || data.type === "alert_incident" || data.type === "alert_resolved";
  const rawId = typeof data.incident_id === "string" ? data.incident_id : data.alert_id;
  if (isIncidentEvent && typeof rawId === "string" && UUID.test(rawId)) {
    return { kind: "incident", incidentId: rawId };
  }
  if (data.type === "reminder") return { kind: "reminder" };
  return null;
}

export function createResponseOnceDispatcher(
  handler: (data: Record<string, unknown>) => void,
): (response: { notification: { request: { identifier: string; content: { data: Record<string, unknown> } } } }) => boolean {
  const handled = new Set<string>();
  return (response) => {
    const identifier = response.notification.request.identifier;
    if (!identifier || handled.has(identifier)) return false;
    handled.add(identifier);
    handler(response.notification.request.content.data);
    return true;
  };
}
