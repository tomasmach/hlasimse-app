import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { CheckInProfile } from "@/types/database";

interface CheckInState {
  profile: CheckInProfile | null;
  isLoading: boolean;
  error: string | null;
  fetchProfile: (userId: string) => Promise<void>;
  createProfile: (userId: string, name: string) => Promise<CheckInProfile | null>;
  checkIn: () => Promise<boolean>;
  clearProfile: () => void;
}

export const useCheckInStore = create<CheckInState>((set, get) => ({
  profile: null,
  isLoading: false,
  error: null,

  fetchProfile: async (userId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase
        .from("check_in_profiles")
        .select("*")
        .eq("owner_id", userId)
        .single();

      if (error) {
        // PGRST116 means no rows found - user has no profile yet
        if (error.code === "PGRST116") {
          set({ profile: null, isLoading: false });
          return;
        }
        throw error;
      }

      set({ profile: data, isLoading: false });
    } catch (error) {
      console.error("Error fetching check-in profile:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to fetch profile",
        isLoading: false,
      });
    }
  },

  createProfile: async (userId: string, name: string) => {
    try {
      set({ isLoading: true, error: null });

      // Check if profile already exists (defense in depth)
      const { data: existingProfile } = await supabase
        .from("check_in_profiles")
        .select("*")
        .eq("owner_id", userId)
        .maybeSingle();

      if (existingProfile) {
        set({ profile: existingProfile, isLoading: false });
        return existingProfile;
      }

      const now = new Date();
      const nextDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from("check_in_profiles")
        .insert({
          owner_id: userId,
          name: name,
          interval_hours: 24,
          next_deadline: nextDeadline.toISOString(),
          is_active: true,
          is_paused: false,
        })
        .select()
        .single();

      if (error) {
        // Handle unique violation (23505) - profile was created between check and insert
        if (error.code === "23505") {
          // Fetch the existing profile
          const { data: existing } = await supabase
            .from("check_in_profiles")
            .select("*")
            .eq("owner_id", userId)
            .single();

          if (existing) {
            set({ profile: existing, isLoading: false });
            return existing;
          }
        }
        throw error;
      }

      set({ profile: data, isLoading: false });
      return data;
    } catch (error) {
      console.error("Error creating check-in profile:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to create profile",
        isLoading: false,
      });
      return null;
    }
  },

  checkIn: async () => {
    const { profile } = get();

    if (!profile) {
      set({ error: "No profile found" });
      return false;
    }

    try {
      set({ isLoading: true, error: null });

      const now = new Date();
      const nextDeadline = new Date(
        now.getTime() + profile.interval_hours * 60 * 60 * 1000
      );

      // Use atomic RPC to perform both check-in insert and profile update in a transaction
      const { data, error } = await supabase.rpc("atomic_check_in", {
        p_profile_id: profile.id,
        p_checked_in_at: now.toISOString(),
        p_next_deadline: nextDeadline.toISOString(),
        p_was_offline: false,
      });

      if (error) {
        throw error;
      }

      // RPC returns array with single updated profile
      const updatedProfile = Array.isArray(data) ? data[0] : data;

      if (!updatedProfile) {
        throw new Error("No profile returned from check-in");
      }

      set({ profile: updatedProfile, isLoading: false });
      return true;
    } catch (error) {
      console.error("Error checking in:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to check in",
        isLoading: false,
      });
      return false;
    }
  },

  clearProfile: () => {
    set({ profile: null, isLoading: false, error: null });
  },
}));
