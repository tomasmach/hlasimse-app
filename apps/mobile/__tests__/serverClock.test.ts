import { calculateTimeRemaining } from "@/hooks/useCountdown";
import {
  calibrateServerClock,
  getServerClockState,
  observeServerTimeHeader,
  resetServerClockForTests,
  serverNowMs,
} from "@/lib/serverClock";

afterEach(() => resetServerClockForTests());

it("calibrates server time even when the device clock is 24 hours ahead", () => {
  const deviceNow = Date.parse("2026-07-22T12:00:00.000Z");
  const serverNow = Date.parse("2026-07-21T12:00:00.000Z");

  expect(
    calibrateServerClock(
      new Date(serverNow).toISOString(),
      deviceNow - 100,
      deviceNow + 100,
      { requestStartedMonotonicMs: 1_000, responseReceivedMonotonicMs: 1_200 },
    ),
  ).toBe(true);
  expect(serverNowMs(deviceNow, 1_200)).toBe(serverNow);
  expect(getServerClockState(1_200)).toMatchObject({ calibrated: true, uncertaintyMs: 100 });
});

it("keeps advancing monotonically after the device wall clock changes", () => {
  const deviceNow = Date.parse("2026-07-21T12:00:00.000Z");
  const serverNow = Date.parse("2026-07-21T12:00:00.000Z");
  calibrateServerClock(
    new Date(serverNow).toISOString(),
    deviceNow,
    deviceNow + 100,
    { requestStartedMonotonicMs: 5_000, responseReceivedMonotonicMs: 5_100 },
  );

  expect(serverNowMs(deviceNow + 24 * 60 * 60 * 1000, 6_100)).toBe(serverNow + 1_000);
});

it("expires a stale clock sample instead of presenting it as verified", () => {
  const now = Date.parse("2026-07-21T12:00:00.000Z");
  calibrateServerClock(
    new Date(now).toISOString(),
    now,
    now,
    { requestStartedMonotonicMs: 10, responseReceivedMonotonicMs: 10 },
  );

  expect(serverNowMs(now, 60 * 60 * 1000 + 11)).toBeNull();
});

it("rejects a server-time header replayed by an HTTP cache", () => {
  const response = new Response(null, {
    headers: {
      "X-Hlasimse-Server-Time": "2026-07-21T12:00:00.000Z",
      Age: "30",
    },
  });

  expect(observeServerTimeHeader(response, 100, 200)).toBe(false);
  expect(getServerClockState()).toMatchObject({ calibrated: false });
});

it("refuses to claim an expiry state before any server clock sample", () => {
  const result = calculateTimeRemaining("2026-07-21T13:00:00.000Z", null);

  expect(result).toMatchObject({
    formatted: "--:--:--",
    isExpired: false,
    isTimeVerified: false,
  });
});

it("calculates a deadline from the supplied server-authoritative time", () => {
  const result = calculateTimeRemaining(
    "2026-07-21T13:01:02.000Z",
    Date.parse("2026-07-21T12:00:00.000Z"),
  );

  expect(result).toMatchObject({
    formatted: "01:01:02",
    isExpired: false,
    isTimeVerified: true,
  });
});
