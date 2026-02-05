// constants/design.ts
// Luxury UI Design System Constants

export const COLORS = {
  // Primary
  coral: {
    default: "#FF6B5B",
    light: "#FF8A7A",
    dark: "#E55A4A",
  },
  peach: {
    default: "#FFAB91",
    light: "#FFCCBC",
  },
  // Backgrounds
  cream: {
    default: "#FFF8F5",
    dark: "#FFF0EA",
  },
  sand: "#F5E6DC",
  white: "#FFFFFF",
  // Text
  charcoal: {
    default: "#2D2926",
    light: "#4A4543",
  },
  muted: "#8B7F7A",
  // Status
  success: "#4ADE80",
  warning: "#FB923C",
  error: "#F43F5E",
} as const;

export const GRADIENTS = {
  coral: ["#FF6B5B", "#FF8A7A", "#FFAB91"],
  coralAccent: ["#FF6B5B", "#F43F5E"],
  success: ["#4ADE80", "#86EFAC"],
} as const;

export const SHADOWS = {
  elevated: {
    shadowColor: COLORS.charcoal.default,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
  },
  floating: {
    shadowColor: COLORS.charcoal.default,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 8,
  },
  glow: {
    shadowColor: COLORS.coral.default,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 8,
  },
  glowLarge: {
    shadowColor: COLORS.coral.default,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 40,
    elevation: 12,
  },
} as const;

export const ANIMATION = {
  spring: {
    default: { damping: 15, stiffness: 150 },
    bouncy: { damping: 12, stiffness: 180 },
    gentle: { damping: 20, stiffness: 100 },
  },
  timing: {
    fast: 150,
    normal: 200,
    slow: 300,
  },
  heroButton: {
    gradientRotationDuration: 8000,
    glowPulseDuration: 3000,
    breathingDuration: 4000,
  },
} as const;

export const SPACING = {
  page: 24,
  section: 32,
  card: 20,
  cardLarge: 24,
} as const;

export const BORDER_RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  full: 9999,
} as const;