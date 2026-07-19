jest.mock("@/lib/api", () => ({ apiRequest: jest.fn() }));

import { apiRequest } from "@/lib/api";
import { useGuardiansStore } from "@/stores/guardians";

const request = apiRequest as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  useGuardiansStore.setState({ myGuardians: [], pendingInvites: [], watchedProfiles: [], isLoading: false, error: null, invitesChannel: null });
});

it("loads invitation IDs without requiring acceptance tokens", async () => {
  request.mockResolvedValue([{ id: "invite-1", profile_id: "profile-1", profile_name: "Denní", owner_display_name: "Jana", status: "pending", expires_at: "2026-08-01", created_at: "2026-07-19" }]);
  await useGuardiansStore.getState().fetchPendingInvites();
  expect(useGuardiansStore.getState().pendingInvites[0].id).toBe("invite-1");
  expect(request).toHaveBeenCalledWith("/api/v1/guardian-invitations/");
});

it("accepts and declines invitations through authenticated decision endpoints", async () => {
  const invitation = { id: "invite-1", profile_id: "profile-1", profile_name: "Denní", owner_display_name: "Jana", status: "pending" as const, expires_at: "", created_at: "", inviter: { id: "", email: "", name: "Jana" }, check_in_profile: { id: "profile-1", name: "Denní" } };
  useGuardiansStore.setState({ pendingInvites: [invitation] });
  request.mockResolvedValueOnce({}).mockResolvedValueOnce([]);
  expect(await useGuardiansStore.getState().acceptInvite("invite-1")).toBe(true);
  expect(request).toHaveBeenNthCalledWith(1, "/api/v1/guardian-invitations/invite-1/respond/", { method: "POST", body: { decision: "accept" } });

  useGuardiansStore.setState({ pendingInvites: [invitation] });
  request.mockResolvedValueOnce({});
  expect(await useGuardiansStore.getState().declineInvite("invite-1")).toBe(true);
  expect(request).toHaveBeenLastCalledWith("/api/v1/guardian-invitations/invite-1/respond/", { method: "POST", body: { decision: "decline" } });
});

it("revokes the current guardian membership exposed by watched profiles", async () => {
  request.mockResolvedValueOnce(undefined);
  useGuardiansStore.setState({ watchedProfiles: [{
    id: "profile-1", membership_id: "membership-1", name: "Denní", owner_display_name: "Jana", enabled: true,
    is_paused: false, paused_until: null, last_checked_in_at: null, next_deadline_at: null,
    deadline_generation: 1, open_alert_count: 0, next_deadline: null, last_check_in_at: null,
    has_active_alert: false, last_known_lat: null, last_known_lng: null,
  }] });
  expect(await useGuardiansStore.getState().stopWatching("membership-1")).toBe(true);
  expect(request).toHaveBeenCalledWith("/api/v1/guardian-memberships/membership-1/revoke/", { method: "POST" });
  expect(useGuardiansStore.getState().watchedProfiles).toHaveLength(0);
});
