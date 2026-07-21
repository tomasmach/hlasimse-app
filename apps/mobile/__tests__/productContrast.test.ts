import { ACTION_PALETTE } from "@/constants/productDesign";

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

it.each(Object.entries(ACTION_PALETTE))("keeps %s button text at WCAG AA contrast", (_name, colors) => {
  expect(contrast(colors.fg, colors.bg)).toBeGreaterThanOrEqual(4.5);
});
