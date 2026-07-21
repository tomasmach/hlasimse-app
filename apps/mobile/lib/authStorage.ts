import * as SecureStore from "expo-secure-store";
import type { AuthTokens } from "@/types/api";
import type { AuthUser } from "@/types/api";

const ACCESS_KEY = "hlasimse.auth.access.v1";
const REFRESH_KEY = "hlasimse.auth.refresh.v1";
const TOKEN_BUNDLE_KEY = "hlasimse.auth.tokens.v2";
const SESSION_ENVELOPE_KEY = "hlasimse.auth.session.v3";
const USER_KEY = "hlasimse.auth.user.v1";
const USER_DATA_KEY = "hlasimse.auth.user-data.v1";
const ACCOUNT_BUNDLE_KEY = "hlasimse.auth.account.v2";

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
const accountMutex = new AsyncMutex();
let tokenGeneration = 0;

export interface AuthTokenSnapshot {
  tokens: AuthTokens | null;
  generation: number;
  state: "pending" | "bound" | null;
  user: AuthUser | null;
}

interface StoredSessionEnvelope {
  version: 3;
  access: string;
  refresh: string;
  state: "pending" | "bound";
  user: AuthUser | null;
}

interface SessionEnvelopeRead {
  present: boolean;
  envelope: StoredSessionEnvelope | null;
}

function validUser(value: unknown): value is AuthUser {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AuthUser>;
  return typeof candidate.id === "string" && typeof candidate.email === "string";
}

async function readV3Envelope(): Promise<SessionEnvelopeRead> {
  const raw = await SecureStore.getItemAsync(SESSION_ENVELOPE_KEY);
  if (raw === null) return { present: false, envelope: null };
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSessionEnvelope>;
    if (
      parsed.version !== 3 ||
      typeof parsed.access !== "string" ||
      typeof parsed.refresh !== "string" ||
      (parsed.state !== "pending" && parsed.state !== "bound") ||
      (parsed.state === "bound" && !validUser(parsed.user))
    ) {
      return { present: true, envelope: null };
    }
    return {
      present: true,
      envelope: {
        version: 3,
        access: parsed.access,
        refresh: parsed.refresh,
        state: parsed.state,
        user: parsed.state === "bound" ? parsed.user as AuthUser : null,
      },
    };
  } catch {
    return { present: true, envelope: null };
  }
}

async function writeSessionEnvelope(envelope: StoredSessionEnvelope): Promise<void> {
  // The complete token/account relationship is one SecureStore value. Cleanup
  // happens only after the authoritative envelope exists, so an interruption
  // can leave redundant legacy data but never a mixed current session.
  await SecureStore.setItemAsync(SESSION_ENVELOPE_KEY, JSON.stringify(envelope));
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_BUNDLE_KEY),
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  } catch (error) {
    // The v3 value above is already authoritative. Legacy deletion is
    // idempotent cleanup and must not make callers treat a committed session
    // as failed or leave the in-memory generation behind durable state.
    console.warn("Failed to remove legacy auth values after committing session envelope", error);
  }
}

async function readSessionEnvelope(): Promise<StoredSessionEnvelope | null> {
  const current = await readV3Envelope();
  if (current.present) return current.envelope;

  // Legacy tokens did not cryptographically/atomically identify their cached
  // user. Migrate them as pending: online restore may bind them, while an
  // offline restore must not guess an identity from the old account cache.
  const bundle = await SecureStore.getItemAsync(TOKEN_BUNDLE_KEY);
  if (bundle) {
    try {
      const parsed = JSON.parse(bundle) as Partial<AuthTokens> & { version?: unknown };
      if (parsed.version === 2 && typeof parsed.access === "string" && typeof parsed.refresh === "string") {
        const migrated: StoredSessionEnvelope = {
          version: 3,
          access: parsed.access,
          refresh: parsed.refresh,
          state: "pending",
          user: null,
        };
        await writeSessionEnvelope(migrated);
        return migrated;
      }
      return null;
    } catch {
      return null;
    }
  }
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS_KEY),
    SecureStore.getItemAsync(REFRESH_KEY),
  ]);
  if (!access || !refresh) return null;
  const migrated: StoredSessionEnvelope = {
    version: 3,
    access,
    refresh,
    state: "pending",
    user: null,
  };
  await writeSessionEnvelope(migrated);
  return migrated;
}

function tokensFromEnvelope(envelope: StoredSessionEnvelope | null): AuthTokens | null {
  return envelope ? { access: envelope.access, refresh: envelope.refresh } : null;
}

async function deleteTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(SESSION_ENVELOPE_KEY),
    SecureStore.deleteItemAsync(TOKEN_BUNDLE_KEY),
    SecureStore.deleteItemAsync(ACCESS_KEY),
    SecureStore.deleteItemAsync(REFRESH_KEY),
  ]);
}

export async function getTokens(): Promise<AuthTokens | null> {
  return tokenMutex.withLock(async () => tokensFromEnvelope(await readSessionEnvelope()));
}

export async function getTokenSnapshot(): Promise<AuthTokenSnapshot> {
  return tokenMutex.withLock(async () => {
    const envelope = await readSessionEnvelope();
    return {
      tokens: tokensFromEnvelope(envelope),
      generation: tokenGeneration,
      state: envelope?.state ?? null,
      user: envelope?.user ?? null,
    };
  });
}

export async function saveTokens(tokens: AuthTokens): Promise<void> {
  await tokenMutex.withLock(async () => {
    await writeSessionEnvelope({
      version: 3,
      access: tokens.access,
      refresh: tokens.refresh,
      state: "pending",
      user: null,
    });
    tokenGeneration += 1;
  });
}

function snapshotMatchesEnvelope(
  snapshot: AuthTokenSnapshot,
  envelope: StoredSessionEnvelope | null,
): boolean {
  if (tokenGeneration !== snapshot.generation) return false;
  if (!envelope || !snapshot.tokens) {
    return envelope === null && snapshot.tokens === null && snapshot.state === null && snapshot.user === null;
  }
  return envelope.refresh === snapshot.tokens.refresh &&
    envelope.access === snapshot.tokens.access &&
    envelope.state === snapshot.state &&
    envelope.user?.id === snapshot.user?.id;
}

export async function isTokenSnapshotCurrent(snapshot: AuthTokenSnapshot): Promise<boolean> {
  return tokenMutex.withLock(async () => snapshotMatchesEnvelope(snapshot, await readSessionEnvelope()));
}

export async function saveTokensIfCurrent(
  tokens: AuthTokens,
  snapshot: AuthTokenSnapshot,
): Promise<boolean> {
  return tokenMutex.withLock(async () => {
    const current = await readSessionEnvelope();
    if (!snapshotMatchesEnvelope(snapshot, current)) return false;
    await writeSessionEnvelope({
      version: 3,
      access: tokens.access,
      refresh: tokens.refresh,
      state: current!.state,
      user: current!.user,
    });
    tokenGeneration += 1;
    return true;
  });
}

export async function bindSessionUserIfCurrent(
  user: AuthUser,
  snapshot: AuthTokenSnapshot,
): Promise<boolean> {
  return tokenMutex.withLock(async () => {
    const current = await readSessionEnvelope();
    if (!snapshotMatchesEnvelope(snapshot, current)) return false;
    await writeSessionEnvelope({
      version: 3,
      access: current!.access,
      refresh: current!.refresh,
      state: "bound",
      user,
    });
    tokenGeneration += 1;
    return true;
  });
}

export async function getSessionUser(): Promise<AuthUser | null> {
  return tokenMutex.withLock(async () => {
    const envelope = await readSessionEnvelope();
    return envelope?.state === "bound" ? envelope.user : null;
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
    const current = await readSessionEnvelope();
    if (!snapshotMatchesEnvelope(snapshot, current)) return false;
    tokenGeneration += 1;
    await deleteTokens();
    return true;
  });
}

interface StoredAccountBundle {
  version: 2;
  userId: string;
  user: AuthUser | null;
}

async function readAccountBundle(): Promise<StoredAccountBundle | null> {
  const raw = await SecureStore.getItemAsync(ACCOUNT_BUNDLE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAccountBundle>;
    if (parsed.version !== 2 || typeof parsed.userId !== "string") return null;
    return {
      version: 2,
      userId: parsed.userId,
      user: parsed.user && typeof parsed.user === "object" ? parsed.user as AuthUser : null,
    };
  } catch {
    return null;
  }
}

async function readLegacyUser(): Promise<AuthUser | null> {
  const raw = await SecureStore.getItemAsync(USER_DATA_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

async function writeAccountBundle(bundle: StoredAccountBundle): Promise<void> {
  await SecureStore.setItemAsync(ACCOUNT_BUNDLE_KEY, JSON.stringify(bundle));
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(USER_KEY),
      SecureStore.deleteItemAsync(USER_DATA_KEY),
    ]);
  } catch (error) {
    console.warn("Failed to remove legacy account values after committing account bundle", error);
  }
}

export async function commitBoundSessionAndAccountIfCurrent(
  user: AuthUser,
  snapshot: AuthTokenSnapshot,
): Promise<AuthTokenSnapshot | null> {
  return tokenMutex.withLock(async () => {
    const current = await readSessionEnvelope();
    if (!snapshotMatchesEnvelope(snapshot, current)) return null;

    try {
      await writeSessionEnvelope({
        version: 3,
        access: current!.access,
        refresh: current!.refresh,
        state: "bound",
        user,
      });
      await accountMutex.withLock(() => writeAccountBundle({
        version: 2,
        userId: user.id,
        user,
      }));
    } catch (error) {
      // A bound session without its account cache must never escape as a
      // successful login. The exact session is still exclusively owned under
      // tokenMutex, so removing it cannot affect a newer login.
      tokenGeneration += 1;
      await deleteTokens();
      console.warn("Failed to commit the bound login session", error);
      return null;
    }

    tokenGeneration += 1;
    return {
      tokens: { access: current!.access, refresh: current!.refresh },
      generation: tokenGeneration,
      state: "bound",
      user,
    };
  });
}

export async function getStoredUserId(): Promise<string | null> {
  return accountMutex.withLock(async () => {
    const bundle = await readAccountBundle();
    return bundle?.userId ?? SecureStore.getItemAsync(USER_KEY);
  });
}

export async function setStoredUserId(userId: string): Promise<void> {
  await accountMutex.withLock(async () => {
    const current = await readAccountBundle();
    await writeAccountBundle({
      version: 2,
      userId,
      user: current?.user?.id === userId ? current.user : null,
    });
  });
}

export async function getStoredUser(): Promise<AuthUser | null> {
  return accountMutex.withLock(async () => {
    const bundle = await readAccountBundle();
    return bundle?.user ?? readLegacyUser();
  });
}

export async function setStoredUser(user: AuthUser): Promise<void> {
  await accountMutex.withLock(() => writeAccountBundle({
    version: 2,
    userId: user.id,
    user,
  }));
}

export async function setStoredUserIfBound(
  user: AuthUser,
  expectedUserId: string,
): Promise<boolean> {
  return accountMutex.withLock(async () => {
    const bundle = await readAccountBundle();
    const boundUserId = bundle?.userId ?? await SecureStore.getItemAsync(USER_KEY);
    if (boundUserId !== expectedUserId || user.id !== expectedUserId) return false;
    await writeAccountBundle({ version: 2, userId: expectedUserId, user });
    return true;
  });
}

export async function restoreBoundUserIfCurrent(
  user: AuthUser,
  snapshot: AuthTokenSnapshot,
): Promise<AuthUser | null> {
  return tokenMutex.withLock(async () => {
    const current = await readSessionEnvelope();
    if (
      !snapshotMatchesEnvelope(snapshot, current) ||
      current?.state !== "bound" ||
      current.user?.id !== user.id
    ) {
      return null;
    }

    try {
      await accountMutex.withLock(() => writeAccountBundle({
        version: 2,
        userId: user.id,
        user,
      }));
      // The token mutex remains held through this return value, making the
      // ownership check, cache repair and offline identity one linearizable
      // operation. A newer login cannot be overwritten by a stale fallback.
      return user;
    } catch (error) {
      console.warn("Failed to repair the account cache for the current offline session", error);
      tokenGeneration += 1;
      await deleteTokens();
      return null;
    }
  });
}

export async function clearStoredUserId(): Promise<void> {
  await accountMutex.withLock(async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCOUNT_BUNDLE_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
      SecureStore.deleteItemAsync(USER_DATA_KEY),
    ]);
  });
}
