import { createResponseOnceDispatcher, notificationDestination } from "@/lib/notificationRouting";

const incidentId = "11111111-1111-4111-8111-111111111111";

it("routes only a validated incident UUID or known reminder type", () => {
  expect(notificationDestination({ type: "alert", incident_id: incidentId })).toEqual({ kind: "incident", incidentId });
  expect(notificationDestination({ type: "alert_incident", alert_id: incidentId })).toEqual({ kind: "incident", incidentId });
  expect(notificationDestination({ type: "alert_resolved", alert_id: incidentId })).toEqual({ kind: "incident", incidentId });
  expect(notificationDestination({ type: "alert", incident_id: "../settings" })).toBeNull();
  expect(notificationDestination({ type: "unknown", incident_id: incidentId })).toBeNull();
  expect(notificationDestination({ type: "reminder" })).toEqual({ kind: "reminder" });
});

it("dispatches a mocked cold-start response exactly once", () => {
  const handler = jest.fn();
  const dispatch = createResponseOnceDispatcher(handler);
  const response = { notification: { request: { identifier: "cold-start-1", content: { data: { type: "alert", incident_id: incidentId } } } } };
  expect(dispatch(response)).toBe(true);
  expect(dispatch(response)).toBe(false);
  expect(handler).toHaveBeenCalledTimes(1);
});
