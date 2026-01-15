// stores/checkin.ts
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { CheckInProfile } from "@/types/database";
import {
  addToQueue,
  getQueue,
  removeFromQueue,
  getQueueCount,
} from "@/lib/offlineQueue";

interface CheckInState {
  profile: CheckInProfile | null;
  isLoading: boolean;
  hasFetched: boolean;
  error: string | null;
  pendingCount: number;
  lastCheckInWasOffline: boolean;
  fetchProfile: (userId: string) => Promise<void>;
  createProfile: (
    userId: string,
    name: string
  ) => Promise<CheckInProfile | null>;
  checkIn: (coords?: { lat: number; lng: number } | null) => Promise<{
    success: boolean;
    offline: boolean;
  }>;
  syncPendingCheckIns: () => Promise<{ synced: number; failed: number }>;
  refreshPendingCount: () => Promise<void>;
  clearProfile: () => void;
}

export const useCheckInStore = create<CheckInState>((set, get) => ({
  profile: null,
  isLoading: false,
  hasFetched: false,
  error: null,
  pendingCount: 0,
  lastCheckInWasOffline: false,

  fetchProfile: async (userId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase
        .from("check_in_profiles")
        .select("*")
        .eq("owner_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          set({ profile: null, isLoading: false, hasFetched: true });
          return;
        }
        throw error;
      }

      set({ profile: data, isLoading: false, hasFetched: true });

      // Also refresh pending count
      get().refreshPendingCount();
    } catch (error) {
      console.error("Error fetching check-in profile:", error);
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch profile",
        isLoading: false,
        hasFetched: true,
      });
    }
  },

  createProfile: async (userId: string, name: string) => {
    try {
      set({ isLoading: true, error: null });

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
        if (error.code === "23505") {
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
        error:
          error instanceof Error ? error.message : "Failed to create profile",
        isLoading: false,
      });
      return null;
    }
  },

  checkIn: async (coords = null) => {
    const { profile } = get();

    if (!profile) {
      set({ error: "No profile found" });
      return { success: false, offline: false };
    }

    const now = new Date();
    const nextDeadline = new Date(
      now.getTime() + profile.interval_hours * 60 * 60 * 1000
    );

    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("atomic_check_in", {
        p_profile_id: profile.id,
        p_checked_in_at: now.toISOString(),
        p_next_deadline: nextDeadline.toISOString(),
        p_was_offline: false,
        p_lat: coords?.lat ?? null,
        p_lng: coords?.lng ?? null,
      });

      if (error) {
        throw error;
      }

      const updatedProfile = Array.isArray(data) ? data[0] : data;

      if (!updatedProfile) {
        throw new Error("No profile returned from check-in");
      }

      set({
        profile: updatedProfile,
        isLoading: false,
        lastCheckInWasOffline: false,
      });
      return { success: true, offline: false };
    } catch (error) {
      console.error("Check-in failed:", error);

      // Determine if this is a network error (should queue) vs server error (should not queue)
      const isNetworkError =
        error instanceof TypeError ||
        (error instanceof Error &&
          (error.message.includes("fetch") ||
            error.message.includes("network") ||
            error.message.includes("Network"))) ||
        (typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof (error as { message: unknown }).message === "string" &&
          ((error as { message: string }).message.includes("fetch") ||
            (error as { message: string }).message.includes("network") ||
            (error as { message: string }).message.includes("Network")));

      // Check if it's a Supabase/server error (has error code)
      const isServerError =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as { code: unknown }).code === "string";

      if (isNetworkError && !isServerError) {
        // Network error - queue for offline sync
        await addToQueue({
          profileId: profile.id,
          checkedInAt: now.toISOString(),
          nextDeadline: nextDeadline.toISOString(),
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        });

        // Optimistically update local state
        set({
          profile: {
            ...profile,
            last_check_in_at: now.toISOString(),
            next_deadline: nextDeadline.toISOString(),
            last_known_lat: coords?.lat ?? profile.last_known_lat,
            last_known_lng: coords?.lng ?? profile.last_known_lng,
          },
          isLoading: false,
          lastCheckInWasOffline: true,
          error: null,
        });

        get().refreshPendingCount();

        return { success: true, offline: true };
      }

      // Server or validation error - do not queue, report failure
      set({
        isLoading: false,
        error:
          error instanceof Error
            ? error.message
            : "Check-in failed. Please try again.",
      });

      return { success: false, offline: false };
    }
  },

  syncPendingCheckIns: async () => {
    const queue = await getQueue();
    let synced = 0;
    let failed = 0;

    for (const pending of queue) {
      try {
        const { error } = await supabase.rpc("atomic_check_in", {
          p_profile_id: pending.profileId,
          p_checked_in_at: pending.checkedInAt,
          p_next_deadline: pending.nextDeadline,
          p_was_offline: true,
          p_lat: pending.lat,
          p_lng: pending.lng,
        });

        if (error) throw error;

        await removeFromQueue(pending.id);
        synced++;
      } catch (error) {
        console.error("Failed to sync pending check-in:", error);

        // Check if this is a server error (has error code) - these won't succeed on retry
        const isServerError =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          typeof (error as { code: unknown }).code === "string";

        if (isServerError) {
          // Remove from queue - retrying won't help
          console.warn("Removing non-retriable check-in from queue:", pending.id);
          await removeFromQueue(pending.id);
        }

        failed++;
      }
    }

    get().refreshPendingCount();

    return { synced, failed };
  },

  refreshPendingCount: async () => {
    const count = await getQueueCount();
    set({ pendingCount: count });
  },

  clearProfile: () => {
    set({
      profile: null,
      isLoading: false,
      hasFetched: false,
      error: null,
      pendingCount: 0,
      lastCheckInWasOffline: false,
    });
  },
}));
