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

      // Insert check-in record
      const { error: checkInError } = await supabase.from("check_ins").insert({
        check_in_profile_id: profile.id,
        checked_in_at: now.toISOString(),
        was_offline: false,
      });

      if (checkInError) {
        throw checkInError;
      }

      // Update profile with new deadline
      const { data: updatedProfile, error: updateError } = await supabase
        .from("check_in_profiles")
        .update({
          last_check_in_at: now.toISOString(),
          next_deadline: nextDeadline.toISOString(),
        })
        .eq("id", profile.id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
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
