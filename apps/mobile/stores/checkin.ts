import { create } from "zustand";
import { ApiError, apiRequest, isNetworkError } from "@/lib/api";
import { createIdempotencyKey, getInstallationId } from "@/lib/installation";
import { addToQueue, getQueue, getQueueCount, PendingCheckIn, removeFromQueue, updateQueueItem } from "@/lib/offlineQueue";
import { scheduleReminders } from "@/lib/reminderNotifications";
import { useAuthStore } from "@/stores/auth";
import { CheckInProfile, CheckInReceipt, normalizeProfile } from "@/types/database";

type ServerProfile = Omit<CheckInProfile, "interval_hours" | "next_deadline" | "last_check_in_at" | "is_active">;

interface CheckInState {
  profile: CheckInProfile | null;
  profiles: CheckInProfile[];
  isLoading: boolean;
  hasFetched: boolean;
  error: string | null;
  pendingCount: number;
  failedPendingCount: number;
  pendingItems: PendingCheckIn[];
  lastCheckInWasOffline: boolean;
  fetchProfile: (userId?: string) => Promise<void>;
  createProfile: (userId: string, name: string) => Promise<CheckInProfile | null>;
  updateProfile: (values: Partial<Pick<CheckInProfile, "name" | "interval_seconds" | "enabled" | "is_paused" | "paused_until">>) => Promise<CheckInProfile>;
  checkIn: (coords?: { lat: number; lng: number; accuracy?: number | null } | null) => Promise<{ success: boolean; offline: boolean }>;
  syncPendingCheckIns: () => Promise<{ synced: number; failed: number }>;
  refreshPendingCount: () => Promise<void>;
  retryPendingCheckIn: (id: string) => Promise<void>;
  deletePendingCheckIn: (id: string) => Promise<void>;
  clearProfile: () => void;
}

async function schedule(profile: CheckInProfile): Promise<void> {
  if (profile.next_deadline_at) {
    try {
      await scheduleReminders(profile.next_deadline_at);
    } catch (error) {
      console.warn("Failed to schedule local reminders", error);
    }
  }
}

async function identity(): Promise<{ userId: string; installationId: string } | null> {
  const userId = useAuthStore.getState().user?.id;
  if (!userId) return null;
  return { userId, installationId: await getInstallationId() };
}

export const useCheckInStore = create<CheckInState>((set, get) => ({
  profile: null,
  profiles: [],
  isLoading: false,
  hasFetched: false,
  error: null,
  pendingCount: 0,
  failedPendingCount: 0,
  pendingItems: [],
  lastCheckInWasOffline: false,

  fetchProfile: async () => {
    set({ isLoading: true, error: null });
    try {
      const serverProfiles = await apiRequest<ServerProfile[]>("/api/v1/profiles/");
      const profiles = serverProfiles.map(normalizeProfile);
      const selected = profiles[0] || null;
      set({ profiles, profile: selected, isLoading: false, hasFetched: true });
      if (selected) await schedule(selected);
      await get().refreshPendingCount();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Profil se nepodařilo načíst.", isLoading: false, hasFetched: true });
    }
  },

  createProfile: async (_userId, name) => {
    set({ isLoading: true, error: null });
    try {
      const created = normalizeProfile(await apiRequest<ServerProfile>("/api/v1/profiles/", {
        method: "POST",
        body: { name, interval_seconds: 86400, enabled: true },
      }));
      set((state) => ({ profile: created, profiles: [...state.profiles, created], isLoading: false, hasFetched: true }));
      return created;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Profil se nepodařilo vytvořit.", isLoading: false });
      return null;
    }
  },

  updateProfile: async (values) => {
    const profile = get().profile;
    if (!profile) throw new Error("Profil nebyl načten.");
    const updated = normalizeProfile(await apiRequest<ServerProfile>(`/api/v1/profiles/${profile.id}/`, {
      method: "PATCH",
      body: values,
    }));
    set((state) => ({ profile: updated, profiles: state.profiles.map((item) => item.id === updated.id ? updated : item) }));
    await schedule(updated);
    return updated;
  },

  checkIn: async (coords = null) => {
    const profile = get().profile;
    const account = await identity();
    if (!profile || !account) {
      set({ error: "Profil nebo účet nebyl načten." });
      return { success: false, offline: false };
    }
    const clientRecordedAt = new Date().toISOString();
    const installationId = account.installationId;
    const queuedInput = {
      ...account,
      installationId,
      profileId: profile.id,
      clientRecordedAt,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
      locationAccuracyMeters: coords?.accuracy ?? null,
      status: "pending" as const,
      error: null,
    };
    const idempotencyKey = createIdempotencyKey();
    set({ isLoading: true, error: null });
    try {
      await apiRequest<CheckInReceipt>(`/api/v1/profiles/${profile.id}/check-in/`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: {
          client_recorded_at: clientRecordedAt,
          ...(coords ? { latitude: coords.lat, longitude: coords.lng, ...(coords.accuracy != null ? { location_accuracy_meters: coords.accuracy } : {}) } : {}),
        },
      });
      await get().fetchProfile();
      set({ isLoading: false, lastCheckInWasOffline: false });
      return { success: true, offline: false };
    } catch (error) {
      if (isNetworkError(error)) {
        try {
          await addToQueue({ ...queuedInput, id: idempotencyKey });
          set({ isLoading: false, lastCheckInWasOffline: true, error: null });
          await get().refreshPendingCount();
          return { success: true, offline: true };
        } catch (queueError) {
          set({ isLoading: false, lastCheckInWasOffline: false, error: queueError instanceof Error ? queueError.message : "Hlášení se nepodařilo bezpečně uložit." });
          return { success: false, offline: false };
        }
      }
      set({ isLoading: false, error: error instanceof Error ? error.message : "Hlášení se nezdařilo." });
      return { success: false, offline: false };
    }
  },

  syncPendingCheckIns: async () => {
    const account = await identity();
    if (!account) return { synced: 0, failed: 0 };
    const queue = await getQueue(account.userId, account.installationId);
    let synced = 0;
    let failed = 0;
    for (const item of queue.filter((queued) => queued.status === "pending")) {
      try {
        await apiRequest<CheckInReceipt>(`/api/v1/profiles/${item.profileId}/check-in/`, {
          method: "POST",
          headers: { "Idempotency-Key": item.id },
          body: {
            client_recorded_at: item.clientRecordedAt,
            ...(item.latitude != null && item.longitude != null ? {
              latitude: item.latitude,
              longitude: item.longitude,
              ...(item.locationAccuracyMeters != null ? { location_accuracy_meters: item.locationAccuracyMeters } : {}),
            } : {}),
          },
        });
        await removeFromQueue(account.userId, account.installationId, item.id);
        synced += 1;
      } catch (error) {
        failed += 1;
        if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429) {
          await updateQueueItem(account.userId, account.installationId, item.id, {
            status: "failed",
            error: error.message || "Server hlášení odmítl.",
          });
        }
      }
    }
    if (synced) await get().fetchProfile();
    await get().refreshPendingCount();
    set({ lastCheckInWasOffline: (await getQueueCount(account.userId, account.installationId)) > 0 });
    return { synced, failed };
  },

  refreshPendingCount: async () => {
    const account = await identity();
    const items = account ? await getQueue(account.userId, account.installationId) : [];
    set({
      pendingItems: items,
      pendingCount: items.filter((item) => item.status === "pending").length,
      failedPendingCount: items.filter((item) => item.status === "failed").length,
    });
  },

  retryPendingCheckIn: async (id) => {
    const account = await identity();
    if (!account) return;
    await updateQueueItem(account.userId, account.installationId, id, { status: "pending", error: null });
    await get().refreshPendingCount();
    await get().syncPendingCheckIns();
  },

  deletePendingCheckIn: async (id) => {
    const account = await identity();
    if (!account) return;
    await removeFromQueue(account.userId, account.installationId, id);
    await get().refreshPendingCount();
  },

  clearProfile: () => set({ profile: null, profiles: [], isLoading: false, hasFetched: false, error: null, pendingCount: 0, failedPendingCount: 0, pendingItems: [], lastCheckInWasOffline: false }),
}));
