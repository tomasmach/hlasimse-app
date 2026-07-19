export const colors = {
  coral: {
    DEFAULT: "#FF6B5B",
    light: "#FF8A7A",
    dark: "#E55A4A",
  },
  peach: "#FFAB91",
  cream: {
    DEFAULT: "#FFF8F5",
    dark: "#FFF0EA",
  },
  sand: "#F5E6DC",
  charcoal: {
    DEFAULT: "#2D2926",
    light: "#4A4543",
  },
  muted: "#8B7F7A",
  white: "#FFFFFF",
  success: "#4ADE80",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 48,
  "3xl": 64,
  "4xl": 96,
  "5xl": 128,
} as const;

export const borderRadius = {
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  "2xl": 40,
  full: 9999,
} as const;
