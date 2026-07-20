import { create } from "zustand";
import { apiRequest } from "@/lib/api";
import { useCheckInStore } from "@/stores/checkin";
import { useProductStore } from "@/stores/product";
import type { GuardianWithUser, InviteWithInviter, WatchedProfile } from "@/types/database";

interface ServerGuardian {
  id: string;
  email: string;
  display_name: string;
  status: "active" | "revoked";
  created_at: string;
}

interface ServerInvitation {
  id: string;
  profile_id: string;
  profile_name: string;
  owner_display_name: string;
  status: InviteWithInviter["status"];
  expires_at: string;
  created_at: string;
}

export interface SentGuardianInvitation {
  id: string;
  email: string;
  status: "pending" | "accepted" | "declined" | "expired" | "revoked";
  expires_at: string;
  created_at: string;
}

interface ServerWatchedProfile {
  id: string;
  membership_id?: string | null;
  name: string;
  owner_display_name: string;
  enabled: boolean;
  is_paused: boolean;
  paused_until: string | null;
  last_checked_in_at: string | null;
  next_deadline_at: string | null;
  deadline_generation: number;
  open_alert_count: number;
}

const guardianFromServer = (guardian: ServerGuardian): GuardianWithUser => ({
  ...guardian,
  user: { id: guardian.id, email: guardian.email, name: guardian.display_name || null },
});

const invitationFromServer = (invite: ServerInvitation): InviteWithInviter => ({
  ...invite,
  inviter: { id: invite.profile_id, email: "", name: invite.owner_display_name },
  check_in_profile: { id: invite.profile_id, name: invite.profile_name },
});

const watchedFromServer = (profile: ServerWatchedProfile): WatchedProfile => ({
  ...profile,
  membership_id: profile.membership_id || null,
  next_deadline: profile.next_deadline_at,
  last_check_in_at: profile.last_checked_in_at,
  has_active_alert: profile.open_alert_count > 0,
  last_known_lat: null,
  last_known_lng: null,
});

interface GuardiansState {
  myGuardians: GuardianWithUser[];
  pendingInvites: InviteWithInviter[];
  sentInvites: SentGuardianInvitation[];
  watchedProfiles: WatchedProfile[];
  isLoading: boolean;
  error: string | null;
  invitesChannel: ReturnType<typeof setInterval> | null;
  fetchMyGuardians: (profileId: string) => Promise<void>;
  fetchPendingInvites: (userId?: string) => Promise<void>;
  fetchSentInvites: (profileId: string) => Promise<void>;
  fetchWatchedProfiles: (userId?: string) => Promise<void>;
  sendInvite: (profileId: string, email: string) => Promise<{ success: boolean; error?: string }>;
  acceptInvite: (inviteId: string) => Promise<boolean>;
  declineInvite: (inviteId: string) => Promise<boolean>;
  removeGuardian: (guardianId: string) => Promise<boolean>;
  stopWatching: (membershipId: string) => Promise<boolean>;
  subscribeToInvites: (userId?: string) => void;
  unsubscribeFromInvites: () => void;
  clearError: () => void;
  reset: () => void;
}

export const useGuardiansStore = create<GuardiansState>((set, get) => ({
  myGuardians: [],
  pendingInvites: [],
  sentInvites: [],
  watchedProfiles: [],
  isLoading: false,
  error: null,
  invitesChannel: null,

  fetchMyGuardians: async (profileId) => {
    set({ isLoading: true, error: null });
    try {
      const data = await apiRequest<ServerGuardian[]>(`/api/v1/profiles/${profileId}/guardians/`);
      set({ myGuardians: data.filter((guardian) => guardian.status === "active").map(guardianFromServer), isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Nepodařilo se načíst strážce.", isLoading: false });
    }
  },

  fetchPendingInvites: async () => {
    try {
      const data = await apiRequest<ServerInvitation[]>("/api/v1/guardian-invitations/");
      set({ pendingInvites: data.map(invitationFromServer) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Nepodařilo se načíst pozvánky." });
    }
  },

  fetchSentInvites: async (profileId) => {
    try {
      const data = await apiRequest<SentGuardianInvitation[]>(`/api/v1/profiles/${profileId}/invitations/`);
      set({ sentInvites: data });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Nepodařilo se načíst odeslané pozvánky." });
    }
  },

  fetchWatchedProfiles: async () => {
    try {
      const data = await apiRequest<ServerWatchedProfile[]>("/api/v1/watched-profiles/");
      set({ watchedProfiles: data.map(watchedFromServer) });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Nepodařilo se načíst hlídané profily." });
    }
  },

  sendInvite: async (profileId, email) => {
    set({ isLoading: true, error: null });
    try {
      await apiRequest(`/api/v1/profiles/${profileId}/invitations/`, {
        method: "POST",
        body: { email: email.trim().toLowerCase() },
      });
      set({ isLoading: false });
      await get().fetchSentInvites(profileId);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nepodařilo se odeslat pozvánku.";
      set({ error: message, isLoading: false });
      return { success: false, error: message };
    }
  },

  acceptInvite: async (inviteId) => {
    set({ isLoading: true, error: null });
    try {
      await apiRequest(`/api/v1/guardian-invitations/${inviteId}/respond/`, { method: "POST", body: { decision: "accept" } });
      set((state) => ({ pendingInvites: state.pendingInvites.filter((invite) => invite.id !== inviteId), isLoading: false }));
      await get().fetchWatchedProfiles();
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Pozvánku se nepodařilo přijmout.", isLoading: false });
      return false;
    }
  },

  declineInvite: async (inviteId) => {
    set({ isLoading: true, error: null });
    try {
      await apiRequest(`/api/v1/guardian-invitations/${inviteId}/respond/`, { method: "POST", body: { decision: "decline" } });
      set((state) => ({ pendingInvites: state.pendingInvites.filter((invite) => invite.id !== inviteId), isLoading: false }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Pozvánku se nepodařilo odmítnout.", isLoading: false });
      return false;
    }
  },

  removeGuardian: async (guardianId) => {
    const profileId = useCheckInStore.getState().profile?.id;
    if (!profileId) return false;
    set({ isLoading: true, error: null });
    try {
      await apiRequest<void>(`/api/v1/profiles/${profileId}/guardians/${guardianId}/`, { method: "DELETE" });
      set((state) => ({ myGuardians: state.myGuardians.filter((guardian) => guardian.id !== guardianId), isLoading: false }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Strážce se nepodařilo odebrat.", isLoading: false });
      return false;
    }
  },

  stopWatching: async (membershipId) => {
    const watchedProfile = get().watchedProfiles.find((profile) => profile.membership_id === membershipId);
    set({ isLoading: true, error: null });
    try {
      await apiRequest<void>(`/api/v1/guardian-memberships/${membershipId}/revoke/`, { method: "POST" });
      set((state) => ({ watchedProfiles: state.watchedProfiles.filter((profile) => profile.membership_id !== membershipId), isLoading: false }));
      if (watchedProfile) useProductStore.getState().evictProfileAccess(watchedProfile.id);
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Hlídání se nepodařilo ukončit.", isLoading: false });
      return false;
    }
  },

  subscribeToInvites: () => {
    get().unsubscribeFromInvites();
    const timer = setInterval(() => {
      void get().fetchPendingInvites();
      void get().fetchWatchedProfiles();
    }, 30_000);
    set({ invitesChannel: timer });
  },
  unsubscribeFromInvites: () => {
    const timer = get().invitesChannel;
    if (timer) clearInterval(timer);
    set({ invitesChannel: null });
  },
  clearError: () => set({ error: null }),
  reset: () => {
    get().unsubscribeFromInvites();
    set({ myGuardians: [], pendingInvites: [], sentInvites: [], watchedProfiles: [], isLoading: false, error: null });
  },
}));
