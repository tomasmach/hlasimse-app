import * as Application from "expo-application";
import { Platform } from "react-native";

import {
  clearTokens,
  clearTokensIfCurrent,
  getTokenSnapshot,
  getTokens,
  saveTokensIfCurrent,
} from "@/lib/authStorage";
import { resolveApiBaseUrl } from "@/lib/apiConfig";
import { monotonicNowMs, observeServerTimeHeader } from "@/lib/serverClock";
import { clientHeaders, gateFromError, type ClientGate } from "@/lib/clientRelease";
import type { ApiErrorBody, AuthTokens } from "@/types/api";

const isDevelopment = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";

export const API_BASE_URL = resolveApiBaseUrl({
  configuredBaseUrl: process.env.EXPO_PUBLIC_API_URL,
  isDevelopment,
  isAndroidE2E: Platform.OS === "android" && Application.applicationId?.endsWith(".e2e") === true,
  isIosE2E: Platform.OS === "ios" && Application.applicationId?.endsWith(".e2e") === true,
});

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | null,
    message?: string,
  ) {
    super(message || apiErrorMessage(body) || `HTTP ${status}`);
    this.name = "ApiError";
  }
}

export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("Server není dostupný. Zkontrolujte připojení.");
    this.name = "NetworkError";
    if (cause) (this as Error & { cause?: unknown }).cause = cause;
  }
}

function apiErrorMessage(body: ApiErrorBody | null): string | null {
  if (!body) return null;
  if (typeof body.detail === "string") return body.detail;
  if (typeof body.error?.details === "string") return body.error.details;
  for (const value of Object.values(body)) {
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return null;
}

let refreshPromise: Promise<string | null> | null = null;
let unauthorizedHandler: (() => void | Promise<void>) | null = null;
let releaseGateHandler: ((gate: ClientGate) => void) | null = null;
let lastReleaseGate: ClientGate | null = null;
const DEFAULT_TIMEOUT_MS = 15_000;

export function setUnauthorizedHandler(handler: (() => void | Promise<void>) | null): void {
  unauthorizedHandler = handler;
}

export function setReleaseGateHandler(handler: ((gate: ClientGate) => void) | null): void {
  releaseGateHandler = handler;
  if (handler && lastReleaseGate) handler(lastReleaseGate);
}

export function clearReleaseGate(): void {
  lastReleaseGate = null;
}

function captureReleaseGate(status: number, body: unknown): boolean {
  const gate = gateFromError(status, body);
  if (!gate) return false;
  lastReleaseGate = gate;
  releaseGateHandler?.(gate);
  return true;
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const suppliedSignal = init.signal;
  const abort = () => controller.abort();
  suppliedSignal?.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    suppliedSignal?.removeEventListener("abort", abort);
  }
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const snapshot = await getTokenSnapshot();
    const tokens = snapshot.tokens;
    if (!tokens?.refresh) return null;
    let response: Response;
    const requestStartedAtMs = Date.now();
    const requestStartedMonotonicMs = monotonicNowMs();
    try {
      response = await fetchWithTimeout(`${API_BASE_URL}/api/v1/auth/token/refresh/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...clientHeaders(),
        },
        body: JSON.stringify({ refresh: tokens.refresh }),
      });
    } catch (error) {
      throw new NetworkError(error);
    }
    const responseReceivedAtMs = Date.now();
    const responseReceivedMonotonicMs = monotonicNowMs();
    observeServerTimeHeader(
      response,
      requestStartedAtMs,
      responseReceivedAtMs,
      requestStartedMonotonicMs !== null && responseReceivedMonotonicMs !== null
        ? { requestStartedMonotonicMs, responseReceivedMonotonicMs }
        : undefined,
    );
    const body = await parseBody(response);
    if (captureReleaseGate(response.status, body)) {
      throw new ApiError(
        response.status,
        typeof body === "object" ? (body as ApiErrorBody) : null,
      );
    }
    if (!response.ok) {
      if (await clearTokensIfCurrent(snapshot)) await unauthorizedHandler?.();
      return null;
    }
    const tokenBody = body as { access?: unknown; refresh?: unknown };
    if (typeof tokenBody?.access !== "string" || (tokenBody.refresh !== undefined && typeof tokenBody.refresh !== "string")) {
      if (await clearTokensIfCurrent(snapshot)) await unauthorizedHandler?.();
      return null;
    }
    const next: AuthTokens = { access: tokenBody.access, refresh: tokenBody.refresh || tokens.refresh };
    return await saveTokensIfCurrent(next, snapshot) ? next.access : null;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  auth?: boolean;
  retryAuth?: boolean;
  timeoutMs?: number;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, auth = true, retryAuth = true, timeoutMs = DEFAULT_TIMEOUT_MS, headers: suppliedHeaders, ...requestInit } = options;
  const headers = new Headers(suppliedHeaders);
  headers.set("Accept", "application/json");
  for (const [name, value] of Object.entries(clientHeaders())) headers.set(name, value);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (auth) {
    const tokens = await getTokens();
    if (tokens?.access) headers.set("Authorization", `Bearer ${tokens.access}`);
  }

  let response: Response;
  const requestStartedAtMs = Date.now();
  const requestStartedMonotonicMs = monotonicNowMs();
  try {
    response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
      ...requestInit,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }, timeoutMs);
  } catch (error) {
    throw new NetworkError(error);
  }
  const responseReceivedAtMs = Date.now();
  const responseReceivedMonotonicMs = monotonicNowMs();
  observeServerTimeHeader(
    response,
    requestStartedAtMs,
    responseReceivedAtMs,
    requestStartedMonotonicMs !== null && responseReceivedMonotonicMs !== null
      ? { requestStartedMonotonicMs, responseReceivedMonotonicMs }
      : undefined,
  );

  if (response.status === 401 && auth && retryAuth) {
    const access = await refreshAccessToken();
    if (!access) throw new ApiError(401, null, "Přihlášení vypršelo.");
    return apiRequest<T>(path, { ...options, retryAuth: false });
  }

  if (response.status === 401 && auth && !retryAuth) {
    await clearTokens();
    await unauthorizedHandler?.();
  }

  const parsed = await parseBody(response);
  captureReleaseGate(response.status, parsed);
  if (!response.ok) {
    throw new ApiError(response.status, typeof parsed === "object" ? (parsed as ApiErrorBody) : null);
  }
  return parsed as T;
}

export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof NetworkError;
}

export function isReleaseGateError(error: unknown): error is ApiError {
  return error instanceof ApiError && gateFromError(error.status, error.body) !== null;
}
