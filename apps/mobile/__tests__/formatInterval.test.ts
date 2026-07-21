import { formatInterval } from "@/utils/formatInterval";

it("preserves minute-precise intervals instead of rounding down", () => {
  expect(formatInterval(61 / 60)).toBe("61 minut");
  expect(formatInterval(90 / 60)).toBe("90 minut");
  expect(formatInterval(1)).toBe("1 hodinu");
  expect(formatInterval(24)).toBe("1 den");
  expect(formatInterval(168)).toBe("7 dnů");
});
