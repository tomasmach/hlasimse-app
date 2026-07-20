import * as SecureStore from "expo-secure-store";
import {
  apiRequest,
  clearReleaseGate,
  setReleaseGateHandler,
  setUnauthorizedHandler,
} from "@/lib/api";
import { getTokens, saveTokens, setStoredUser } from "@/lib/authStorage";
import { login, logout, restoreUser } from "@/lib/auth";
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

it("purges the previous account queue on account switch and the current queue on logout", async () => {
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
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/token/")) return json({ access: "new-access", refresh: "new-refresh" });
    if (url.endsWith("/auth/me/")) return json({ id: "new-user", email: "new@example.test", first_name: "New", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" });
    if (url.endsWith("/push-devices/")) return json([]);
    if (url.endsWith("/auth/logout/")) return new Response(null, { status: 204 });
    return json({}, 404);
  });
  await login("new@example.test", "very-long-password");
  expect(await getQueue("old-user", installationId)).toHaveLength(0);
  await addToQueue({ ...queued, userId: "new-user" });
  await logout();
  expect(await getQueue("new-user", installationId)).toHaveLength(0);
  expect(await getTokens()).toBeNull();
});
