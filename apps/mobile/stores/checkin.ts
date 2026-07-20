import { create } from "zustand";
import { ApiError, apiRequest, isNetworkError } from "@/lib/api";
import { createIdempotencyKey, getInstallationId } from "@/lib/installation";
import { addToQueue, getQueue, getQueueCount, PendingCheckIn, removeFromQueue, updateQueueItem } from "@/lib/offlineQueue";
import { reconcileReminders } from "@/lib/reminderNotifications";
import { loadConfirmedProfiles, loadGuardianOnlyPreference, loadSelectedProfileId, saveConfirmedProfiles, saveGuardianOnlyPreference, saveSelectedProfileId } from "@/lib/profileCache";
import { useAuthStore } from "@/stores/auth";
import { CheckInProfile, CheckInReceipt, normalizeProfile } from "@/types/database";

type ServerProfile = Omit<CheckInProfile, "interval_hours" | "next_deadline" | "last_check_in_at" | "is_active">;

export class ProfileArchiveBlockedError extends Error {
  readonly code = "profile_has_open_incident" as const;

  constructor(
    public readonly incidentId: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfileArchiveBlockedError";
  }
}

interface CheckInState {
  profile: CheckInProfile | null;
  profiles: CheckInProfile[];
  isLoading: boolean;
  hasFetched: boolean;
  lastFetchSucceeded: boolean;
  isUsingCachedProfiles: boolean;
  profilesCachedAt: string | null;
  guardianOnlyMode: boolean;
  error: string | null;
  pendingCount: number;
  failedPendingCount: number;
  pendingItems: PendingCheckIn[];
  lastCheckInWasOffline: boolean;
  fetchProfile: (userId?: string) => Promise<void>;
  selectProfile: (profileId: string) => Promise<void>;
  chooseGuardianOnlyMode: (userId: string, value: boolean) => Promise<void>;
  createProfile: (userId: string, name: string, intervalSeconds?: number) => Promise<CheckInProfile | null>;
  deleteProfile: (profileId: string) => Promise<void>;
  updateProfile: (values: Partial<Pick<CheckInProfile, "name" | "interval_seconds" | "enabled" | "is_paused" | "paused_until">>) => Promise<CheckInProfile>;
  checkIn: (coords?: { lat: number; lng: number; accuracy?: number | null } | null) => Promise<{ success: boolean; offline: boolean }>;
  syncPendingCheckIns: () => Promise<{ synced: number; failed: number }>;
  refreshPendingCount: () => Promise<void>;
  retryPendingCheckIn: (id: string) => Promise<void>;
  deletePendingCheckIn: (id: string) => Promise<void>;
  clearProfile: () => void;
}

async function schedule(profiles: CheckInProfile[]): Promise<void> {
  try {
    await reconcileReminders(profiles);
  } catch (error) {
    console.warn("Failed to reconcile local reminders", error);
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
  lastFetchSucceeded: false,
  isUsingCachedProfiles: false,
  profilesCachedAt: null,
  guardianOnlyMode: false,
  error: null,
  pendingCount: 0,
  failedPendingCount: 0,
  pendingItems: [],
  lastCheckInWasOffline: false,

  fetchProfile: async (requestedUserId) => {
    set({ isLoading: true, error: null });
    const userId = requestedUserId || useAuthStore.getState().user?.id;
    if (!userId) {
      set({ isLoading: false, hasFetched: true, lastFetchSucceeded: false, error: "Účet nebyl načten." });
      return;
    }
    try {
      const serverProfiles = await apiRequest<ServerProfile[]>("/api/v1/profiles/");
      const profiles = serverProfiles.map(normalizeProfile);
      let guardianOnlyMode = profiles.length === 0 && await loadGuardianOnlyPreference(userId);
      if (profiles.length === 0 && !guardianOnlyMode) {
        try {
          const [watched, invitations] = await Promise.all([
            apiRequest<unknown[]>("/api/v1/watched-profiles/"),
            apiRequest<unknown[]>("/api/v1/guardian-invitations/"),
          ]);
          guardianOnlyMode = watched.length > 0 || invitations.length > 0;
          if (guardianOnlyMode) await saveGuardianOnlyPreference(userId, true);
        } catch {
          // Profile loading remains usable; the setup screen offers an explicit guardian-only path.
        }
      }
      const selectedId = await loadSelectedProfileId(userId);
      const selected = profiles.find((item) => item.id === selectedId) || profiles[0] || null;
      await saveConfirmedProfiles(userId, profiles);
      if (selected) await saveSelectedProfileId(userId, selected.id);
      set({ profiles, profile: selected, isLoading: false, hasFetched: true, lastFetchSucceeded: true, isUsingCachedProfiles: false, profilesCachedAt: null, guardianOnlyMode });
      await schedule(profiles);
      await get().refreshPendingCount();
    } catch (error) {
      const cached = await loadConfirmedProfiles(userId);
      const selectedId = await loadSelectedProfileId(userId);
      const guardianOnlyMode = await loadGuardianOnlyPreference(userId);
      const selected = cached?.profiles.find((item) => item.id === selectedId) || cached?.profiles[0] || null;
      set({
        profiles: cached?.profiles || [],
        profile: selected,
        error: error instanceof Error ? error.message : "Profil se nepodařilo načíst.",
        isLoading: false,
        hasFetched: true,
        lastFetchSucceeded: false,
        isUsingCachedProfiles: Boolean(cached),
        profilesCachedAt: cached?.cachedAt || null,
        guardianOnlyMode,
      });
      await get().refreshPendingCount();
    }
  },

  selectProfile: async (profileId) => {
    const selected = get().profiles.find((item) => item.id === profileId);
    const userId = useAuthStore.getState().user?.id;
    if (!selected || !userId) return;
    set({ profile: selected });
    await saveSelectedProfileId(userId, selected.id);
  },

  chooseGuardianOnlyMode: async (userId, value) => {
    await saveGuardianOnlyPreference(userId, value);
    set({ guardianOnlyMode: value });
  },

  createProfile: async (userId, name, intervalSeconds = 86400) => {
    set({ isLoading: true, error: null });
    try {
      const created = normalizeProfile(await apiRequest<ServerProfile>("/api/v1/profiles/", {
        method: "POST",
        body: { name, interval_seconds: intervalSeconds, enabled: true },
      }));
      const profiles = [...get().profiles, created];
      await saveConfirmedProfiles(userId, profiles);
      await saveSelectedProfileId(userId, created.id);
      await saveGuardianOnlyPreference(userId, false);
      set({ profile: created, profiles, isLoading: false, hasFetched: true, lastFetchSucceeded: true, isUsingCachedProfiles: false, profilesCachedAt: null, guardianOnlyMode: false });
      await schedule(profiles);
      return created;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "Profil se nepodařilo vytvořit.", isLoading: false });
      return null;
    }
  },

  deleteProfile: async (profileId) => {
    try {
      await apiRequest<void>(`/api/v1/profiles/${profileId}/`, { method: "DELETE" });
    } catch (error) {
      const body = error instanceof ApiError ? error.body : null;
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        body?.code === "profile_has_open_incident" &&
        typeof body.incident_id === "string"
      ) {
        throw new ProfileArchiveBlockedError(
          body.incident_id,
          typeof body.detail === "string"
            ? body.detail
            : "Profil nelze archivovat během aktivního incidentu.",
        );
      }
      throw error;
    }
    const userId = useAuthStore.getState().user?.id;
    const profiles = get().profiles.filter((item) => item.id !== profileId);
    const selected = get().profile?.id === profileId ? profiles[0] || null : get().profile;
    if (userId) {
      await saveConfirmedProfiles(userId, profiles);
      if (selected) await saveSelectedProfileId(userId, selected.id);
    }
    set({ profiles, profile: selected });
    await schedule(profiles);
  },

  updateProfile: async (values) => {
    const profile = get().profile;
    if (!profile) throw new Error("Profil nebyl načten.");
    const updated = normalizeProfile(await apiRequest<ServerProfile>(`/api/v1/profiles/${profile.id}/`, {
      method: "PATCH",
      body: values,
    }));
    const profiles = get().profiles.map((item) => item.id === updated.id ? updated : item);
    const userId = useAuthStore.getState().user?.id;
    if (userId) await saveConfirmedProfiles(userId, profiles);
    set({ profile: updated, profiles, isUsingCachedProfiles: false, profilesCachedAt: null });
    await schedule(profiles);
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
      // Location is deliberately never persisted in the offline queue.
      latitude: null,
      longitude: null,
      locationAccuracyMeters: null,
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
            submitted_from_queue: true,
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

  clearProfile: () => set({ profile: null, profiles: [], isLoading: false, hasFetched: false, lastFetchSucceeded: false, isUsingCachedProfiles: false, profilesCachedAt: null, guardianOnlyMode: false, error: null, pendingCount: 0, failedPendingCount: 0, pendingItems: [], lastCheckInWasOffline: false }),
}));
