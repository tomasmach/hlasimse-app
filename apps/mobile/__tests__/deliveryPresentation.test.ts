import {
  deliveryAttemptLabel,
  deliveryStatePresentation,
} from "@/lib/deliveryPresentation";
import type { DeliveryAttemptStatus } from "@/types/product";

const attemptStatuses: DeliveryAttemptStatus[] = [
  "queued",
  "ticket_received",
  "receipt_processing",
  "provider_accepted",
  "retryable_failure",
  "permanent_failure",
  "dead_letter",
];

it("presents every technical delivery status in Czech without raw enum labels", () => {
  expect(Object.keys(deliveryAttemptLabel).sort()).toEqual([...attemptStatuses].sort());
  for (const status of attemptStatuses) {
    expect(deliveryAttemptLabel[status]).not.toBe(status);
    expect(deliveryAttemptLabel[status]).not.toContain("_");
  }
});

it("never describes provider acceptance as device delivery", () => {
  expect(deliveryStatePresentation.sent_to_provider.detail).toContain("není potvrzeno");
  expect(deliveryStatePresentation.accepted_by_push_service.detail).toContain("není potvrzeno");
  expect(deliveryStatePresentation.sent_to_provider.label).not.toMatch(/doručen/i);
  expect(deliveryStatePresentation.accepted_by_push_service.label).not.toMatch(/doručen/i);
});
