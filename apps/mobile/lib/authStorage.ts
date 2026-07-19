import * as SecureStore from "expo-secure-store";
import type { AuthTokens } from "@/types/api";
import type { AuthUser } from "@/types/api";

const ACCESS_KEY = "hlasimse.auth.access.v1";
const REFRESH_KEY = "hlasimse.auth.refresh.v1";
const USER_KEY = "hlasimse.auth.user.v1";
const USER_DATA_KEY = "hlasimse.auth.user-data.v1";

export async function getTokens(): Promise<AuthTokens | null> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  return access && refresh ? { access, refresh } : null;
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_KEY, tokens.access),
    SecureStore.setItemAsync(REFRESH_KEY, tokens.refresh),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}

export async function getStoredUserId(): Promise<string | null> {
  return SecureStore.getItemAsync(USER_KEY);
}

export async function setStoredUserId(userId: string): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, userId);
}

export async function getStoredUser(): Promise<AuthUser | null> {
  const raw = await SecureStore.getItemAsync(USER_DATA_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export async function setStoredUser(user: AuthUser): Promise<void> {
  await SecureStore.setItemAsync(USER_DATA_KEY, JSON.stringify(user));
}

export async function clearStoredUserId(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(USER_KEY),
    SecureStore.deleteItemAsync(USER_DATA_KEY),
  ]);
}
