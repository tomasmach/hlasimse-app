import * as SecureStore from "expo-secure-store";
import type { AuthTokens } from "@/types/api";
import type { AuthUser } from "@/types/api";

const ACCESS_KEY = "hlasimse.auth.access.v1";
const REFRESH_KEY = "hlasimse.auth.refresh.v1";
const TOKEN_BUNDLE_KEY = "hlasimse.auth.tokens.v2";
const USER_KEY = "hlasimse.auth.user.v1";
const USER_DATA_KEY = "hlasimse.auth.user-data.v1";

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const tokenMutex = new AsyncMutex();
let tokenGeneration = 0;

export interface AuthTokenSnapshot {
  tokens: AuthTokens | null;
  generation: number;
}

async function readTokens(): Promise<AuthTokens | null> {
  const bundle = await SecureStore.getItemAsync(TOKEN_BUNDLE_KEY);
  if (bundle) {
    try {
      const parsed = JSON.parse(bundle) as Partial<AuthTokens> & { version?: unknown };
      return parsed.version === 2 && typeof parsed.access === "string" && typeof parsed.refresh === "string"
        ? { access: parsed.access, refresh: parsed.refresh }
        : null;
    } catch {
      return null;
    }
  }
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  if (!access || !refresh) return null;
  const tokens = { access, refresh };
  await writeTokens(tokens);
  return tokens;
}

async function writeTokens(tokens: AuthTokens): Promise<void> {
  await SecureStore.setItemAsync(
    TOKEN_BUNDLE_KEY,
    JSON.stringify({ version: 2, access: tokens.access, refresh: tokens.refresh }),
  );
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}

async function deleteTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_BUNDLE_KEY),
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}

export async function getTokens(): Promise<AuthTokens | null> {
  return tokenMutex.withLock(readTokens);
}

export async function getTokenSnapshot(): Promise<AuthTokenSnapshot> {
  return tokenMutex.withLock(async () => ({
    tokens: await readTokens(),
    generation: tokenGeneration,
  }));
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  await tokenMutex.withLock(async () => {
    await writeTokens(tokens);
    tokenGeneration += 1;
  });
}

export async function saveTokensIfCurrent(
  tokens: AuthTokens,
  snapshot: AuthTokenSnapshot,
): Promise<boolean> {
  return tokenMutex.withLock(async () => {
    const current = await readTokens();
    if (
      tokenGeneration !== snapshot.generation ||
      !current ||
      !snapshot.tokens ||
      current.refresh !== snapshot.tokens.refresh
    ) {
      return false;
    }
    await writeTokens(tokens);
    tokenGeneration += 1;
    return true;
  });
}

export async function clearTokens(): Promise<void> {
  await tokenMutex.withLock(async () => {
    tokenGeneration += 1;
    await deleteTokens();
  });
}

export async function clearTokensIfCurrent(snapshot: AuthTokenSnapshot): Promise<boolean> {
  return tokenMutex.withLock(async () => {
    const current = await readTokens();
    if (
      tokenGeneration !== snapshot.generation ||
      current?.refresh !== snapshot.tokens?.refresh
    ) {
      return false;
    }
    tokenGeneration += 1;
    await deleteTokens();
    return true;
  });
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
