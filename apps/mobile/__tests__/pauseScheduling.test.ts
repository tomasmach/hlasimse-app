import { pauseRequestForPreset } from "@/lib/pauseScheduling";

it("keeps an indefinite pause without a scheduled end", () => {
  expect(pauseRequestForPreset("indefinite")).toEqual({ paused_until: null });
});

it.each([
  ["24h" as const, 86_400],
  ["7d" as const, 604_800],
])("sends a server-computed duration for %s", (preset, expected) => {
  expect(pauseRequestForPreset(preset)).toEqual({ pause_duration_seconds: expected });
});
