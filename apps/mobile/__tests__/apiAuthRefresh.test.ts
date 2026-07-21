import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import {
  apiRequest,
  clearReleaseGate,
  setReleaseGateHandler,
  setUnauthorizedHandler,
} from "@/lib/api";
import { getStoredUserId, getTokens, saveTokens, setStoredUser } from "@/lib/authStorage";
import { clearLocalSession, login, logout, restoreUser } from "@/lib/auth";
import { setStoredUserId } from "@/lib/authStorage";
import { getInstallationId } from "@/lib/installation";
import { addToQueue, getQueue } from "@/lib/offlineQueue";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

it("restores the encrypted cached user during a cold offline start", async () => {
  const cached = { id: "cached-user", email: "cached@example.test", first_name: "Jana", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  await setStoredUser(cached);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network request failed"));
  await expect(restoreUser()).resolves.toEqual(cached);
  expect(await getTokens()).not.toBeNull();
});

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([]);
  (SecureStore as unknown as { __reset(): void }).__reset();
  setUnauthorizedHandler(null);
  setReleaseGateHandler(null);
  clearReleaseGate();
  await saveTokens({ access: "expired", refresh: "refresh-1" });
});

it("uses one refresh request for concurrent 401 responses", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/token/refresh/")) return json({ access: "fresh", refresh: "refresh-2" });
    const auth = new Headers(init?.headers).get("Authorization");
    return auth === "Bearer fresh" ? json({ ok: true }) : json({ detail: "expired" }, 401);
  });
  const [one, two] = await Promise.all([apiRequest<{ ok: boolean }>("/one"), apiRequest<{ ok: boolean }>("/two")]);
  expect(one.ok && two.ok).toBe(true);
  expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/auth/token/refresh/")).length).toBe(1);
  for (const [, init] of fetchMock.mock.calls) {
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Hlasimse-Client")).toBe("hlasimse-mobile");
    expect(headers.get("X-Hlasimse-Platform")).toBe("ios");
    expect(headers.get("X-Hlasimse-Version")).toBe("1.0.0");
    expect(headers.get("X-Hlasimse-Build")).toBe("1");
  }
  expect(await getTokens()).toEqual({ access: "fresh", refresh: "refresh-2" });
});

it("clears credentials and invokes logout state handling when refresh is rejected", async () => {
  const unauthorized = jest.fn();
  setUnauthorizedHandler(unauthorized);
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input).endsWith("/auth/token/refresh/") ? json({ detail: "invalid" }, 401) : json({}, 401),
  );
  await expect(apiRequest("/protected")).rejects.toThrow("Přihlášení vypršelo");
  expect(await getTokens()).toBeNull();
  expect(unauthorized).toHaveBeenCalledTimes(1);
});

it("stores a refresh rotation as one versioned token bundle", async () => {
  const secureStore = SecureStore as unknown as {
    __values: Map<string, string>;
    setItemAsync: jest.Mock;
  };
  await saveTokens({ access: "rotated-access", refresh: "rotated-refresh" });

  expect(JSON.parse(secureStore.__values.get("hlasimse.auth.tokens.v2") || "null")).toEqual({
    version: 2,
    access: "rotated-access",
    refresh: "rotated-refresh",
  });
  expect(secureStore.setItemAsync).toHaveBeenLastCalledWith(
    "hlasimse.auth.tokens.v2",
    expect.any(String),
  );
  expect(secureStore.__values.has("hlasimse.auth.access.v1")).toBe(false);
  expect(secureStore.__values.has("hlasimse.auth.refresh.v1")).toBe(false);
});

it("captures update-required without clearing credentials", async () => {
  const gateHandler = jest.fn();
  setReleaseGateHandler(gateHandler);
  jest.spyOn(globalThis, "fetch").mockResolvedValue(json({
    code: "update_required",
    detail: "Aktualizujte aplikaci.",
    min_version: "1.0.0",
    min_build: 2,
    store_url: "https://apps.apple.com/app/hlasim-se/id123456789",
  }, 426));

  await expect(apiRequest("/api/v1/profiles/")).rejects.toMatchObject({ status: 426 });
  expect(gateHandler).toHaveBeenCalledWith(expect.objectContaining({
    kind: "update",
    minVersion: "1.0.0",
    minBuild: 2,
  }));
  expect(await getTokens()).toEqual({ access: "expired", refresh: "refresh-1" });
});

it("captures maintenance returned during token refresh without logging out", async () => {
  const gateHandler = jest.fn();
  const unauthorized = jest.fn();
  setReleaseGateHandler(gateHandler);
  setUnauthorizedHandler(unauthorized);
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    String(input).endsWith("/auth/token/refresh/")
      ? json({ code: "maintenance", detail: "Probíhá údržba." }, 503)
      : json({ detail: "expired" }, 401),
  );

  await expect(apiRequest("/api/v1/profiles/")).rejects.toMatchObject({ status: 503 });
  expect(gateHandler).toHaveBeenCalledWith({ kind: "maintenance", detail: "Probíhá údržba." });
  expect(unauthorized).not.toHaveBeenCalled();
  expect(await getTokens()).toEqual({ access: "expired", refresh: "refresh-1" });
});

it("preserves the previous account queue on account switch and purges the current queue on logout", async () => {
  const installationId = await getInstallationId();
  const queued = {
    installationId,
    profileId: "33333333-3333-4333-8333-333333333333",
    clientRecordedAt: "2026-07-19T12:00:00Z",
    latitude: null,
    longitude: null,
    locationAccuracyMeters: null,
    status: "pending" as const,
    error: null,
  };
  await setStoredUserId("old-user");
  await addToQueue({ ...queued, userId: "old-user" });
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValue([
    { identifier: "checkin-reminder-old-profile-indefinite-pause" },
  ]);
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/token/")) return json({ access: "new-access", refresh: "new-refresh" });
    if (url.endsWith("/auth/me/")) return json({ id: "new-user", email: "new@example.test", first_name: "New", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" });
    if (url.endsWith("/push-devices/")) return json([]);
    if (url.endsWith("/auth/logout/")) return new Response(null, { status: 204 });
    return json({}, 404);
  });
  await login("new@example.test", "very-long-password");
  expect(await getQueue("old-user", installationId)).toHaveLength(1);
  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
    "checkin-reminder-old-profile-indefinite-pause",
  );
  await addToQueue({ ...queued, userId: "new-user" });
  await logout();
  expect(await getQueue("new-user", installationId)).toHaveLength(0);
  expect(await getTokens()).toBeNull();
});

it("keeps the local session and queue when server-side logout cleanup cannot be confirmed", async () => {
  const installationId = await getInstallationId();
  await setStoredUserId("current-user");
  await addToQueue({
    userId: "current-user",
    installationId,
    profileId: "33333333-3333-4333-8333-333333333333",
    clientRecordedAt: "2026-07-19T12:00:00Z",
    latitude: null,
    longitude: null,
    locationAccuracyMeters: null,
    status: "pending",
    error: null,
  });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network request failed"));

  await expect(logout()).rejects.toThrow("Bezpečné odhlášení se nepodařilo potvrdit serverem");
  expect(await getTokens()).toEqual({ access: "expired", refresh: "refresh-1" });
  expect(await getQueue("current-user", installationId)).toHaveLength(1);
});

it("does not resurrect refreshed credentials after an overlapping session clear", async () => {
  let resolveRefreshStarted!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    resolveRefreshStarted = resolve;
  });
  let resolveRefresh!: (response: Response) => void;
  const refreshResponse = new Promise<Response>((resolve) => {
    resolveRefresh = resolve;
  });
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/auth/token/refresh/")) {
      resolveRefreshStarted();
      return refreshResponse;
    }
    return json({ detail: "expired" }, 401);
  });

  const request = apiRequest("/protected");
  await refreshStarted;
  await clearLocalSession({ purgeQueue: false, preserveAccountBinding: true });
  resolveRefresh(json({ access: "late-access", refresh: "late-refresh" }));

  await expect(request).rejects.toThrow("Přihlášení vypršelo");
  expect(await getTokens()).toBeNull();
});

it("preserves the account binding and pending queue after involuntary session expiry", async () => {
  const installationId = await getInstallationId();
  await setStoredUserId("current-user");
  await addToQueue({
    userId: "current-user",
    installationId,
    profileId: "33333333-3333-4333-8333-333333333333",
    clientRecordedAt: "2026-07-19T12:00:00Z",
    latitude: null,
    longitude: null,
    locationAccuracyMeters: null,
    status: "pending",
    error: null,
  });

  await clearLocalSession({ purgeQueue: false, preserveAccountBinding: true });

  expect(await getTokens()).toBeNull();
  expect(await getStoredUserId()).toBe("current-user");
  expect(await getQueue("current-user", installationId)).toHaveLength(1);
});
