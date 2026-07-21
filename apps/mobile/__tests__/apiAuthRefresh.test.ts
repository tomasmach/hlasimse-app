import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import {
  apiRequest,
  clearReleaseGate,
  setReleaseGateHandler,
  setUnauthorizedHandler,
} from "@/lib/api";
import {
  clearStoredUserId,
  bindSessionUserIfCurrent,
  getSessionUser,
  getStoredUser,
  getStoredUserId,
  getTokens,
  getTokenSnapshot,
  saveTokens,
  setStoredUser,
  setStoredUserId,
} from "@/lib/authStorage";
import { clearLocalSession, login, logout, restoreUser, updateAccountName } from "@/lib/auth";
import { getInstallationId } from "@/lib/installation";
import { addToQueue, getQueue } from "@/lib/offlineQueue";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

const bindCurrentSession = async (user: {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  date_joined: string;
  email_verified_at: string;
}) => {
  const snapshot = await getTokenSnapshot();
  expect(await bindSessionUserIfCurrent(user, snapshot)).toBe(true);
};

it("restores the encrypted cached user during a cold offline start", async () => {
  const cached = { id: "cached-user", email: "cached@example.test", first_name: "Jana", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  await setStoredUser(cached);
  await bindCurrentSession(cached);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network request failed"));
  await expect(restoreUser()).resolves.toEqual(cached);
  expect(await getTokens()).not.toBeNull();
});

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  const secureStore = SecureStore as unknown as {
    __values: Map<string, string>;
    getItemAsync: jest.Mock;
    setItemAsync: jest.Mock;
    deleteItemAsync: jest.Mock;
  };
  secureStore.getItemAsync.mockImplementation(async (key: string) => secureStore.__values.get(key) ?? null);
  secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => { secureStore.__values.set(key, value); });
  secureStore.deleteItemAsync.mockImplementation(async (key: string) => { secureStore.__values.delete(key); });
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

it("never refreshes or replays an A request after a B login replaces the session", async () => {
  let markAStarted!: () => void;
  const aStarted = new Promise<void>((resolve) => { markAStarted = resolve; });
  let resolveA!: (response: Response) => void;
  const aResponse = new Promise<Response>((resolve) => { resolveA = resolve; });
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/protected-a")) { markAStarted(); return aResponse; }
    throw new Error(`Unexpected replay or refresh: ${String(input)}`);
  });

  const requestA = apiRequest("/protected-a");
  await aStarted;
  await saveTokens({ access: "b-access", refresh: "b-refresh" });
  resolveA(json({ detail: "expired A" }, 401));

  await expect(requestA).rejects.toThrow("Přihlášený účet se během požadavku změnil");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await getTokens()).toEqual({ access: "b-access", refresh: "b-refresh" });
});

it("rejects a stale same-account generation without refresh or replay", async () => {
  let markOldStarted!: () => void;
  const oldStarted = new Promise<void>((resolve) => { markOldStarted = resolve; });
  let resolveOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).endsWith("/same-account")) { markOldStarted(); return oldResponse; }
    throw new Error(`Unexpected replay or refresh: ${String(input)}`);
  });

  const staleRequest = apiRequest("/same-account");
  await oldStarted;
  await saveTokens({ access: "new-generation", refresh: "refresh-1" });
  resolveOld(json({ detail: "old generation" }, 401));

  await expect(staleRequest).rejects.toThrow("Přihlášený účet se během požadavku změnil");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await getTokens()).toEqual({ access: "new-generation", refresh: "refresh-1" });
});

it("does not return an A body when B login lands while response text is parsing", async () => {
  let markTextStarted!: () => void;
  const textStarted = new Promise<void>((resolve) => { markTextStarted = resolve; });
  let resolveText!: (value: string) => void;
  const delayedText = new Promise<string>((resolve) => { resolveText = resolve; });
  const response = new Response(null, { status: 200, headers: { "Content-Type": "application/json" } });
  jest.spyOn(response, "text").mockImplementation(async () => {
    markTextStarted();
    return delayedText;
  });
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(response);

  const requestA = apiRequest<{ private_owner: string }>("/private-a");
  await textStarted;
  await saveTokens({ access: "b-access", refresh: "b-refresh" });
  resolveText(JSON.stringify({ private_owner: "A" }));

  await expect(requestA).rejects.toThrow("během zpracování odpovědi změnil");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await getTokens()).toEqual({ access: "b-access", refresh: "b-refresh" });
});

it("keeps the newer login when an older token response arrives last", async () => {
  let resolveA!: (response: Response) => void;
  let resolveB!: (response: Response) => void;
  const responseA = new Promise<Response>((resolve) => { resolveA = resolve; });
  const responseB = new Promise<Response>((resolve) => { resolveB = resolve; });
  let markAStarted!: () => void;
  let markBStarted!: () => void;
  const aStarted = new Promise<void>((resolve) => { markAStarted = resolve; });
  const bStarted = new Promise<void>((resolve) => { markBStarted = resolve; });
  const userB = { id: "user-b", email: "b@example.test", first_name: "B", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/token/")) {
      const email = JSON.parse(String(init?.body)).email;
      if (email === "a@example.test") { markAStarted(); return responseA; }
      markBStarted();
      return responseB;
    }
    if (url.endsWith("/auth/me/") && new Headers(init?.headers).get("Authorization") === "Bearer b-access") {
      return json(userB);
    }
    return json({ detail: "unexpected session" }, 401);
  });

  const loginA = login("a@example.test", "long-password-a");
  await aStarted;
  const loginB = login("b@example.test", "long-password-b");
  await bStarted;
  resolveB(json({ access: "b-access", refresh: "b-refresh" }));
  await expect(loginB).resolves.toEqual(userB);
  resolveA(json({ access: "a-access", refresh: "a-refresh" }));

  await expect(loginA).rejects.toThrow("nahradil novější pokus");
  expect(await getTokens()).toEqual({ access: "b-access", refresh: "b-refresh" });
  expect(await getSessionUser()).toEqual(userB);
});

it("keeps B intact when B starts during A's exact bound-session commit", async () => {
  const userA = { id: "user-a", email: "a@example.test", first_name: "A", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const userB = { id: "user-b", email: "b@example.test", first_name: "B", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const secureStore = SecureStore as unknown as {
    __values: Map<string, string>;
    setItemAsync: jest.Mock;
  };
  let markABindStarted!: () => void;
  const aBindStarted = new Promise<void>((resolve) => { markABindStarted = resolve; });
  let releaseABind!: () => void;
  const aBindRelease = new Promise<void>((resolve) => { releaseABind = resolve; });
  let delayed = false;
  secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
    if (key === "hlasimse.auth.session.v3") {
      const envelope = JSON.parse(value);
      if (!delayed && envelope.state === "bound" && envelope.user?.id === userA.id) {
        delayed = true;
        markABindStarted();
        await aBindRelease;
      }
    }
    secureStore.__values.set(key, value);
  });
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/token/")) {
      const email = JSON.parse(String(init?.body)).email;
      return email === userA.email
        ? json({ access: "a-access", refresh: "a-refresh" })
        : json({ access: "b-access", refresh: "b-refresh" });
    }
    if (url.endsWith("/auth/me/")) {
      return new Headers(init?.headers).get("Authorization") === "Bearer a-access"
        ? json(userA)
        : json(userB);
    }
    return json({}, 404);
  });

  const loginA = login(userA.email, "long-password-a");
  await aBindStarted;
  const loginB = login(userB.email, "long-password-b");
  await Promise.resolve();
  expect(fetchMock.mock.calls.filter(([, init]) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    return body?.email === userB.email;
  })).toHaveLength(0);
  releaseABind();

  await expect(loginA).resolves.toEqual(userA);
  await expect(loginB).resolves.toEqual(userB);
  expect(await getTokens()).toEqual({ access: "b-access", refresh: "b-refresh" });
  expect(await getSessionUser()).toEqual(userB);
  expect(await getStoredUser()).toEqual(userB);
  expect(await getStoredUserId()).toBe(userB.id);
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

  expect(JSON.parse(secureStore.__values.get("hlasimse.auth.session.v3") || "null")).toEqual({
    version: 3,
    access: "rotated-access",
    refresh: "rotated-refresh",
    state: "pending",
    user: null,
  });
  expect(secureStore.setItemAsync).toHaveBeenLastCalledWith(
    "hlasimse.auth.session.v3",
    expect.any(String),
  );
  expect(secureStore.__values.has("hlasimse.auth.access.v1")).toBe(false);
  expect(secureStore.__values.has("hlasimse.auth.refresh.v1")).toBe(false);
});

it("fails closed on corrupt authoritative v3 without adopting stale legacy tokens", async () => {
  const secureStore = SecureStore as unknown as { __values: Map<string, string> };
  secureStore.__values.set("hlasimse.auth.session.v3", "{corrupt-json");
  secureStore.__values.set("hlasimse.auth.tokens.v2", JSON.stringify({
    version: 2,
    access: "stale-v2-access",
    refresh: "stale-v2-refresh",
  }));
  secureStore.__values.set("hlasimse.auth.access.v1", "stale-v1-access");
  secureStore.__values.set("hlasimse.auth.refresh.v1", "stale-v1-refresh");

  expect(await getTokens()).toBeNull();
  expect(await getSessionUser()).toBeNull();
  expect(secureStore.__values.get("hlasimse.auth.session.v3")).toBe("{corrupt-json");
  expect(secureStore.__values.get("hlasimse.auth.tokens.v2")).toContain("stale-v2-access");
});

it("migrates legacy tokens only when the v3 envelope key is missing", async () => {
  const secureStore = SecureStore as unknown as { __values: Map<string, string> };
  secureStore.__values.delete("hlasimse.auth.session.v3");
  secureStore.__values.set("hlasimse.auth.tokens.v2", JSON.stringify({
    version: 2,
    access: "legacy-access",
    refresh: "legacy-refresh",
  }));

  expect(await getTokens()).toEqual({ access: "legacy-access", refresh: "legacy-refresh" });
  expect(JSON.parse(secureStore.__values.get("hlasimse.auth.session.v3") || "null")).toEqual({
    version: 3,
    access: "legacy-access",
    refresh: "legacy-refresh",
    state: "pending",
    user: null,
  });
  expect(secureStore.__values.has("hlasimse.auth.tokens.v2")).toBe(false);
});

it("persists a server-confirmed name as one account bundle", async () => {
  const current = { id: "user-1", email: "jana@example.test", first_name: "Jana", last_name: "Stará", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const updated = { ...current, first_name: "Jana Marie", last_name: "Nová" };
  await setStoredUser(current);
  await bindCurrentSession(current);
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(json(updated));

  await expect(updateAccountName({
    expectedUserId: current.id,
    firstName: " Jana Marie ",
    lastName: " Nová ",
  })).resolves.toEqual(updated);

  expect(JSON.parse((SecureStore as unknown as { __values: Map<string, string> }).__values.get("hlasimse.auth.account.v2") || "null")).toEqual({
    version: 2,
    userId: current.id,
    user: updated,
  });
  expect(await getStoredUser()).toEqual(updated);
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    first_name: "Jana Marie",
    last_name: "Nová",
  });
});

it("does not resurrect account data when logout overlaps a name update", async () => {
  const current = { id: "user-1", email: "jana@example.test", first_name: "Jana", last_name: "Stará", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const updated = { ...current, last_name: "Nová" };
  await setStoredUser(current);
  await bindCurrentSession(current);
  let requestStarted!: () => void;
  const started = new Promise<void>((resolve) => { requestStarted = resolve; });
  let resolveRequest!: (response: Response) => void;
  const pendingResponse = new Promise<Response>((resolve) => { resolveRequest = resolve; });
  jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
    requestStarted();
    return pendingResponse;
  });

  const update = updateAccountName({
    expectedUserId: current.id,
    firstName: current.first_name,
    lastName: updated.last_name,
  });
  await started;
  await clearStoredUserId();
  resolveRequest(json(updated));

  await expect(update).rejects.toThrow("Přihlášený účet se mezitím změnil");
  expect(await getStoredUser()).toBeNull();
  expect(await getStoredUserId()).toBeNull();
});

it("never pairs pending B tokens with cached A after an offline restart", async () => {
  const accountA = { id: "user-a", email: "a@example.test", first_name: "A", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  await setStoredUser(accountA);

  // This is the only durable write completed before a simulated process crash
  // during B login. The v3 envelope deliberately has no cached identity yet.
  await saveTokens({ access: "b-access", refresh: "b-refresh" });
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline after restart"));

  await expect(restoreUser()).resolves.toBeNull();
  expect(await getSessionUser()).toBeNull();
  expect(await getStoredUser()).toEqual(accountA);
  expect(await getTokens()).toEqual({ access: "b-access", refresh: "b-refresh" });
});

it("restores bound B from the atomic envelope when a crash precedes account-cache cleanup", async () => {
  const accountA = { id: "user-a", email: "a@example.test", first_name: "A", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const accountB = { id: "user-b", email: "b@example.test", first_name: "B", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  await setStoredUser(accountA);
  await saveTokens({ access: "b-access", refresh: "b-refresh" });
  await bindCurrentSession(accountB);
  jest.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline after restart"));

  await expect(restoreUser()).resolves.toEqual(accountB);
  expect(await getStoredUser()).toEqual(accountB);
  expect(await getStoredUserId()).toBe("user-b");
});

it("never returns or rewrites cached A when its offline restore fails after B has bound", async () => {
  const accountA = { id: "user-a", email: "a@example.test", first_name: "A", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const accountB = { id: "user-b", email: "b@example.test", first_name: "B", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  await setStoredUser(accountA);
  await bindCurrentSession(accountA);
  let markRestoreStarted!: () => void;
  const restoreStarted = new Promise<void>((resolve) => { markRestoreStarted = resolve; });
  let rejectRestore!: (reason: unknown) => void;
  const delayedRestore = new Promise<Response>((_resolve, reject) => { rejectRestore = reject; });
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/token/")) {
      return json({ access: "b-access", refresh: "b-refresh" });
    }
    if (url.endsWith("/auth/me/")) {
      const authorization = new Headers(init?.headers).get("Authorization");
      if (authorization === "Bearer b-access") return json(accountB);
      markRestoreStarted();
      return delayedRestore;
    }
    return json({}, 404);
  });

  const staleRestore = restoreUser();
  await restoreStarted;
  await expect(login("b@example.test", "long-password-b")).resolves.toEqual(accountB);
  rejectRestore(new TypeError("A went offline after B bound"));

  await expect(staleRestore).resolves.toBeNull();
  expect(await getSessionUser()).toEqual(accountB);
  expect(await getStoredUser()).toEqual(accountB);
  expect(await getStoredUserId()).toBe(accountB.id);
  expect(await getTokens()).toEqual({ access: "b-access", refresh: "b-refresh" });
});

it("does not commit online restore A after a newer explicit B login has started", async () => {
  const accountA = { id: "user-a", email: "a@example.test", first_name: "A", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const accountB = { id: "user-b", email: "b@example.test", first_name: "B", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  await setStoredUser(accountA);
  await bindCurrentSession(accountA);
  let markBTokenRequested!: () => void;
  const bTokenRequested = new Promise<void>((resolve) => { markBTokenRequested = resolve; });
  let resolveBToken!: (response: Response) => void;
  const delayedBToken = new Promise<Response>((resolve) => { resolveBToken = resolve; });
  let loginB: Promise<typeof accountB> | null = null;
  const restoreResponse = new Response(null, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
  jest.spyOn(restoreResponse, "text").mockImplementation(async () => {
    loginB = login(accountB.email, "long-password-b");
    await bTokenRequested;
    return JSON.stringify(accountA);
  });
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/token/")) {
      markBTokenRequested();
      return delayedBToken;
    }
    if (url.endsWith("/auth/me/")) {
      return new Headers(init?.headers).get("Authorization") === "Bearer b-access"
        ? json(accountB)
        : restoreResponse;
    }
    return json({}, 404);
  });

  await expect(restoreUser()).resolves.toBeNull();
  expect(loginB).not.toBeNull();
  resolveBToken(json({ access: "b-access", refresh: "b-refresh" }));
  await expect(loginB!).resolves.toEqual(accountB);

  expect(await getSessionUser()).toEqual(accountB);
  expect(await getStoredUser()).toEqual(accountB);
  expect(await getStoredUserId()).toBe(accountB.id);
  expect(await getTokens()).toEqual({ access: "b-access", refresh: "b-refresh" });
});

it("captures restore generation and A snapshot atomically before a newer B and server error", async () => {
  const accountA = { id: "user-a", email: "a@example.test", first_name: "A", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const accountB = { id: "user-b", email: "b@example.test", first_name: "B", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  await setStoredUser(accountA);
  await bindCurrentSession(accountA);
  const secureStore = SecureStore as unknown as {
    __values: Map<string, string>;
    getItemAsync: jest.Mock;
  };
  let markSnapshotRead!: () => void;
  const snapshotRead = new Promise<void>((resolve) => { markSnapshotRead = resolve; });
  let releaseSnapshotRead!: () => void;
  const snapshotReadRelease = new Promise<void>((resolve) => { releaseSnapshotRead = resolve; });
  let pauseNextSessionRead = true;
  secureStore.getItemAsync.mockImplementation(async (key: string) => {
    if (key === "hlasimse.auth.session.v3" && pauseNextSessionRead) {
      pauseNextSessionRead = false;
      markSnapshotRead();
      await snapshotReadRelease;
    }
    return secureStore.__values.get(key) ?? null;
  });
  let markBTokenRequested!: () => void;
  const bTokenRequested = new Promise<void>((resolve) => { markBTokenRequested = resolve; });
  let resolveBToken!: (response: Response) => void;
  const delayedBToken = new Promise<Response>((resolve) => { resolveBToken = resolve; });
  let markARestoreRequested!: () => void;
  const aRestoreRequested = new Promise<void>((resolve) => { markARestoreRequested = resolve; });
  let resolveARestore!: (response: Response) => void;
  const delayedARestore = new Promise<Response>((resolve) => { resolveARestore = resolve; });
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/token/")) {
      markBTokenRequested();
      return delayedBToken;
    }
    if (url.endsWith("/auth/me/")) {
      if (new Headers(init?.headers).get("Authorization") === "Bearer b-access") return json(accountB);
      markARestoreRequested();
      return delayedARestore;
    }
    return json({}, 404);
  });

  const staleRestore = restoreUser();
  await snapshotRead;
  const loginB = login(accountB.email, "long-password-b");
  await Promise.resolve();
  expect(fetchMock).not.toHaveBeenCalled();
  releaseSnapshotRead();
  await Promise.all([bTokenRequested, aRestoreRequested]);
  resolveBToken(json({ access: "b-access", refresh: "b-refresh" }));
  await expect(loginB).resolves.toEqual(accountB);
  resolveARestore(json({ detail: "server failure for stale A" }, 500));

  await expect(staleRestore).resolves.toBeNull();
  expect(await getSessionUser()).toEqual(accountB);
  expect(await getStoredUser()).toEqual(accountB);
  expect(await getTokens()).toEqual({ access: "b-access", refresh: "b-refresh" });
});

it("cleans the latest refreshed and bound session when restore cannot persist its account cache", async () => {
  const user = { id: "user-1", email: "user@example.test", first_name: "Původní", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" };
  const refreshedUser = { ...user, first_name: "Server" };
  await setStoredUser(user);
  await bindCurrentSession(user);
  const secureStore = SecureStore as unknown as {
    __values: Map<string, string>;
    setItemAsync: jest.Mock;
  };
  const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
    if (key === "hlasimse.auth.account.v2") throw new Error("account cache write failed");
    secureStore.__values.set(key, value);
  });
  jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/token/refresh/")) {
      return json({ access: "restored-access", refresh: "restored-refresh" });
    }
    if (url.endsWith("/auth/me/")) {
      return new Headers(init?.headers).get("Authorization") === "Bearer restored-access"
        ? json(refreshedUser)
        : json({ detail: "expired" }, 401);
    }
    return json({}, 404);
  });

  await expect(restoreUser()).resolves.toBeNull();
  expect(warning).toHaveBeenCalledWith("Failed to commit the bound login session", expect.any(Error));
  expect(await getTokens()).toBeNull();
  expect(await getSessionUser()).toBeNull();
});

it("treats a written session envelope as authoritative when legacy cleanup is interrupted", async () => {
  const secureStore = SecureStore as unknown as {
    __values: Map<string, string>;
    deleteItemAsync: jest.Mock;
  };
  const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  secureStore.deleteItemAsync.mockRejectedValueOnce(new Error("simulated crash after envelope write"));

  await expect(saveTokens({ access: "crash-access", refresh: "crash-refresh" }))
    .resolves.toBeUndefined();
  expect(warning).toHaveBeenCalledWith(
    "Failed to remove legacy auth values after committing session envelope",
    expect.any(Error),
  );
  secureStore.deleteItemAsync.mockImplementation(async (key: string) => { secureStore.__values.delete(key); });
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer crash-access");
    return json({ continued: true });
  });

  expect(await getTokens()).toEqual({ access: "crash-access", refresh: "crash-refresh" });
  await expect(apiRequest<{ continued: boolean }>("/continues-after-cleanup-failure"))
    .resolves.toEqual({ continued: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await getSessionUser()).toBeNull();
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

it("retries logout with the refresh token rotated by expired-access recovery", async () => {
  await setStoredUserId("current-user");
  const logoutBodies: Array<{ refresh: string; installation_id: string }> = [];
  const fetchMock = jest.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/auth/token/refresh/")) {
      expect(JSON.parse(String(init?.body))).toEqual({ refresh: "refresh-1" });
      return json({ access: "fresh-access", refresh: "refresh-2" });
    }
    if (url.endsWith("/auth/logout/")) {
      logoutBodies.push(JSON.parse(String(init?.body)));
      return new Headers(init?.headers).get("Authorization") === "Bearer fresh-access"
        ? new Response(null, { status: 204 })
        : json({ detail: "expired access" }, 401);
    }
    return json({ detail: "unexpected" }, 404);
  });

  await expect(logout()).resolves.toBeUndefined();
  expect(logoutBodies.map((body) => body.refresh)).toEqual(["refresh-1", "refresh-2"]);
  expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/auth/token/refresh/")))
    .toHaveLength(1);
  expect(await getTokens()).toBeNull();
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
