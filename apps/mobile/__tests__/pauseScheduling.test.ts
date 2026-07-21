import {
  DEFAULT_CUSTOM_PAUSE_MS,
  initialCustomPauseEnd,
  mergeCustomPauseSelection,
  pauseRequestForPreset,
} from "@/lib/pauseScheduling";
import { calibrateServerClock, resetServerClockForTests } from "@/lib/serverClock";

afterEach(() => {
  resetServerClockForTests();
  jest.restoreAllMocks();
});

it("keeps an indefinite pause without a scheduled end", () => {
  expect(pauseRequestForPreset("indefinite")).toEqual({ paused_until: null });
});

it.each([
  ["24h" as const, 86_400],
  ["7d" as const, 604_800],
])("sends a server-computed duration for %s", (preset, expected) => {
  expect(pauseRequestForPreset(preset)).toEqual({ pause_duration_seconds: expected });
});

it("sends an exact ISO timestamp for a custom future end", () => {
  const now = Date.parse("2026-07-21T10:00:00.000Z");
  const future = new Date("2026-07-23T18:30:00.000Z");
  expect(pauseRequestForPreset("custom", future, now)).toEqual({
    paused_until: "2026-07-23T18:30:00.000Z",
  });
});

it("starts custom pause at a distinct 36-hour instant instead of the 24-hour preset", () => {
  const now = Date.parse("2026-07-21T10:15:42.999Z");
  expect(initialCustomPauseEnd(now)).toEqual(new Date("2026-07-22T22:15:00.000Z"));
  expect(initialCustomPauseEnd(now).getTime() - now).toBe(DEFAULT_CUSTOM_PAUSE_MS - 42_999);
});

it.each([
  ["date" as const, "2026-08-04T18:45:00.000Z"],
  ["time" as const, "2026-07-21T07:30:00.000Z"],
  ["datetime" as const, "2026-08-04T07:30:00.000Z"],
])("merges the native %s picker callback into the custom instant", (mode, expected) => {
  const current = new Date("2026-07-21T18:45:00.000Z");
  const selected = new Date("2026-08-04T07:30:23.456Z");
  expect(mergeCustomPauseSelection(current, selected, mode)).toEqual(new Date(expected));
  expect(current).toEqual(new Date("2026-07-21T18:45:00.000Z"));
});

it.each([
  new Date("2026-07-21T09:59:59.999Z"),
  new Date("2026-07-21T10:00:00.000Z"),
  new Date(Number.NaN),
])("rejects a non-future custom end before making a profile mutation", (value) => {
  expect(() => pauseRequestForPreset("custom", value, Date.parse("2026-07-21T10:00:00.000Z")))
    .toThrow("Konec pauzy musí být v budoucnosti.");
});

it("requires a fresh trusted server clock for custom confirmation", () => {
  resetServerClockForTests();
  expect(() => pauseRequestForPreset("custom", new Date(Date.now() + 86_400_000)))
    .toThrow("Čas serveru není čerstvě ověřený");
});

it("uses server time when the device wall clock is 24 hours ahead", () => {
  jest.spyOn(globalThis.performance, "now").mockReturnValue(1_000);
  const serverNow = Date.parse("2026-07-21T10:00:00.000Z");
  expect(calibrateServerClock(
    new Date(serverNow).toISOString(),
    serverNow + 86_400_000,
    serverNow + 86_400_100,
    { requestStartedMonotonicMs: 900, responseReceivedMonotonicMs: 1_000 },
  )).toBe(true);

  expect(pauseRequestForPreset("custom", new Date(serverNow + 3_600_000))).toEqual({
    paused_until: "2026-07-21T11:00:00.000Z",
  });
});

it("rejects a time already past on the server when the device wall clock is 24 hours behind", () => {
  jest.spyOn(globalThis.performance, "now").mockReturnValue(2_000);
  const serverNow = Date.parse("2026-07-21T10:00:00.000Z");
  expect(calibrateServerClock(
    new Date(serverNow).toISOString(),
    serverNow - 86_400_000,
    serverNow - 86_399_900,
    { requestStartedMonotonicMs: 1_900, responseReceivedMonotonicMs: 2_000 },
  )).toBe(true);

  expect(() => pauseRequestForPreset("custom", new Date(serverNow - 1)))
    .toThrow("Konec pauzy musí být v budoucnosti.");
});

it("enforces the 366-day server horizon", () => {
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  expect(pauseRequestForPreset("custom", new Date(now + 366 * 86_400_000), now)).toEqual({
    paused_until: "2027-01-02T00:00:00.000Z",
  });
  expect(() => pauseRequestForPreset("custom", new Date(now + 366 * 86_400_000 + 1), now))
    .toThrow("nejvýše 366 dní");
});

it("serializes a Czech DST-overlap choice as an unambiguous instant", () => {
  const now = Date.parse("2026-10-24T00:00:00.000Z");
  const firstOccurrence = new Date("2026-10-25T02:30:00+02:00");
  const secondOccurrence = new Date("2026-10-25T02:30:00+01:00");
  expect(pauseRequestForPreset("custom", firstOccurrence, now)).toEqual({
    paused_until: "2026-10-25T00:30:00.000Z",
  });
  expect(pauseRequestForPreset("custom", secondOccurrence, now)).toEqual({
    paused_until: "2026-10-25T01:30:00.000Z",
  });
});
