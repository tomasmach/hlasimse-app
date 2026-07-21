const MAX_ROUND_TRIP_MS = 10_000;
const MAX_SAMPLE_AGE_MS = 60 * 60 * 1000;

let estimatedServerAtSampleMs: number | null = null;
let monotonicAtSampleMs: number | null = null;
let offsetMs: number | null = null;
let uncertaintyMs: number | null = null;

export interface ServerClockState {
  calibrated: boolean;
  offsetMs: number | null;
  uncertaintyMs: number | null;
  sampleAgeMs: number | null;
}

export interface MonotonicRequestTiming {
  requestStartedMonotonicMs: number;
  responseReceivedMonotonicMs: number;
}

export function monotonicNowMs(): number | null {
  const value = globalThis.performance?.now();
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function calibrateServerClock(
  serverTimestamp: string | null,
  requestStartedAtMs: number,
  responseReceivedAtMs: number,
  timing?: MonotonicRequestTiming,
): boolean {
  if (!serverTimestamp) return false;
  const serverMs = new Date(serverTimestamp).getTime();
  const fallbackRoundTripMs = responseReceivedAtMs - requestStartedAtMs;
  const sampleMonotonicMs = timing?.responseReceivedMonotonicMs ?? monotonicNowMs();
  const roundTripMs = timing
    ? timing.responseReceivedMonotonicMs - timing.requestStartedMonotonicMs
    : fallbackRoundTripMs;
  if (
    !Number.isFinite(serverMs) ||
    sampleMonotonicMs === null ||
    !Number.isFinite(roundTripMs) ||
    roundTripMs < 0 ||
    roundTripMs > MAX_ROUND_TRIP_MS
  ) {
    return false;
  }

  // Django generates the header after the view has completed, immediately
  // before the response is returned. Anchor to that sample without letting a
  // later wall-clock change affect it; transport delay remains uncertainty.
  estimatedServerAtSampleMs = serverMs;
  monotonicAtSampleMs = sampleMonotonicMs;
  offsetMs = estimatedServerAtSampleMs - responseReceivedAtMs;
  uncertaintyMs = roundTripMs / 2;
  return true;
}

export function observeServerTimeHeader(
  response: Response,
  requestStartedAtMs: number,
  responseReceivedAtMs: number,
  timing?: MonotonicRequestTiming,
): boolean {
  if (response.headers.get("Age")) return false;
  return calibrateServerClock(
    response.headers.get("X-Hlasimse-Server-Time"),
    requestStartedAtMs,
    responseReceivedAtMs,
    timing,
  );
}

export function serverNowMs(
  _localNowMs = Date.now(),
  currentMonotonicMs = monotonicNowMs(),
): number | null {
  if (
    estimatedServerAtSampleMs === null ||
    monotonicAtSampleMs === null ||
    currentMonotonicMs === null
  ) {
    return null;
  }
  const sampleAgeMs = currentMonotonicMs - monotonicAtSampleMs;
  if (sampleAgeMs < 0 || sampleAgeMs > MAX_SAMPLE_AGE_MS) return null;
  return estimatedServerAtSampleMs + sampleAgeMs;
}

export function getServerClockState(currentMonotonicMs = monotonicNowMs()): ServerClockState {
  const sampleAgeMs = monotonicAtSampleMs === null || currentMonotonicMs === null
    ? null
    : currentMonotonicMs - monotonicAtSampleMs;
  return {
    calibrated: serverNowMs(undefined, currentMonotonicMs) !== null,
    offsetMs,
    uncertaintyMs,
    sampleAgeMs,
  };
}

export function resetServerClockForTests(): void {
  estimatedServerAtSampleMs = null;
  monotonicAtSampleMs = null;
  offsetMs = null;
  uncertaintyMs = null;
}
