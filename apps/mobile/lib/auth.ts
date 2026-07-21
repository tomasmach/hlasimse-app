import { apiRequest, isNetworkError, isReleaseGateError } from "@/lib/api";
import {
  clearStoredUserId,
  clearTokens,
  clearTokensIfCurrent,
  bindSessionUserIfCurrent,
  commitBoundSessionAndAccountIfCurrent,
  getTokenSnapshot,
  getStoredUserId,
  saveTokens,
  restoreBoundUserIfCurrent,
  setStoredUserIfBound,
} from "@/lib/authStorage";
import { clearQueue } from "@/lib/offlineQueue";
import { getInstallationId } from "@/lib/installation";
import { clearConfirmedProfiles } from "@/lib/profileCache";
import {
  beginPushDeviceLogout,
  resumePushDeviceRegistration,
} from "@/lib/pushDevices";
import { cancelAllReminders } from "@/lib/reminderNotifications";
import type {
  AuthTokens,
  AuthUser,
  EmailVerificationResult,
  RegistrationResult,
} from "@/types/api";

let loginAttemptGeneration = 0;

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const loginCommitMutex = new AsyncMutex();

export async function updateAccountName(input: {
  expectedUserId: string;
  firstName: string;
  lastName: string;
}): Promise<AuthUser> {
  const initialSnapshot = await getTokenSnapshot();
  if (initialSnapshot.state !== "bound" || initialSnapshot.user?.id !== input.expectedUserId) {
    throw new Error("Přihlášený účet se mezitím změnil. Zkuste to znovu.");
  }
  let confirmedSnapshot = initialSnapshot;
  const user = await apiRequest<AuthUser>("/api/v1/auth/me/", {
    method: "PATCH",
    authSnapshot: initialSnapshot,
    onAuthSnapshotSelected: (snapshot) => { confirmedSnapshot = snapshot; },
    onAuthenticatedSnapshot: (snapshot) => { confirmedSnapshot = snapshot; },
    body: {
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
    },
  });
  if (user.id !== input.expectedUserId) {
    throw new Error("Server vrátil jiný účet. Změna se v aplikaci nepoužila.");
  }
  if (!await bindSessionUserIfCurrent(user, confirmedSnapshot)) {
    throw new Error("Přihlášený účet se mezitím změnil. Ověřte jméno po novém přihlášení.");
  }
  if (!await setStoredUserIfBound(user, input.expectedUserId)) {
    throw new Error("Přihlášený účet se mezitím změnil. Ověřte jméno po novém přihlášení.");
  }
  return user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const loginAttempt = await loginCommitMutex.withLock(async () => ++loginAttemptGeneration);
  const tokens = await apiRequest<AuthTokens>("/api/v1/auth/token/", {
    method: "POST",
    body: { email: email.trim().toLowerCase(), password },
    auth: false,
  });
  const pendingSnapshot = await loginCommitMutex.withLock(async () => {
    if (loginAttempt !== loginAttemptGeneration) return null;
    await saveTokens(tokens);
    return getTokenSnapshot();
  });
  if (!pendingSnapshot) throw new Error("Tento pokus o přihlášení nahradil novější pokus.");
  let ownedSnapshot = pendingSnapshot;
  try {
    let confirmedSnapshot = pendingSnapshot;
    const user = await apiRequest<AuthUser>("/api/v1/auth/me/", {
      authSnapshot: pendingSnapshot,
      onAuthSnapshotSelected: (snapshot) => {
        ownedSnapshot = snapshot;
        confirmedSnapshot = snapshot;
      },
      onAuthenticatedSnapshot: (snapshot) => {
        ownedSnapshot = snapshot;
        confirmedSnapshot = snapshot;
      },
    });
    const committedSnapshot = await loginCommitMutex.withLock(async () => {
      if (loginAttempt !== loginAttemptGeneration) return null;
      const previousUserId = await getStoredUserId();
      if (previousUserId && previousUserId !== user.id) await cancelAllReminders();
      if (loginAttempt !== loginAttemptGeneration) return null;
      return commitBoundSessionAndAccountIfCurrent(user, confirmedSnapshot);
    });
    if (!committedSnapshot) {
      throw new Error(loginAttempt !== loginAttemptGeneration
        ? "Tento pokus o přihlášení nahradil novější pokus."
        : "Přihlášení se během potvrzení účtu změnilo.");
    }
    // This exact snapshot came from A's atomic commit. Never adopt an
    // arbitrary current snapshot, which may already belong to a newer B login.
    ownedSnapshot = committedSnapshot;
    resumePushDeviceRegistration();
    return user;
  } catch (error) {
    await clearTokensIfCurrent(ownedSnapshot);
    throw error;
  }
}

export async function register(input: {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
  termsAccepted: boolean;
}): Promise<RegistrationResult> {
  return apiRequest<RegistrationResult>("/api/v1/auth/register/", {
    method: "POST",
    auth: false,
    body: {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      first_name: input.firstName.trim(),
      last_name: input.lastName?.trim() || "",
      terms_accepted: input.termsAccepted,
    },
  });
}

export async function resendEmailVerification(email: string): Promise<RegistrationResult> {
  return apiRequest<RegistrationResult>("/api/v1/auth/email-verification/resend/", {
    method: "POST",
    auth: false,
    body: { email: email.trim().toLowerCase() },
  });
}

export async function confirmEmailVerification(token: string): Promise<EmailVerificationResult> {
  return apiRequest<EmailVerificationResult>("/api/v1/auth/email-verification/confirm/", {
    method: "POST",
    auth: false,
    body: { token },
  });
}

export async function restoreUser(): Promise<AuthUser | null> {
  const restoreStart = await loginCommitMutex.withLock(async () => ({
    loginGeneration: loginAttemptGeneration,
    snapshot: await getTokenSnapshot(),
  }));
  const restoreLoginGeneration = restoreStart.loginGeneration;
  const initialSnapshot = restoreStart.snapshot;
  if (!initialSnapshot.tokens) return null;
  const cachedUser = initialSnapshot.state === "bound" ? initialSnapshot.user : null;
  let ownedSnapshot = initialSnapshot;
  try {
    let confirmedSnapshot = initialSnapshot;
    const user = await apiRequest<AuthUser>("/api/v1/auth/me/", {
      authSnapshot: initialSnapshot,
      onAuthSnapshotSelected: (snapshot) => {
        ownedSnapshot = snapshot;
        confirmedSnapshot = snapshot;
      },
      onAuthenticatedSnapshot: (snapshot) => {
        ownedSnapshot = snapshot;
        confirmedSnapshot = snapshot;
      },
    });
    const committedSnapshot = await loginCommitMutex.withLock(async () => {
      if (restoreLoginGeneration !== loginAttemptGeneration) return null;
      const previousUserId = await getStoredUserId();
      if (previousUserId && previousUserId !== user.id) await cancelAllReminders();
      if (restoreLoginGeneration !== loginAttemptGeneration) return null;
      return commitBoundSessionAndAccountIfCurrent(user, confirmedSnapshot);
    });
    if (!committedSnapshot) return null;
    ownedSnapshot = committedSnapshot;
    resumePushDeviceRegistration();
    return user;
  } catch (error) {
    if (isNetworkError(error) || isReleaseGateError(error)) {
      return loginCommitMutex.withLock(async () => {
        if (restoreLoginGeneration !== loginAttemptGeneration || !cachedUser) return null;
        return restoreBoundUserIfCurrent(cachedUser, ownedSnapshot);
      });
    }
    await clearTokensIfCurrent(ownedSnapshot);
    return null;
  }
}

export async function clearLocalSession(options: {
  purgeQueue: boolean;
  preserveAccountBinding?: boolean;
}): Promise<void> {
  const userId = await getStoredUserId();
  if (userId) {
    if (options.purgeQueue) await clearQueue(userId, await getInstallationId());
    if (!options.preserveAccountBinding) await clearConfirmedProfiles(userId);
  }
  await Promise.all([
    clearTokens(),
    ...(options.preserveAccountBinding ? [] : [clearStoredUserId()]),
  ]);
}

export async function logout(): Promise<void> {
  const initialSnapshot = await getTokenSnapshot();
  if (initialSnapshot.tokens?.refresh) {
    try {
      const installationId = await beginPushDeviceLogout();
      await apiRequest<void>("/api/v1/auth/logout/", {
        method: "POST",
        authSnapshot: initialSnapshot,
        bodyForAuthSnapshot: (snapshot) => ({
          refresh: snapshot.tokens?.refresh,
          installation_id: installationId,
        }),
      });
    } catch (error) {
      resumePushDeviceRegistration();
      throw new Error(
        "Bezpečné odhlášení se nepodařilo potvrdit serverem. Zkontrolujte připojení a zkuste to znovu; účet i upozornění na tomto zařízení zatím zůstávají aktivní.",
        { cause: error },
      );
    }
  }
  await clearLocalSession({ purgeQueue: true });
}
