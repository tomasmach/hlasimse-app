import { visibleAccessibleIncidents } from "@/lib/incidentVisibility";
import type { AlertIncident } from "@/types/product";

const incident = (id: string, profileId: string): AlertIncident => ({ id, profile_id: profileId, profile_name: profileId, deadline_generation: 1, deadline_at: "2026-07-19T10:00:00Z", opened_at: "2026-07-19T10:01:00Z", resolved_at: null, status: "open", acknowledgements: [], last_known_location: null, delivery_status: { state: "pending", attempt_counts: { queued: 1 } }, can_acknowledge: false });

it("keeps watched incidents visible independently of the selected owned profile", () => {
  const owned = incident("owned-alert", "owned-profile");
  const watched = incident("watched-alert", "watched-profile");
  expect(visibleAccessibleIncidents([owned, watched])).toEqual([owned, watched]);
});
