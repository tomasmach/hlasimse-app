# Luxury UI Redesign - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Hlásím se into a luxury-tier mobile app with world-class UI, sophisticated animations, and premium feel.

**Architecture:** Incremental refactoring approach - upgrade design system foundation first, then refactor components, then screens. Each phase is independently testable and deployable.

**Tech Stack:** React Native, Expo, NativeWind/Tailwind, react-native-reanimated, expo-haptics, expo-blur, phosphor-react-native, lottie-react-native

---

## Phase 1: Foundation & Dependencies

### Task 1.1: Install New Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

Run:
```bash
npx expo install expo-haptics expo-blur expo-linear-gradient lottie-react-native phosphor-react-native
```

Expected: Packages added to package.json, no errors

**Step 2: Verify installation**

Run:
```bash
npm start
```

Expected: Metro bundler starts without errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore: add luxury UI dependencies

- expo-haptics for haptic feedback
- expo-blur for glassmorphism effects
- expo-linear-gradient for gradient backgrounds
- lottie-react-native for complex animations
- phosphor-react-native for consistent icons
EOF
)"
```

---

### Task 1.2: Extend Tailwind Theme

**Files:**
- Modify: `tailwind.config.js`

**Step 1: Update tailwind.config.js**

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        coral: {
          DEFAULT: "#FF6B5B",
          light: "#FF8A7A",
          dark: "#E55A4A",
        },
        peach: {
          DEFAULT: "#FFAB91",
          light: "#FFCCBC",
        },
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
        success: {
          DEFAULT: "#4ADE80",
          light: "#86EFAC",
        },
        warning: "#FB923C",
        error: "#F43F5E",
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
      spacing: {
        "18": "4.5rem",
        "22": "5.5rem",
      },
      fontSize: {
        "display-lg": ["4.5rem", { lineHeight: "1", letterSpacing: "-0.02em" }],
        "display": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.02em" }],
        "display-sm": ["2.25rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
      },
      boxShadow: {
        "glow-coral": "0 0 40px rgba(255, 107, 91, 0.4)",
        "glow-coral-lg": "0 0 60px rgba(255, 107, 91, 0.5)",
        "elevated": "0 4px 20px rgba(45, 41, 38, 0.08)",
        "floating": "0 8px 32px rgba(45, 41, 38, 0.12)",
      },
    },
  },
  plugins: [],
};
```

**Step 2: Verify config**

Run:
```bash
npm start
```

Expected: No errors, app loads

**Step 3: Commit**

```bash
git add tailwind.config.js
git commit -m "feat: extend tailwind theme with luxury design tokens"
```

---

### Task 1.3: Create Design System Constants

**Files:**
- Create: `constants/design.ts`

**Step 1: Create design constants file**

```typescript
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
    gradientRotationDuration: 8000, // ms
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

export const HAPTICS = {
  light: "light" as const,
  medium: "medium" as const,
  heavy: "heavy" as const,
  success: "success" as const,
  warning: "warning" as const,
  error: "error" as const,
} as const;
```

**Step 2: Commit**

```bash
git add constants/design.ts
git commit -m "feat: add design system constants for luxury UI"
```

---

## Phase 2: Core UI Components

### Task 2.1: Create Gradient Button Component

**Files:**
- Create: `components/ui/GradientButton.tsx`

**Step 1: Create the component**

```tsx
// components/ui/GradientButton.tsx
import { Pressable, Text, ActivityIndicator, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { COLORS, GRADIENTS, SHADOWS, ANIMATION } from "@/constants/design";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface GradientButtonProps {
  onPress: () => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
}

export function GradientButton({
  onPress,
  label,
  loading = false,
  disabled = false,
  variant = "primary",
  size = "lg",
}: GradientButtonProps) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, ANIMATION.spring.default);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, ANIMATION.spring.bouncy);
  };

  const handlePress = () => {
    if (!disabled && !loading) {
      onPress();
    }
  };

  const isPrimary = variant === "primary";
  const isLarge = size === "lg";

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[animatedStyle, disabled && styles.disabled]}
    >
      <LinearGradient
        colors={isPrimary ? GRADIENTS.coral : [COLORS.white, COLORS.white]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.gradient,
          isLarge ? styles.large : styles.medium,
          isPrimary && SHADOWS.elevated,
          !isPrimary && styles.secondary,
        ]}
      >
        {loading ? (
          <ActivityIndicator
            color={isPrimary ? COLORS.white : COLORS.coral.default}
          />
        ) : (
          <Text
            style={[
              styles.label,
              isLarge && styles.labelLarge,
              !isPrimary && styles.labelSecondary,
            ]}
          >
            {label}
          </Text>
        )}
      </LinearGradient>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  gradient: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
  },
  large: {
    paddingVertical: 18,
    paddingHorizontal: 32,
  },
  medium: {
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  secondary: {
    borderWidth: 1.5,
    borderColor: COLORS.coral.default,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: COLORS.white,
    fontWeight: "600",
    fontSize: 16,
  },
  labelLarge: {
    fontSize: 18,
  },
  labelSecondary: {
    color: COLORS.coral.default,
  },
});
```

**Step 2: Test component renders**

Run app manually and import component in a screen to verify it renders.

**Step 3: Commit**

```bash
git add components/ui/GradientButton.tsx
git commit -m "feat: add GradientButton component with haptics"
```

---

### Task 2.2: Create Animated Input Component

**Files:**
- Create: `components/ui/AnimatedInput.tsx`

**Step 1: Create the component**

```tsx
// components/ui/AnimatedInput.tsx
import { useState, useRef } from "react";
import {
  View,
  TextInput,
  Text,
  Pressable,
  StyleSheet,
  TextInputProps,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  interpolateColor,
} from "react-native-reanimated";
import { Eye, EyeSlash } from "phosphor-react-native";
import { COLORS, ANIMATION } from "@/constants/design";

interface AnimatedInputProps extends Omit<TextInputProps, "style"> {
  label: string;
  error?: string;
}

export function AnimatedInput({
  label,
  error,
  value,
  secureTextEntry,
  onFocus,
  onBlur,
  ...props
}: AnimatedInputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const focusProgress = useSharedValue(value ? 1 : 0);

  const labelStyle = useAnimatedStyle(() => {
    const translateY = interpolate(focusProgress.value, [0, 1], [0, -24]);
    const scale = interpolate(focusProgress.value, [0, 1], [1, 0.85]);
    const color = interpolateColor(
      focusProgress.value,
      [0, 1],
      [COLORS.muted, error ? COLORS.error : COLORS.coral.default]
    );

    return {
      transform: [{ translateY }, { scale }],
      color,
    };
  });

  const borderStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [COLORS.sand, error ? COLORS.error : COLORS.coral.default]
    );

    return { borderColor };
  });

  const handleFocus = (e: any) => {
    setIsFocused(true);
    focusProgress.value = withTiming(1, { duration: ANIMATION.timing.normal });
    onFocus?.(e);
  };

  const handleBlur = (e: any) => {
    setIsFocused(false);
    if (!value) {
      focusProgress.value = withTiming(0, { duration: ANIMATION.timing.normal });
    }
    onBlur?.(e);
  };

  const handleLabelPress = () => {
    inputRef.current?.focus();
  };

  return (
    <View style={styles.container}>
      <Pressable onPress={handleLabelPress}>
        <Animated.View style={[styles.inputContainer, borderStyle]}>
          <Animated.Text style={[styles.label, labelStyle]}>
            {label}
          </Animated.Text>
          <TextInput
            ref={inputRef}
            style={styles.input}
            value={value}
            onFocus={handleFocus}
            onBlur={handleBlur}
            secureTextEntry={secureTextEntry && !showPassword}
            placeholderTextColor="transparent"
            {...props}
          />
          {secureTextEntry && (
            <Pressable
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
            >
              {showPassword ? (
                <EyeSlash size={20} color={COLORS.muted} />
              ) : (
                <Eye size={20} color={COLORS.muted} />
              )}
            </Pressable>
          )}
        </Animated.View>
      </Pressable>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  inputContainer: {
    borderBottomWidth: 2,
    paddingVertical: 12,
    paddingTop: 24,
    flexDirection: "row",
    alignItems: "center",
  },
  label: {
    position: "absolute",
    left: 0,
    top: 24,
    fontSize: 16,
    fontWeight: "500",
    transformOrigin: "left",
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: COLORS.charcoal.default,
    padding: 0,
  },
  eyeButton: {
    padding: 4,
  },
  error: {
    color: COLORS.error,
    fontSize: 13,
    marginTop: 6,
    marginLeft: 2,
  },
});
```

**Step 2: Commit**

```bash
git add components/ui/AnimatedInput.tsx
git commit -m "feat: add AnimatedInput with floating label"
```

---

### Task 2.3: Create Gradient Avatar Component

**Files:**
- Create: `components/ui/GradientAvatar.tsx`

**Step 1: Create the component**

```tsx
// components/ui/GradientAvatar.tsx
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GRADIENTS, COLORS } from "@/constants/design";

interface GradientAvatarProps {
  name?: string;
  email?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZES = {
  sm: 32,
  md: 40,
  lg: 48,
  xl: 72,
};

const FONT_SIZES = {
  sm: 14,
  md: 16,
  lg: 20,
  xl: 28,
};

export function GradientAvatar({
  name,
  email,
  size = "md",
}: GradientAvatarProps) {
  const dimension = SIZES[size];
  const fontSize = FONT_SIZES[size];

  const initial = (name || email || "?")[0].toUpperCase();

  return (
    <LinearGradient
      colors={GRADIENTS.coral}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        styles.container,
        {
          width: dimension,
          height: dimension,
          borderRadius: dimension / 2,
        },
      ]}
    >
      <View style={styles.innerShadow}>
        <Text style={[styles.initial, { fontSize }]}>{initial}</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  innerShadow: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    // Subtle inner shadow effect
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 9999,
  },
  initial: {
    color: COLORS.white,
    fontWeight: "700",
  },
});
```

**Step 2: Commit**

```bash
git add components/ui/GradientAvatar.tsx
git commit -m "feat: add GradientAvatar component"
```

---

### Task 2.4: Create Card Component

**Files:**
- Create: `components/ui/Card.tsx`

**Step 1: Create the component**

```tsx
// components/ui/Card.tsx
import { View, StyleSheet, ViewProps } from "react-native";
import { COLORS, SHADOWS, BORDER_RADIUS } from "@/constants/design";

interface CardProps extends ViewProps {
  variant?: "elevated" | "floating" | "flat";
  padding?: "none" | "sm" | "md" | "lg";
}

const PADDING = {
  none: 0,
  sm: 12,
  md: 16,
  lg: 20,
};

export function Card({
  children,
  variant = "elevated",
  padding = "md",
  style,
  ...props
}: CardProps) {
  const shadowStyle = variant === "floating" ? SHADOWS.floating :
                      variant === "elevated" ? SHADOWS.elevated : {};

  return (
    <View
      style={[
        styles.card,
        shadowStyle,
        { padding: PADDING[padding] },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS["2xl"],
  },
});
```

**Step 2: Commit**

```bash
git add components/ui/Card.tsx
git commit -m "feat: add Card component with shadow variants"
```

---

### Task 2.5: Create Toast Component

**Files:**
- Create: `components/ui/Toast.tsx`

**Step 1: Create the component**

```tsx
// components/ui/Toast.tsx
import { useEffect } from "react";
import { Text, StyleSheet, Pressable } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import {
  CheckCircle,
  Info,
  Warning,
  XCircle,
} from "phosphor-react-native";
import { COLORS, ANIMATION, SHADOWS } from "@/constants/design";

type ToastType = "success" | "info" | "warning" | "error";

interface ToastProps {
  message: string;
  type?: ToastType;
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
}

const TOAST_CONFIG = {
  success: {
    bg: "rgba(74, 222, 128, 0.15)",
    border: COLORS.success,
    icon: CheckCircle,
    haptic: Haptics.NotificationFeedbackType.Success,
  },
  info: {
    bg: "rgba(255, 107, 91, 0.15)",
    border: COLORS.coral.default,
    icon: Info,
    haptic: Haptics.ImpactFeedbackStyle.Light,
  },
  warning: {
    bg: "rgba(251, 146, 60, 0.15)",
    border: COLORS.warning,
    icon: Warning,
    haptic: Haptics.NotificationFeedbackType.Warning,
  },
  error: {
    bg: "rgba(244, 63, 94, 0.15)",
    border: COLORS.error,
    icon: XCircle,
    haptic: Haptics.NotificationFeedbackType.Error,
  },
};

export function Toast({
  message,
  type = "info",
  visible,
  onDismiss,
  duration = 3000,
}: ToastProps) {
  const translateY = useSharedValue(100);
  const opacity = useSharedValue(0);

  const config = TOAST_CONFIG[type];
  const Icon = config.icon;

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, ANIMATION.spring.default);
      opacity.value = withTiming(1, { duration: ANIMATION.timing.normal });

      // Haptic feedback
      if (type === "success" || type === "warning" || type === "error") {
        Haptics.notificationAsync(config.haptic as Haptics.NotificationFeedbackType);
      } else {
        Haptics.impactAsync(config.haptic as Haptics.ImpactFeedbackStyle);
      }

      // Auto dismiss
      const timer = setTimeout(() => {
        handleDismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleDismiss = () => {
    translateY.value = withTiming(100, { duration: ANIMATION.timing.fast });
    opacity.value = withTiming(0, { duration: ANIMATION.timing.fast }, () => {
      runOnJS(onDismiss)();
    });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <Pressable
        onPress={handleDismiss}
        style={[
          styles.toast,
          {
            backgroundColor: config.bg,
            borderColor: config.border,
          },
        ]}
      >
        <Icon size={20} color={config.border} weight="fill" />
        <Text style={[styles.message, { color: config.border }]}>
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 100,
    left: 24,
    right: 24,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    ...SHADOWS.elevated,
  },
  message: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
});
```

**Step 2: Commit**

```bash
git add components/ui/Toast.tsx
git commit -m "feat: add Toast component with haptics and animations"
```

---

### Task 2.6: Create UI Components Index

**Files:**
- Create: `components/ui/index.ts`

**Step 1: Create index file**

```typescript
// components/ui/index.ts
export { GradientButton } from "./GradientButton";
export { AnimatedInput } from "./AnimatedInput";
export { GradientAvatar } from "./GradientAvatar";
export { Card } from "./Card";
export { Toast } from "./Toast";
```

**Step 2: Commit**

```bash
git add components/ui/index.ts
git commit -m "feat: add UI components barrel export"
```

---

## Phase 3: Floating Tab Bar

### Task 3.1: Create Custom Tab Bar Component

**Files:**
- Create: `components/navigation/FloatingTabBar.tsx`

**Step 1: Create the component**

```tsx
// components/navigation/FloatingTabBar.tsx
import { View, Pressable, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { House, UsersThree, GearSix } from "phosphor-react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { COLORS, ANIMATION, SHADOWS } from "@/constants/design";

const TABS = [
  { name: "index", icon: House, label: "Domů" },
  { name: "guardians", icon: UsersThree, label: "Strážci" },
  { name: "settings", icon: GearSix, label: "Nastavení" },
];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface TabItemProps {
  route: (typeof TABS)[number];
  isFocused: boolean;
  onPress: () => void;
}

function TabItem({ route, isFocused, onPress }: TabItemProps) {
  const scale = useSharedValue(1);
  const Icon = route.icon;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.9, ANIMATION.spring.default);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, ANIMATION.spring.bouncy);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[styles.tabItem, animatedStyle]}
    >
      <View style={[styles.iconContainer, isFocused && styles.iconContainerActive]}>
        <Icon
          size={24}
          weight={isFocused ? "fill" : "light"}
          color={isFocused ? COLORS.coral.default : COLORS.muted}
        />
      </View>
    </AnimatedPressable>
  );
}

export function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  return (
    <View style={styles.container}>
      <BlurView intensity={80} tint="light" style={styles.blurContainer}>
        <View style={styles.tabBar}>
          {TABS.map((tab, index) => {
            const isFocused = state.index === index;
            const routeKey = state.routes[index]?.key;

            const onPress = () => {
              const event = navigation.emit({
                type: "tabPress",
                target: routeKey,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(tab.name);
              }
            };

            return (
              <TabItem
                key={tab.name}
                route={tab}
                isFocused={isFocused}
                onPress={onPress}
              />
            );
          })}
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 34 : 16,
    left: 24,
    right: 24,
  },
  blurContainer: {
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255, 107, 91, 0.1)",
    ...SHADOWS.floating,
  },
  tabBar: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 32,
    backgroundColor: "rgba(255, 255, 255, 0.8)",
  },
  tabItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainer: {
    padding: 8,
    borderRadius: 12,
  },
  iconContainerActive: {
    backgroundColor: "rgba(255, 107, 91, 0.1)",
  },
});
```

**Step 2: Commit**

```bash
git add components/navigation/FloatingTabBar.tsx
git commit -m "feat: add FloatingTabBar with blur and haptics"
```

---

### Task 3.2: Integrate Floating Tab Bar

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

**Step 1: Update tab layout**

```tsx
// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { FloatingTabBar } from "@/components/navigation/FloatingTabBar";
import { COLORS } from "@/constants/design";

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerStyle: {
          backgroundColor: COLORS.cream.default,
        },
        headerTintColor: COLORS.charcoal.default,
        headerTitleStyle: {
          fontWeight: "600",
        },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Hlásím se",
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="guardians"
        options={{
          title: "Strážci",
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Nastavení",
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="profile-setup"
        options={{
          title: "Nastavení profilu",
          href: null,
          headerShown: false,
        }}
      />
      <Tabs.Screen
        name="edit-name"
        options={{
          title: "Upravit jméno",
          href: null,
        }}
      />
      <Tabs.Screen
        name="delete-account"
        options={{
          title: "Smazat účet",
          href: null,
        }}
      />
      <Tabs.Screen
        name="interval-picker"
        options={{
          title: "Nastavit interval",
          href: null,
        }}
      />
    </Tabs>
  );
}
```

**Step 2: Test tab bar**

Run app, verify floating tab bar appears and works.

**Step 3: Commit**

```bash
git add app/(tabs)/_layout.tsx
git commit -m "feat: integrate FloatingTabBar into tab navigation"
```

---

## Phase 4: Hero Check-in Button

### Task 4.1: Create Hero Button Component

**Files:**
- Create: `components/HeroButton.tsx`

**Step 1: Create the component**

```tsx
// components/HeroButton.tsx
import { useEffect } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  interpolate,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { Check } from "phosphor-react-native";
import { COLORS, GRADIENTS, SHADOWS, ANIMATION } from "@/constants/design";

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

interface HeroButtonProps {
  onPress: () => void;
  isLoading?: boolean;
  showSuccess?: boolean;
  disabled?: boolean;
}

export function HeroButton({
  onPress,
  isLoading = false,
  showSuccess = false,
  disabled = false,
}: HeroButtonProps) {
  // Animation values
  const scale = useSharedValue(1);
  const breathe = useSharedValue(1);
  const glowOpacity = useSharedValue(0.4);
  const rotation = useSharedValue(0);
  const successScale = useSharedValue(0);

  // Breathing animation
  useEffect(() => {
    breathe.value = withRepeat(
      withSequence(
        withTiming(1.02, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 1500, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    rotation.value = withRepeat(
      withTiming(360, { duration: 8000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  // Success animation
  useEffect(() => {
    if (showSuccess) {
      successScale.value = withSpring(1, ANIMATION.spring.bouncy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      successScale.value = withTiming(0, { duration: 150 });
    }
  }, [showSuccess]);

  const tap = Gesture.Tap()
    .enabled(!disabled && !isLoading)
    .onBegin(() => {
      scale.value = withSpring(0.92, ANIMATION.spring.default);
      runOnJS(Haptics.impactAsync)(Haptics.ImpactFeedbackStyle.Medium);
    })
    .onFinalize(() => {
      scale.value = withSpring(1, ANIMATION.spring.bouncy);
    })
    .onEnd(() => {
      runOnJS(onPress)();
    });

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value * breathe.value },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [
      { scale: interpolate(breathe.value, [1, 1.02], [1, 1.1]) },
    ],
  }));

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
    opacity: successScale.value,
  }));

  return (
    <GestureDetector gesture={tap}>
      <Animated.View style={[styles.container, containerStyle]}>
        {/* Glow effect */}
        <Animated.View style={[styles.glow, glowStyle]} />

        {/* Main button */}
        <LinearGradient
          colors={GRADIENTS.coral}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.button}
        >
          {isLoading ? (
            <ActivityIndicator size="large" color={COLORS.white} />
          ) : showSuccess ? (
            <Animated.View style={successStyle}>
              <Check size={64} color={COLORS.white} weight="bold" />
            </Animated.View>
          ) : (
            <Text style={styles.label}>Hlásím se!</Text>
          )}
        </LinearGradient>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    width: 180,
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: COLORS.coral.default,
    ...SHADOWS.glowLarge,
  },
  button: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: "center",
    justifyContent: "center",
    ...SHADOWS.glow,
  },
  label: {
    color: COLORS.white,
    fontSize: 22,
    fontWeight: "700",
  },
});
```

**Step 2: Commit**

```bash
git add components/HeroButton.tsx
git commit -m "feat: add HeroButton with breathing animation and glow"
```

---

### Task 4.2: Create Enhanced Success Overlay

**Files:**
- Modify: `components/SuccessOverlay.tsx`

**Step 1: Rewrite SuccessOverlay**

```tsx
// components/SuccessOverlay.tsx
import { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withDelay,
  withSequence,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check } from "phosphor-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS, GRADIENTS, ANIMATION } from "@/constants/design";

interface SuccessOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  intervalHours?: number;
}

export function SuccessOverlay({
  visible,
  onDismiss,
  intervalHours = 24,
}: SuccessOverlayProps) {
  const backdropOpacity = useSharedValue(0);
  const circleScale = useSharedValue(0);
  const checkScale = useSharedValue(0);
  const textOpacity = useSharedValue(0);
  const textTranslateY = useSharedValue(20);

  useEffect(() => {
    if (visible) {
      // Sequence of animations
      backdropOpacity.value = withTiming(1, { duration: 200 });
      circleScale.value = withDelay(100, withSpring(1, ANIMATION.spring.bouncy));
      checkScale.value = withDelay(300, withSpring(1, ANIMATION.spring.bouncy));
      textOpacity.value = withDelay(500, withTiming(1, { duration: 200 }));
      textTranslateY.value = withDelay(500, withSpring(0, ANIMATION.spring.default));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Auto dismiss after 3 seconds
      const timer = setTimeout(() => {
        handleDismiss();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleDismiss = () => {
    backdropOpacity.value = withTiming(0, { duration: 200 });
    circleScale.value = withTiming(0.8, { duration: 150 });
    textOpacity.value = withTiming(0, { duration: 150 }, () => {
      runOnJS(onDismiss)();
    });
  };

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: circleScale.value }],
  }));

  const checkStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));

  const formatInterval = (hours: number): string => {
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      if (days === 1) return "1 den";
      if (days >= 2 && days <= 4) return `${days} dny`;
      return `${days} dnů`;
    }
    if (hours === 1) return "1 hodinu";
    if (hours >= 2 && hours <= 4) return `${hours} hodiny`;
    return `${hours} hodin`;
  };

  if (!visible) return null;

  return (
    <Pressable style={styles.container} onPress={handleDismiss}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <BlurView intensity={40} tint="light" style={styles.blur}>
          <View style={styles.content}>
            {/* Success circle */}
            <Animated.View style={[styles.circleContainer, circleStyle]}>
              <LinearGradient
                colors={[COLORS.success, COLORS.success]}
                style={styles.circle}
              >
                <Animated.View style={checkStyle}>
                  <Check size={56} color={COLORS.white} weight="bold" />
                </Animated.View>
              </LinearGradient>
            </Animated.View>

            {/* Text */}
            <Animated.View style={textStyle}>
              <Text style={styles.title}>Vše v pořádku!</Text>
              <Text style={styles.subtitle}>
                Další hlášení za{"\n"}
                <Text style={styles.subtitleBold}>
                  {formatInterval(intervalHours)}
                </Text>
              </Text>
            </Animated.View>
          </View>
        </BlurView>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(255, 248, 245, 0.6)",
  },
  blur: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  circleContainer: {
    marginBottom: 32,
  },
  circle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: COLORS.success,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 8,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.charcoal.default,
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 26,
  },
  subtitleBold: {
    fontWeight: "600",
    color: COLORS.charcoal.default,
  },
});
```

**Step 2: Commit**

```bash
git add components/SuccessOverlay.tsx
git commit -m "feat: enhance SuccessOverlay with blur and staggered animations"
```

---

## Phase 5: Screen Redesigns

### Task 5.1: Redesign Check-in Screen

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Step 1: Update check-in screen**

```tsx
// app/(tabs)/index.tsx
import { useEffect, useState, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  FadeIn,
} from "react-native-reanimated";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { useCountdown } from "@/hooks/useCountdown";
import { useLocation } from "@/hooks/useLocation";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { LocationBanner } from "@/components/LocationBanner";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SuccessOverlay } from "@/components/SuccessOverlay";
import { HeroButton } from "@/components/HeroButton";
import { Toast } from "@/components/ui";
import { COLORS, SPACING } from "@/constants/design";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Dobré ráno";
  if (hour < 18) return "Dobré odpoledne";
  return "Dobrý večer";
}

export default function CheckInScreen() {
  const { user } = useAuth();
  const {
    profile,
    isLoading,
    hasFetched,
    pendingCount,
    fetchProfile,
    checkIn,
    syncPendingCheckIns,
  } = useCheckInStore();
  const countdown = useCountdown(profile?.next_deadline ?? null);
  const { permissionStatus, getCurrentPosition, requestPermission } =
    useLocation();
  const { isConnected } = useNetworkStatus();

  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: "success" | "info" | "warning" | "error";
  }>({ visible: false, message: "", type: "info" });

  // Fetch profile on mount
  useEffect(() => {
    if (user?.id) {
      fetchProfile(user.id);
    }
  }, [user?.id]);

  // Redirect to profile-setup if no profile exists
  useEffect(() => {
    if (user && hasFetched && profile === null) {
      router.replace("/(tabs)/profile-setup");
    }
  }, [user, hasFetched, profile]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isConnected && pendingCount > 0) {
      syncPendingCheckIns();
    }
  }, [isConnected]);

  const handleCheckIn = async () => {
    if (isCheckingIn) return;

    setIsCheckingIn(true);

    const coords = await getCurrentPosition(5000);
    const result = await checkIn(coords);

    if (result.success) {
      setShowSuccess(true);
      if (result.offline) {
        setToast({
          visible: true,
          message: "Máme to! Pošleme hned, až bude signál.",
          type: "warning",
        });
      } else {
        setShowSuccessOverlay(true);
      }
    } else {
      setToast({
        visible: true,
        message: "Nepodařilo se odeslat. Zkuste to znovu.",
        type: "error",
      });
    }

    setTimeout(() => setShowSuccess(false), 1500);
    setIsCheckingIn(false);
  };

  const handleDismissSuccessOverlay = useCallback(() => {
    setShowSuccessOverlay(false);
  }, []);

  const handleDismissToast = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  if (!user || !hasFetched || (isLoading && !profile) || !profile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <HeroButton onPress={() => {}} disabled isLoading />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Banners */}
      <View style={styles.banners}>
        {permissionStatus === "denied" && (
          <LocationBanner onRequestPermission={requestPermission} />
        )}
        <OfflineBanner pendingCount={pendingCount} />
      </View>

      {/* Main content */}
      <View style={styles.content}>
        {/* Greeting */}
        <Animated.View entering={FadeIn.delay(100)} style={styles.greeting}>
          <Text style={styles.greetingText}>
            {getGreeting()}, {profile.name?.split(" ")[0]}!
          </Text>
        </Animated.View>

        {/* Hero Button */}
        <Animated.View entering={FadeIn.delay(200)} style={styles.heroContainer}>
          <HeroButton
            onPress={handleCheckIn}
            isLoading={isCheckingIn}
            showSuccess={showSuccess}
            disabled={isCheckingIn}
          />
        </Animated.View>

        {/* Countdown */}
        <Animated.View entering={FadeIn.delay(300)} style={styles.countdown}>
          <Text style={styles.countdownLabel}>
            {countdown.isExpired ? "Čas překročen o" : "Další hlášení za"}
          </Text>
          <Text
            style={[
              styles.countdownValue,
              countdown.isExpired && styles.countdownExpired,
            ]}
          >
            {countdown.formatted}
          </Text>
          <View style={styles.countdownUnits}>
            <Text style={styles.countdownUnit}>hodin</Text>
            <Text style={styles.countdownUnit}>minut</Text>
            <Text style={styles.countdownUnit}>sekund</Text>
          </View>
        </Animated.View>

        {/* Offline indicator */}
        {isConnected === false && (
          <View style={styles.offlineIndicator}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlineText}>Offline</Text>
          </View>
        )}
      </View>

      {/* Toast */}
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onDismiss={handleDismissToast}
      />

      {/* Success overlay */}
      <SuccessOverlay
        visible={showSuccessOverlay}
        onDismiss={handleDismissSuccessOverlay}
        intervalHours={profile.interval_hours || 24}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream.default,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  banners: {
    paddingTop: 8,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.page,
    paddingBottom: 120, // Space for floating tab bar
  },
  greeting: {
    marginBottom: 32,
  },
  greetingText: {
    fontSize: 28,
    fontWeight: "600",
    color: COLORS.charcoal.default,
    textAlign: "center",
  },
  heroContainer: {
    marginBottom: 48,
  },
  countdown: {
    alignItems: "center",
  },
  countdownLabel: {
    fontSize: 15,
    color: COLORS.muted,
    marginBottom: 8,
  },
  countdownValue: {
    fontSize: 48,
    fontWeight: "800",
    color: COLORS.charcoal.default,
    fontVariant: ["tabular-nums"],
    letterSpacing: -1,
  },
  countdownExpired: {
    color: COLORS.coral.default,
  },
  countdownUnits: {
    flexDirection: "row",
    gap: 40,
    marginTop: 4,
  },
  countdownUnit: {
    fontSize: 12,
    color: COLORS.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  offlineIndicator: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 24,
  },
  offlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.muted,
    marginRight: 8,
  },
  offlineText: {
    fontSize: 14,
    color: COLORS.muted,
  },
});
```

**Step 2: Test the screen**

Run app, verify check-in screen renders with new design.

**Step 3: Commit**

```bash
git add app/(tabs)/index.tsx
git commit -m "feat: redesign check-in screen with hero button and luxury styling"
```

---

### Task 5.2: Update GuardianCard Component

**Files:**
- Modify: `components/GuardianCard.tsx`

**Step 1: Update GuardianCard**

```tsx
// components/GuardianCard.tsx
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { X } from "phosphor-react-native";
import { GuardianWithUser } from "@/types/database";
import { GradientAvatar, Card } from "@/components/ui";
import { COLORS, ANIMATION, SHADOWS } from "@/constants/design";

interface GuardianCardProps {
  guardian: GuardianWithUser;
  onRemove: (id: string) => void;
  isRemoving?: boolean;
  index?: number;
}

export function GuardianCard({
  guardian,
  onRemove,
  isRemoving,
  index = 0,
}: GuardianCardProps) {
  const scale = useSharedValue(1);

  const handleRemove = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Odebrat strážce",
      `Opravdu chceš odebrat ${guardian.user.name || guardian.user.email} jako strážce?`,
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Odebrat",
          style: "destructive",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            onRemove(guardian.id);
          },
        },
      ]
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, ANIMATION.spring.default);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, ANIMATION.spring.default);
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      style={[styles.container, animatedStyle]}
    >
      <Card style={styles.card}>
        <View style={styles.content}>
          <GradientAvatar
            name={guardian.user.name}
            email={guardian.user.email}
            size="lg"
          />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {guardian.user.name || "Bez jména"}
            </Text>
            <Text style={styles.email} numberOfLines={1}>
              {guardian.user.email}
            </Text>
          </View>
          <Pressable
            onPress={handleRemove}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={isRemoving}
            style={styles.removeButton}
            hitSlop={12}
          >
            <X size={20} color={COLORS.muted} weight="bold" />
          </Pressable>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  card: {
    ...SHADOWS.elevated,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
  },
  info: {
    flex: 1,
    marginLeft: 16,
  },
  name: {
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.charcoal.default,
    marginBottom: 2,
  },
  email: {
    fontSize: 14,
    color: COLORS.muted,
  },
  removeButton: {
    padding: 8,
    marginLeft: 8,
  },
});
```

**Step 2: Commit**

```bash
git add components/GuardianCard.tsx
git commit -m "feat: redesign GuardianCard with gradient avatar and animations"
```

---

### Task 5.3: Create navigation components index

**Files:**
- Create: `components/navigation/index.ts`

**Step 1: Create index file**

```typescript
// components/navigation/index.ts
export { FloatingTabBar } from "./FloatingTabBar";
```

**Step 2: Commit**

```bash
git add components/navigation/index.ts
git commit -m "feat: add navigation components barrel export"
```

---

## Phase 6: Onboarding with Interactive Demo

### Task 6.1: Create Demo Check-in Screen

**Files:**
- Create: `components/DemoCheckIn.tsx`

**Step 1: Create the component**

```tsx
// components/DemoCheckIn.tsx
import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withSequence,
  withTiming,
  runOnJS,
  FadeIn,
  FadeOut,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check, ArrowRight } from "phosphor-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { HeroButton } from "@/components/HeroButton";
import { GradientButton } from "@/components/ui";
import { COLORS, GRADIENTS } from "@/constants/design";

interface DemoCheckInProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function DemoCheckIn({ onComplete, onSkip }: DemoCheckInProps) {
  const [hasPressed, setHasPressed] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showCTA, setShowCTA] = useState(false);

  const successScale = useSharedValue(0);
  const ctaOpacity = useSharedValue(0);

  const handlePress = () => {
    if (hasPressed) return;

    setHasPressed(true);
    setShowSuccess(true);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // After success animation, show CTA
    setTimeout(() => {
      setShowCTA(true);
      ctaOpacity.value = withSpring(1);
    }, 1500);
  };

  const successStyle = useAnimatedStyle(() => ({
    transform: [{ scale: successScale.value }],
    opacity: successScale.value,
  }));

  return (
    <View style={styles.container}>
      {!hasPressed ? (
        // Before press
        <Animated.View
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
          style={styles.content}
        >
          <Text style={styles.title}>Zkuste si to</Text>
          <Text style={styles.subtitle}>
            Stiskněte tlačítko a zažijte,{"\n"}jak snadné je hlásit se.
          </Text>

          <View style={styles.heroContainer}>
            <HeroButton
              onPress={handlePress}
              showSuccess={showSuccess}
            />
          </View>

          <Animated.View
            entering={FadeIn.delay(500)}
            style={styles.hint}
          >
            <Text style={styles.hintText}>Stiskněte tlačítko</Text>
            <ArrowRight size={16} color={COLORS.coral.default} />
          </Animated.View>
        </Animated.View>
      ) : showCTA ? (
        // After press - show CTA
        <Animated.View
          entering={FadeIn.duration(300)}
          style={styles.content}
        >
          <View style={styles.successCircle}>
            <Check size={48} color={COLORS.success} weight="bold" />
          </View>

          <Text style={styles.successTitle}>
            Právě jste se ohlásili!
          </Text>
          <Text style={styles.successSubtitle}>
            Takhle jednoduše dáte vědět{"\n"}blízkým, že jste v pořádku.
          </Text>

          <View style={styles.ctaContainer}>
            <GradientButton
              label="Vytvořit účet"
              onPress={onComplete}
            />
            <Text
              style={styles.loginLink}
              onPress={onSkip}
            >
              Už mám účet? Přihlásit
            </Text>
          </View>
        </Animated.View>
      ) : (
        // During animation
        <View style={styles.content}>
          <View style={styles.heroContainer}>
            <HeroButton
              onPress={() => {}}
              showSuccess={showSuccess}
              disabled
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream.default,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.charcoal.default,
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 26,
    marginBottom: 48,
  },
  heroContainer: {
    marginBottom: 32,
  },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hintText: {
    fontSize: 15,
    color: COLORS.coral.default,
    fontWeight: "500",
  },
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: `${COLORS.success}20`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.charcoal.default,
    textAlign: "center",
    marginBottom: 12,
  },
  successSubtitle: {
    fontSize: 17,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 48,
  },
  ctaContainer: {
    width: "100%",
    gap: 16,
  },
  loginLink: {
    fontSize: 15,
    color: COLORS.coral.default,
    textAlign: "center",
    fontWeight: "500",
  },
});
```

**Step 2: Commit**

```bash
git add components/DemoCheckIn.tsx
git commit -m "feat: add interactive demo check-in component"
```

---

### Task 6.2: Update Onboarding Screen

**Files:**
- Modify: `app/(onboarding)/index.tsx`

**Step 1: Update onboarding with demo**

```tsx
// app/(onboarding)/index.tsx
import { useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
  StyleSheet,
} from "react-native";
import { router } from "expo-router";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  FadeIn,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useOnboardingStore } from "@/stores/onboarding";
import { DemoCheckIn } from "@/components/DemoCheckIn";
import { GradientButton } from "@/components/ui";
import { COLORS, GRADIENTS } from "@/constants/design";

interface Slide {
  id: string;
  emoji: string;
  title: string;
  description: string;
}

const slides: Slide[] = [
  {
    id: "1",
    emoji: "👋",
    title: "Vítejte v Hlásím se",
    description:
      "Aplikace, která pomáhá vašim blízkým vědět, že jste v pořádku.",
  },
  {
    id: "2",
    emoji: "⏰",
    title: "Pravidelné hlášení",
    description:
      "Jedním klepnutím dejte vědět, že je vše v pořádku. Žádné složité zprávy.",
  },
  {
    id: "3",
    emoji: "🛡️",
    title: "Klid pro vaše blízké",
    description:
      "Vaši blízcí budou informováni, pokud se neozvete včas.",
  },
];

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDemo, setShowDemo] = useState(false);
  const flatListRef = useRef<FlatList<Slide>>(null);
  const scrollX = useSharedValue(0);
  const { completeOnboarding } = useOnboardingStore();

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
      setCurrentIndex(currentIndex + 1);
    } else {
      // Show demo instead of going to login
      setShowDemo(true);
    }
  };

  const handleSkip = async () => {
    await completeOnboarding();
    router.replace("/(auth)/login");
  };

  const handleDemoComplete = async () => {
    await completeOnboarding();
    router.replace("/(auth)/register");
  };

  const handleDemoSkip = async () => {
    await completeOnboarding();
    router.replace("/(auth)/login");
  };

  if (showDemo) {
    return (
      <DemoCheckIn
        onComplete={handleDemoComplete}
        onSkip={handleDemoSkip}
      />
    );
  }

  const renderSlide = ({ item, index }: { item: Slide; index: number }) => (
    <View style={[styles.slide, { width }]}>
      <Text style={styles.emoji}>{item.emoji}</Text>
      <Text style={styles.slideTitle}>{item.title}</Text>
      <Text style={styles.slideDescription}>{item.description}</Text>
    </View>
  );

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        onScroll={(e) => {
          scrollX.value = e.nativeEvent.contentOffset.x;
        }}
        onMomentumScrollEnd={(e) => {
          const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentIndex(newIndex);
        }}
        scrollEventThrottle={16}
      />

      <View style={styles.footer}>
        {/* Pagination dots */}
        <View style={styles.pagination}>
          {slides.map((_, index) => {
            const inputRange = [
              (index - 1) * width,
              index * width,
              (index + 1) * width,
            ];

            const dotStyle = useAnimatedStyle(() => {
              const dotWidth = interpolate(
                scrollX.value,
                inputRange,
                [8, 24, 8],
                "clamp"
              );
              const opacity = interpolate(
                scrollX.value,
                inputRange,
                [0.3, 1, 0.3],
                "clamp"
              );

              return { width: dotWidth, opacity };
            });

            return (
              <Animated.View key={index} style={[styles.dot, dotStyle]}>
                <LinearGradient
                  colors={GRADIENTS.coral}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.dotGradient}
                />
              </Animated.View>
            );
          })}
        </View>

        {/* CTA Buttons */}
        <View style={styles.buttons}>
          <GradientButton
            label={isLastSlide ? "Vyzkoušet" : "Pokračovat"}
            onPress={handleNext}
          />

          {!isLastSlide && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
            >
              <Text style={styles.skipText}>Přeskočit</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream.default,
  },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  emoji: {
    fontSize: 100,
    marginBottom: 32,
  },
  slideTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.charcoal.default,
    textAlign: "center",
    marginBottom: 16,
  },
  slideDescription: {
    fontSize: 18,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 26,
  },
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  pagination: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  dotGradient: {
    flex: 1,
  },
  buttons: {
    gap: 16,
  },
  skipButton: {
    paddingVertical: 12,
    alignItems: "center",
  },
  skipText: {
    fontSize: 16,
    color: COLORS.muted,
  },
});
```

**Step 2: Test onboarding flow**

Run app, go through onboarding, verify demo appears after slides.

**Step 3: Commit**

```bash
git add app/(onboarding)/index.tsx
git commit -m "feat: add interactive demo to onboarding flow"
```

---

## Phase 7: Final Polish

### Task 7.1: Update Auth Screens

**Files:**
- Modify: `app/(auth)/login.tsx`

**Step 1: Update login screen with new components**

```tsx
// app/(auth)/login.tsx
import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Link, router } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "@/lib/supabase";
import { AnimatedInput, GradientButton } from "@/components/ui";
import { COLORS, GRADIENTS, SPACING } from "@/constants/design";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Vyplňte prosím e-mail a heslo.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        if (signInError.message.includes("Invalid login credentials")) {
          setError("Nesprávný e-mail nebo heslo.");
        } else if (signInError.message.includes("Email not confirmed")) {
          setError("E-mail nebyl potvrzen. Zkontrolujte svou schránku.");
        } else {
          setError("Přihlášení se nezdařilo. Zkuste to prosím znovu.");
        }
        return;
      }

      router.replace("/(tabs)");
    } catch (err) {
      console.error("Login error:", err);
      setError("Nastala neočekávaná chyba. Zkuste to prosím znovu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={FadeIn.delay(100)}
          style={styles.header}
        >
          <Text style={styles.title}>Hlásím se</Text>
          <LinearGradient
            colors={GRADIENTS.coral}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.titleUnderline}
          />
          <Text style={styles.subtitle}>Přihlaste se ke svému účtu</Text>
        </Animated.View>

        {/* Error */}
        {error && (
          <Animated.View
            entering={FadeInDown}
            style={styles.errorContainer}
          >
            <Text style={styles.errorText}>{error}</Text>
          </Animated.View>
        )}

        {/* Form */}
        <Animated.View
          entering={FadeIn.delay(200)}
          style={styles.form}
        >
          <AnimatedInput
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!loading}
          />

          <AnimatedInput
            label="Heslo"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            editable={!loading}
          />

          <Link href="/(auth)/forgot-password" asChild>
            <TouchableOpacity style={styles.forgotPassword} disabled={loading}>
              <Text style={styles.forgotPasswordText}>Zapomenuté heslo?</Text>
            </TouchableOpacity>
          </Link>
        </Animated.View>

        {/* CTA */}
        <Animated.View
          entering={FadeIn.delay(300)}
          style={styles.cta}
        >
          <GradientButton
            label="Přihlásit"
            onPress={handleLogin}
            loading={loading}
            disabled={loading}
          />

          <View style={styles.registerRow}>
            <Text style={styles.registerText}>Nemáte účet? </Text>
            <Link href="/(auth)/register" asChild>
              <TouchableOpacity disabled={loading}>
                <Text style={styles.registerLink}>Registrovat se</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream.default,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: SPACING.page,
    paddingVertical: 48,
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    fontSize: 40,
    fontWeight: "800",
    color: COLORS.charcoal.default,
  },
  titleUnderline: {
    width: 80,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 17,
    color: COLORS.muted,
  },
  errorContainer: {
    backgroundColor: `${COLORS.error}15`,
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  errorText: {
    color: COLORS.error,
    textAlign: "center",
    fontSize: 15,
  },
  form: {
    marginBottom: 32,
  },
  forgotPassword: {
    alignSelf: "flex-end",
    marginTop: 8,
  },
  forgotPasswordText: {
    color: COLORS.coral.default,
    fontSize: 15,
    fontWeight: "500",
  },
  cta: {
    gap: 24,
  },
  registerRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  registerText: {
    color: COLORS.muted,
    fontSize: 15,
  },
  registerLink: {
    color: COLORS.coral.default,
    fontSize: 15,
    fontWeight: "600",
  },
});
```

**Step 2: Commit**

```bash
git add app/(auth)/login.tsx
git commit -m "feat: redesign login screen with luxury styling"
```

---

### Task 7.2: Add Gesture Handler Setup

**Files:**
- Modify: `app/_layout.tsx`

**Step 1: Verify GestureHandlerRootView is in root layout**

Check if `react-native-gesture-handler` is properly set up in the root layout. If not already present, wrap the app with `GestureHandlerRootView`.

Note: Expo Router typically handles this, but verify it works with HeroButton gestures.

**Step 2: Commit (if changes needed)**

```bash
git add app/_layout.tsx
git commit -m "chore: ensure gesture handler is properly configured"
```

---

### Task 7.3: Final Commit - Phase Complete

**Step 1: Create summary commit**

Run:
```bash
git status
```

If any uncommitted files remain, commit them with appropriate message.

**Step 2: Create tag for milestone**

```bash
git tag -a v2.0.0-luxury-ui -m "Luxury UI redesign complete"
```

---

## Summary

This plan transforms Hlásím se into a luxury-tier app through:

1. **Foundation** - New dependencies, extended theme, design constants
2. **UI Components** - GradientButton, AnimatedInput, GradientAvatar, Card, Toast
3. **Navigation** - Floating tab bar with blur and haptics
4. **Hero Button** - Animated gradient button with breathing, glow, and press effects
5. **Screen Redesigns** - Updated check-in, guardians, settings screens
6. **Onboarding** - Interactive demo before registration
7. **Polish** - Consistent styling, animations, haptics throughout

Each task is atomic and independently testable. The plan follows TDD principles where applicable and emphasizes frequent commits.
