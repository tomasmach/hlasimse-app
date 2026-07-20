import { apiRequest, isNetworkError, isReleaseGateError } from "@/lib/api";
import {
  clearStoredUserId,
  clearTokens,
  getStoredUserId,
  getStoredUser,
  getTokens,
  saveTokens,
  setStoredUserId,
  setStoredUser,
} from "@/lib/authStorage";
import { clearQueue } from "@/lib/offlineQueue";
import { getInstallationId } from "@/lib/installation";
import { clearConfirmedProfiles } from "@/lib/profileCache";
import { deactivateCurrentPushDevice } from "@/lib/pushDevices";
import { cancelAllReminders } from "@/lib/reminderNotifications";
import type {
  AuthTokens,
  AuthUser,
  EmailVerificationResult,
  RegistrationResult,
} from "@/types/api";

async function bindAccount(user: AuthUser): Promise<void> {
  const previousUserId = await getStoredUserId();
  if (previousUserId && previousUserId !== user.id) {
    await Promise.all([
      clearQueue(previousUserId, await getInstallationId()),
      cancelAllReminders(),
    ]);
  }
  await setStoredUserId(user.id);
  await setStoredUser(user);
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const tokens = await apiRequest<AuthTokens>("/api/v1/auth/token/", {
    method: "POST",
    body: { email: email.trim().toLowerCase(), password },
    auth: false,
  });
  await saveTokens(tokens);
  try {
    const user = await apiRequest<AuthUser>("/api/v1/auth/me/");
    await bindAccount(user);
    return user;
  } catch (error) {
    await clearTokens();
    throw error;
  }
}

export async function register(input: {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
}): Promise<RegistrationResult> {
  return apiRequest<RegistrationResult>("/api/v1/auth/register/", {
    method: "POST",
    auth: false,
    body: {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      first_name: input.firstName.trim(),
      last_name: input.lastName?.trim() || "",
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
  if (!(await getTokens())) return null;
  const cachedUser = await getStoredUser();
  try {
    const user = await apiRequest<AuthUser>("/api/v1/auth/me/");
    await bindAccount(user);
    return user;
  } catch (error) {
    if (isNetworkError(error) && cachedUser) return cachedUser;
    if (isReleaseGateError(error)) return cachedUser;
    await clearTokens();
    return null;
  }
}

export async function clearLocalSession(options: { purgeQueue: boolean }): Promise<void> {
  const userId = await getStoredUserId();
  if (userId) {
    if (options.purgeQueue) await clearQueue(userId, await getInstallationId());
    await clearConfirmedProfiles(userId);
  }
  await Promise.all([clearTokens(), clearStoredUserId()]);
}

export async function logout(): Promise<void> {
  const tokens = await getTokens();
  if (tokens?.refresh) {
    try {
      await deactivateCurrentPushDevice();
      const currentTokens = await getTokens();
      if (!currentTokens?.refresh) throw new Error("Session already cleared");
      await apiRequest<void>("/api/v1/auth/logout/", {
        method: "POST",
        body: { refresh: currentTokens.refresh },
      });
    } catch (error) {
      throw new Error(
        "Bezpečné odhlášení se nepodařilo potvrdit serverem. Zkontrolujte připojení a zkuste to znovu; účet i upozornění na tomto zařízení zatím zůstávají aktivní.",
        { cause: error },
      );
    }
  }
  await clearLocalSession({ purgeQueue: true });
}
