export type PauseDurationPreset = "indefinite" | "24h" | "7d";

type PauseScheduleRequest =
  | { paused_until: null }
  | { pause_duration_seconds: 86_400 | 604_800 };

const pauseDurationSeconds: Record<Exclude<PauseDurationPreset, "indefinite">, 86_400 | 604_800> = {
  "24h": 86_400,
  "7d": 604_800,
};

export function pauseRequestForPreset(preset: PauseDurationPreset): PauseScheduleRequest {
  if (preset === "indefinite") return { paused_until: null };
  return { pause_duration_seconds: pauseDurationSeconds[preset] };
}
