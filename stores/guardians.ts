import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import {
  CheckInProfile,
  GuardianWithUser,
  InviteWithInviter,
  WatchedProfile,
} from "@/types/database";

interface GuardiansState {
  myGuardians: GuardianWithUser[];
  pendingInvites: InviteWithInviter[];
  watchedProfiles: WatchedProfile[];
  isLoading: boolean;
  error: string | null;

  fetchMyGuardians: (profileId: string) => Promise<void>;
  fetchPendingInvites: (userId: string) => Promise<void>;
  fetchWatchedProfiles: (userId: string) => Promise<void>;
  sendInvite: (profileId: string, email: string) => Promise<{ success: boolean; error?: string }>;
  acceptInvite: (inviteId: string) => Promise<boolean>;
  declineInvite: (inviteId: string) => Promise<boolean>;
  removeGuardian: (guardianId: string) => Promise<boolean>;
  clearError: () => void;
}

export const useGuardiansStore = create<GuardiansState>((set, get) => ({
  myGuardians: [],
  pendingInvites: [],
  watchedProfiles: [],
  isLoading: false,
  error: null,

  fetchMyGuardians: async (profileId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase
        .from("guardians")
        .select(`
          *,
          user:users!guardians_user_id_fkey (id, email, name, avatar_url)
        `)
        .eq("check_in_profile_id", profileId);

      if (error) throw error;

      set({ myGuardians: data || [], isLoading: false });
    } catch (error) {
      console.error("Error fetching guardians:", error);
      set({
        error: error instanceof Error ? error.message : "Nepodařilo se načíst strážce",
        isLoading: false,
      });
    }
  },

  fetchPendingInvites: async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("guardian_invites")
        .select(`
          *,
          inviter:users!guardian_invites_inviter_id_fkey (id, email, name, avatar_url),
          check_in_profile:check_in_profiles!guardian_invites_check_in_profile_id_fkey (id, name)
        `)
        .eq("invitee_id", userId)
        .eq("status", "pending");

      if (error) throw error;

      set({ pendingInvites: data || [] });
    } catch (error) {
      console.error("Error fetching pending invites:", error);
    }
  },

  fetchWatchedProfiles: async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from("guardians")
        .select(`
          check_in_profile:check_in_profiles!guardians_check_in_profile_id_fkey (*)
        `)
        .eq("user_id", userId);

      if (error) throw error;

      // Extrahovat profily a přidat alert status
      const profiles = await Promise.all(
        (data || []).map(async (g) => {
          const profile = g.check_in_profile as unknown as CheckInProfile;

          // Zkontrolovat aktivní alert
          const { data: alertData } = await supabase
            .from("alerts")
            .select("id")
            .eq("check_in_profile_id", profile.id)
            .is("resolved_at", null)
            .limit(1);

          return {
            ...profile,
            has_active_alert: (alertData?.length || 0) > 0,
          };
        })
      );

      set({ watchedProfiles: profiles });
    } catch (error) {
      console.error("Error fetching watched profiles:", error);
    }
  },

  sendInvite: async (profileId: string, email: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("send_guardian_invite", {
        p_profile_id: profileId,
        p_invitee_email: email,
      });

      if (error) throw error;

      if (!data.success) {
        const errorMessages: Record<string, string> = {
          user_not_found: "Uživatel s tímto emailem nemá účet. Požádej ho, ať si stáhne appku.",
          already_guardian: "Tento uživatel už je tvůj strážce.",
          invite_pending: "Pozvánka už byla odeslána, čeká na přijetí.",
          limit_reached_free: "Máš maximum strážců. Přejdi na Premium pro více.",
          limit_reached_premium: "Dosáhl jsi limitu 5 strážců.",
          cannot_invite_self: "Nemůžeš být strážcem sám sobě.",
          not_owner: "Tento profil ti nepatří.",
          profile_not_found: "Profil nebyl nalezen.",
        };

        const message = errorMessages[data.error] || "Nepodařilo se odeslat pozvánku.";
        set({ error: message, isLoading: false });
        return { success: false, error: message };
      }

      set({ isLoading: false });
      return { success: true };
    } catch (error) {
      console.error("Error sending invite:", error);
      const message = error instanceof Error ? error.message : "Nepodařilo se odeslat pozvánku";
      set({ error: message, isLoading: false });
      return { success: false, error: message };
    }
  },

  acceptInvite: async (inviteId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("respond_to_invite", {
        p_invite_id: inviteId,
        p_accept: true,
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error);
      }

      // Odebrat z pending invites
      set((state) => ({
        pendingInvites: state.pendingInvites.filter((i) => i.id !== inviteId),
        isLoading: false,
      }));

      return true;
    } catch (error) {
      console.error("Error accepting invite:", error);
      set({
        error: error instanceof Error ? error.message : "Nepodařilo se přijmout pozvánku",
        isLoading: false,
      });
      return false;
    }
  },

  declineInvite: async (inviteId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("respond_to_invite", {
        p_invite_id: inviteId,
        p_accept: false,
      });

      if (error) throw error;

      if (!data.success) {
        throw new Error(data.error);
      }

      set((state) => ({
        pendingInvites: state.pendingInvites.filter((i) => i.id !== inviteId),
        isLoading: false,
      }));

      return true;
    } catch (error) {
      console.error("Error declining invite:", error);
      set({
        error: error instanceof Error ? error.message : "Nepodařilo se odmítnout pozvánku",
        isLoading: false,
      });
      return false;
    }
  },

  removeGuardian: async (guardianId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { error } = await supabase
        .from("guardians")
        .delete()
        .eq("id", guardianId);

      if (error) throw error;

      set((state) => ({
        myGuardians: state.myGuardians.filter((g) => g.id !== guardianId),
        isLoading: false,
      }));

      return true;
    } catch (error) {
      console.error("Error removing guardian:", error);
      set({
        error: error instanceof Error ? error.message : "Nepodařilo se odebrat strážce",
        isLoading: false,
      });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
