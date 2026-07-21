import { serverNowMs } from "@/lib/serverClock";

export type PauseDurationPreset = "indefinite" | "24h" | "7d" | "custom";

export type PauseScheduleRequest =
  | { paused_until: null }
  | { pause_duration_seconds: 86_400 | 604_800 }
  | { paused_until: string };

export const MAX_CUSTOM_PAUSE_MS = 366 * 24 * 60 * 60 * 1000;
export const DEFAULT_CUSTOM_PAUSE_MS = 36 * 60 * 60 * 1000;

export type CustomPausePickerMode = "date" | "time" | "datetime";

const pauseDurationSeconds: Record<Exclude<PauseDurationPreset, "indefinite" | "custom">, 86_400 | 604_800> = {
  "24h": 86_400,
  "7d": 604_800,
};

export function initialCustomPauseEnd(nowMs: number = serverNowMs() ?? Date.now()): Date {
  const value = new Date(nowMs + DEFAULT_CUSTOM_PAUSE_MS);
  value.setSeconds(0, 0);
  return value;
}

export function mergeCustomPauseSelection(
  current: Date,
  selected: Date,
  mode: CustomPausePickerMode,
): Date {
  const next = new Date(current);
  if (mode === "date" || mode === "datetime") {
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  }
  if (mode === "time" || mode === "datetime") {
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  }
  return next;
}

export function pauseRequestForPreset(
  preset: PauseDurationPreset,
  customPausedUntil?: Date,
  nowMs: number | null = serverNowMs(),
): PauseScheduleRequest {
  if (preset === "indefinite") return { paused_until: null };
  if (preset === "custom") {
    if (nowMs === null || !Number.isFinite(nowMs)) {
      throw new Error("Čas serveru není čerstvě ověřený. Připojte se a načtěte profil znovu.");
    }
    const pausedUntilMs = customPausedUntil?.getTime() ?? Number.NaN;
    if (!Number.isFinite(pausedUntilMs) || pausedUntilMs <= nowMs) {
      throw new Error("Konec pauzy musí být v budoucnosti.");
    }
    if (pausedUntilMs > nowMs + MAX_CUSTOM_PAUSE_MS) {
      throw new Error("Konec pauzy může být nejvýše 366 dní od serverového času.");
    }
    return { paused_until: new Date(pausedUntilMs).toISOString() };
  }
  return { pause_duration_seconds: pauseDurationSeconds[preset] };
}
