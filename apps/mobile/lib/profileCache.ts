import * as SecureStore from "expo-secure-store";
import type { CheckInProfile } from "@/types/database";

const cacheKey = (userId: string) => `hlasimse.confirmed-profiles.${userId}.index`;
const profileKey = (userId: string, profileId: string) => `hlasimse.confirmed-profiles.${userId}.${profileId}`;
const selectionKey = (userId: string) => `hlasimse.selected-profile.${userId}`;

export interface ConfirmedProfilesCache {
  profiles: CheckInProfile[];
  cachedAt: string;
}

export async function saveConfirmedProfiles(userId: string, profiles: CheckInProfile[]): Promise<void> {
  const previous = await readIndex(userId);
  const currentIds = profiles.map((profile) => profile.id);
  await Promise.all(profiles.map((profile) => SecureStore.setItemAsync(profileKey(userId, profile.id), JSON.stringify(profile))));
  await Promise.all((previous?.ids || []).filter((id) => !currentIds.includes(id)).map((id) => SecureStore.deleteItemAsync(profileKey(userId, id))));
  await SecureStore.setItemAsync(
    cacheKey(userId),
    JSON.stringify({ ids: currentIds, cachedAt: new Date().toISOString() }),
  );
}

async function readIndex(userId: string): Promise<{ ids: string[]; cachedAt: string } | null> {
  const raw = await SecureStore.getItemAsync(cacheKey(userId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { ids: string[]; cachedAt: string };
    return Array.isArray(value.ids) && value.ids.every((id) => typeof id === "string") && typeof value.cachedAt === "string" ? value : null;
  } catch { return null; }
}

export async function loadConfirmedProfiles(userId: string): Promise<ConfirmedProfilesCache | null> {
  const index = await readIndex(userId);
  if (!index) return null;
  try {
    const values = await Promise.all(index.ids.map((id) => SecureStore.getItemAsync(profileKey(userId, id))));
    const profiles = values.flatMap((raw) => raw ? [JSON.parse(raw) as CheckInProfile] : []);
    return { profiles, cachedAt: index.cachedAt };
  } catch {
    return null;
  }
}

export async function saveSelectedProfileId(userId: string, profileId: string): Promise<void> {
  await SecureStore.setItemAsync(selectionKey(userId), profileId);
}

export async function loadSelectedProfileId(userId: string): Promise<string | null> {
  return SecureStore.getItemAsync(selectionKey(userId));
}

export async function clearConfirmedProfiles(userId: string): Promise<void> {
  const index = await readIndex(userId);
  await Promise.all([
    SecureStore.deleteItemAsync(cacheKey(userId)),
    SecureStore.deleteItemAsync(selectionKey(userId)),
    ...(index?.ids || []).map((id) => SecureStore.deleteItemAsync(profileKey(userId, id))),
  ]);
}
