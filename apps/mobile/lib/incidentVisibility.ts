import type { AlertIncident } from "@/types/product";

/** The API already authorizes incidents; never filter this list by the selected owned profile. */
export function visibleAccessibleIncidents(alerts: AlertIncident[]): AlertIncident[] {
  return alerts;
}
