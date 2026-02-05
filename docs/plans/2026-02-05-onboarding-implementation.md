# Onboarding Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the existing 3-slide onboarding with a 5-screen personalized flow: Ask about problems → Empathy → Solution → Wow moment → Sign up.

**Architecture:** Multi-screen onboarding using Expo Router file-based routing within the `(onboarding)` group. Persona selection stored in Zustand + AsyncStorage. Each screen is a separate route. Shared ProgressDots component and persona-specific content data maps drive personalization.

**Tech Stack:** Expo Router, Zustand, React Native Reanimated, NativeWind, Phosphor Icons, expo-haptics, expo-blur

---

### Task 1: Update Onboarding Store with Persona Support

**Files:**
- Modify: `stores/onboarding.ts`

**Step 1: Add persona type and update store**

Replace the entire file:

```typescript
import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "hasSeenOnboarding";
const PERSONA_KEY = "onboardingPersona";

export type Persona = "alone" | "caregiver" | "traveler";

interface OnboardingState {
  hasSeenOnboarding: boolean | null;
  isLoading: boolean;
  selectedPersona: Persona | null;
  checkOnboardingStatus: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
  setPersona: (persona: Persona) => Promise<void>;
  loadPersona: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  hasSeenOnboarding: null,
  isLoading: true,
  selectedPersona: null,
  checkOnboardingStatus: async () => {
    try {
      set({ isLoading: true });
      const value = await AsyncStorage.getItem(STORAGE_KEY);
      set({ hasSeenOnboarding: value === "true", isLoading: false });
    } catch (error) {
      console.error("Error checking onboarding status:", error);
      set({ hasSeenOnboarding: false, isLoading: false });
    }
  },
  completeOnboarding: async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, "true");
      set({ hasSeenOnboarding: true });
    } catch (error) {
      console.error("Error saving onboarding status:", error);
    }
  },
  resetOnboarding: async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      await AsyncStorage.removeItem(PERSONA_KEY);
      set({ hasSeenOnboarding: false, isLoading: false, selectedPersona: null });
    } catch (error) {
      console.error("Error resetting onboarding:", error);
    }
  },
  setPersona: async (persona: Persona) => {
    try {
      await AsyncStorage.setItem(PERSONA_KEY, persona);
      set({ selectedPersona: persona });
    } catch (error) {
      console.error("Error saving persona:", error);
    }
  },
  loadPersona: async () => {
    try {
      const value = await AsyncStorage.getItem(PERSONA_KEY);
      if (value) {
        set({ selectedPersona: value as Persona });
      }
    } catch (error) {
      console.error("Error loading persona:", error);
    }
  },
}));
```

**Step 2: Verify the app still builds**

Run: `npx expo start --clear` (check for TS errors)

**Step 3: Commit**

```bash
git add stores/onboarding.ts
git commit -m "feat: add persona support to onboarding store"
```

---

### Task 2: Create Persona Content Data

**Files:**
- Create: `constants/onboarding.ts`

**Step 1: Create the persona content data file**

```typescript
import {
  Person,
  UsersThree,
  Compass,
  Clock,
  HandTap,
  Bell,
  UserPlus,
  CheckCircle,
  Warning,
  MapPin,
  Timer,
  ShieldCheck,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import type { Persona } from "@/stores/onboarding";

// Screen 1: Persona selection cards
export interface PersonaCard {
  id: Persona;
  icon: PhosphorIcon;
  title: string;
  description: string;
}

export const PERSONA_CARDS: PersonaCard[] = [
  {
    id: "alone",
    icon: Person,
    title: "Bydlím sám/sama",
    description: "Chci, aby o mně někdo věděl",
  },
  {
    id: "caregiver",
    icon: UsersThree,
    title: "Starám se o blízkého",
    description: "Chci mít jistotu, že je v pořádku",
  },
  {
    id: "traveler",
    icon: Compass,
    title: "Cestuji sám/sama",
    description: "Chci pojistku pro případ nouze",
  },
];

// Screen 2: Empathy messages
export const EMPATHY_CONTENT: Record<Persona, string> = {
  alone:
    "Když žijete sami, občas vás napadne: co kdyby se mi něco stalo a nikdo by nevěděl? Ten pocit znáte. A právě proto existujeme.",
  caregiver:
    "Máte svůj život, ale v hlavě pořád myšlenku: je maminka v pořádku? Chcete mít jistotu, aniž byste museli neustále volat.",
  traveler:
    "Milujete svobodu cestování, ale vaši blízcí se bojí. Nechcete se omezovat, ale chcete, aby věděli, že jste OK.",
};

// Screen 3: Solution timeline steps
export interface TimelineStep {
  icon: PhosphorIcon;
  title: string;
  description: string;
}

export const SOLUTION_STEPS: Record<Persona, TimelineStep[]> = {
  alone: [
    {
      icon: Clock,
      title: "Nastavíte si jak často se chcete hlásit",
      description: "Jednou denně, dvakrát, jak potřebujete.",
    },
    {
      icon: HandTap,
      title: "Jedním klepnutím řeknete: jsem OK",
      description: "Zabere to dvě sekundy.",
    },
    {
      icon: Bell,
      title: "Když se neohlásíte, vaši blízcí se dozví",
      description: "Automaticky a spolehlivě.",
    },
  ],
  caregiver: [
    {
      icon: UserPlus,
      title: "Pozvete svého blízkého do appky",
      description: "Stačí zadat email.",
    },
    {
      icon: CheckCircle,
      title: "Dostanete pravidelné potvrzení, že je OK",
      description: "Bez otravného volání.",
    },
    {
      icon: Warning,
      title: "Pokud se neozve, okamžitě se dozvíte",
      description: "Notifikace přímo na váš telefon.",
    },
  ],
  traveler: [
    {
      icon: MapPin,
      title: "Při hlášení se uloží vaše poloha",
      description:
        "Kdyby bylo potřeba, vaši blízcí uvidí kde jste byli naposledy.",
    },
    {
      icon: Timer,
      title: "Nastavíte interval podle plánu cesty",
      description: "Flexibilní podle potřeby.",
    },
    {
      icon: ShieldCheck,
      title: "Když se neozvete, spustí se alarm",
      description: "Vaši blízcí budou vědět.",
    },
  ],
};

// Screen 4: Notification messages for wow moment
export const NOTIFICATION_MESSAGE: Record<Persona, string> = {
  alone: "Váš blízký se právě ohlásil. Vše je v pořádku.",
  caregiver: "Maminka se právě ohlásila. Vše je v pořádku.",
  traveler: "Váš cestovatel se právě ohlásil. Vše je v pořádku.",
};
```

**Step 2: Commit**

```bash
git add constants/onboarding.ts
git commit -m "feat: add persona-specific onboarding content data"
```

---

### Task 3: Create ProgressDots Component

**Files:**
- Create: `components/onboarding/ProgressDots.tsx`

**Step 1: Create the shared progress dots component**

```typescript
import { View, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { COLORS, ANIMATION } from "@/constants/design";

const TOTAL_STEPS = 5;
const DOT_SIZE = 8;
const DOT_ACTIVE_WIDTH = 24;

interface ProgressDotsProps {
  currentStep: number;
}

function Dot({ isActive }: { isActive: boolean }) {
  const animatedStyle = useAnimatedStyle(() => ({
    width: withTiming(isActive ? DOT_ACTIVE_WIDTH : DOT_SIZE, {
      duration: ANIMATION.timing.normal,
    }),
    opacity: withTiming(isActive ? 1 : 0.3, {
      duration: ANIMATION.timing.normal,
    }),
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        animatedStyle,
        { backgroundColor: COLORS.coral.default },
      ]}
    />
  );
}

export function ProgressDots({ currentStep }: ProgressDotsProps) {
  return (
    <View className="flex-row justify-center items-center gap-2 pt-16 pb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <Dot key={i} isActive={i === currentStep} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
});
```

**Step 2: Commit**

```bash
git add components/onboarding/ProgressDots.tsx
git commit -m "feat: add ProgressDots component for onboarding"
```

---

### Task 4: Create Screen 1 — Persona Selection

**Files:**
- Modify: `app/(onboarding)/index.tsx` (complete rewrite)

**Step 1: Replace onboarding index with persona selection screen**

Replace the entire file:

```typescript
import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useOnboardingStore } from "@/stores/onboarding";
import { PERSONA_CARDS, type PersonaCard } from "@/constants/onboarding";
import type { Persona } from "@/stores/onboarding";
import { COLORS, ANIMATION, SHADOWS } from "@/constants/design";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function PersonaCardItem({
  card,
  isSelected,
  onSelect,
  index,
}: {
  card: PersonaCard;
  isSelected: boolean;
  onSelect: (id: Persona) => void;
  index: number;
}) {
  const Icon = card.icon;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withSpring(isSelected ? 1.02 : 1, ANIMATION.spring.default),
      },
    ],
    borderColor: withTiming(
      isSelected ? COLORS.coral.default : "transparent",
      { duration: ANIMATION.timing.normal }
    ),
    backgroundColor: withTiming(
      isSelected ? COLORS.cream.dark : COLORS.white,
      { duration: ANIMATION.timing.normal }
    ),
  }));

  return (
    <AnimatedPressable
      onPress={() => onSelect(card.id)}
      style={[styles.card, animatedStyle, SHADOWS.elevated]}
    >
      <Animated.View entering={FadeInDown.delay(200 + index * 100).duration(400)}>
        <View className="flex-row items-center gap-4">
          <View style={styles.iconCircle}>
            <Icon size={28} color={COLORS.coral.default} weight="regular" />
          </View>
          <View className="flex-1">
            <Text className="text-lg font-semibold text-charcoal">
              {card.title}
            </Text>
            <Text className="text-sm text-muted mt-0.5">
              {card.description}
            </Text>
          </View>
        </View>
      </Animated.View>
    </AnimatedPressable>
  );
}

export default function PersonaSelectionScreen() {
  const [selected, setSelected] = useState<Persona | null>(null);
  const { setPersona } = useOnboardingStore();

  const handleSelect = async (persona: Persona) => {
    if (selected) return; // prevent double-tap
    setSelected(persona);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setPersona(persona);
    setTimeout(() => {
      router.push("/(onboarding)/empathy");
    }, 400);
  };

  return (
    <View className="flex-1 bg-cream">
      <ProgressDots currentStep={0} />

      <View className="flex-1 px-6 justify-center">
        <Animated.View entering={FadeInDown.duration(500)}>
          <Text className="text-3xl font-semibold text-charcoal text-center mb-2">
            Co vás přivedlo?
          </Text>
          <Text className="text-base text-muted text-center mb-10">
            Díky tomu vám ukážeme, jak vám pomůžeme
          </Text>
        </Animated.View>

        <View className="gap-4">
          {PERSONA_CARDS.map((card, index) => (
            <PersonaCardItem
              key={card.id}
              card={card}
              isSelected={selected === card.id}
              onSelect={handleSelect}
              index={index}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 24,
    borderWidth: 2,
    padding: 20,
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.cream.dark,
    alignItems: "center",
    justifyContent: "center",
  },
});
```

**Step 2: Verify it renders**

Run: `npx expo start`, navigate to onboarding, tap a card.

**Step 3: Commit**

```bash
git add app/(onboarding)/index.tsx
git commit -m "feat: add persona selection screen for onboarding"
```

---

### Task 5: Create Screen 2 — Empathy Screen

**Files:**
- Create: `app/(onboarding)/empathy.tsx`

**Step 1: Create the empathy screen with word-by-word animation**

```typescript
import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { HeartHalf } from "phosphor-react-native";
import { useOnboardingStore } from "@/stores/onboarding";
import { EMPATHY_CONTENT } from "@/constants/onboarding";
import { COLORS } from "@/constants/design";
import { GradientButton } from "@/components/ui";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

function AnimatedWords({ text, delayMs = 30 }: { text: string; delayMs?: number }) {
  const words = text.split(" ");
  return (
    <View className="flex-row flex-wrap justify-center">
      {words.map((word, i) => (
        <Animated.Text
          key={i}
          entering={FadeIn.delay(300 + i * delayMs).duration(300)}
          className="text-xl text-charcoal-light leading-8"
        >
          {word}{" "}
        </Animated.Text>
      ))}
    </View>
  );
}

export default function EmpathyScreen() {
  const { selectedPersona, loadPersona } = useOnboardingStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (!selectedPersona) await loadPersona();
      setReady(true);
    };
    init();
  }, [selectedPersona, loadPersona]);

  if (!ready || !selectedPersona) return null;

  const content = EMPATHY_CONTENT[selectedPersona];

  return (
    <View className="flex-1 bg-cream">
      <ProgressDots currentStep={1} />

      <View className="flex-1 px-8 justify-center items-center">
        <Animated.View entering={FadeInDown.duration(600)}>
          <Text className="text-3xl font-semibold text-charcoal text-center mb-8">
            Víme, jaké to je
          </Text>
        </Animated.View>

        <View className="mb-10 px-2">
          <AnimatedWords text={content} />
        </View>

        <Animated.View entering={FadeIn.delay(content.split(" ").length * 30 + 600).duration(500)}>
          <HeartHalf size={64} color={COLORS.coral.default} weight="regular" />
        </Animated.View>
      </View>

      <View className="px-8 pb-12">
        <GradientButton
          label="Jak to funguje?"
          onPress={() => router.push("/(onboarding)/solution")}
        />
      </View>
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add app/(onboarding)/empathy.tsx
git commit -m "feat: add empathy screen with word-by-word animation"
```

---

### Task 6: Create Screen 3 — Solution Timeline

**Files:**
- Create: `app/(onboarding)/solution.tsx`

**Step 1: Create the solution timeline screen**

```typescript
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown, FadeInLeft } from "react-native-reanimated";
import { useOnboardingStore } from "@/stores/onboarding";
import { SOLUTION_STEPS } from "@/constants/onboarding";
import { COLORS, SHADOWS } from "@/constants/design";
import { GradientButton } from "@/components/ui";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

export default function SolutionScreen() {
  const { selectedPersona } = useOnboardingStore();

  if (!selectedPersona) return null;

  const steps = SOLUTION_STEPS[selectedPersona];

  return (
    <View className="flex-1 bg-cream">
      <ProgressDots currentStep={2} />

      <View className="flex-1 px-8 justify-center">
        <Animated.View entering={FadeInDown.duration(500)}>
          <Text className="text-3xl font-semibold text-charcoal text-center mb-12">
            Takhle to řešíme
          </Text>
        </Animated.View>

        <View className="gap-0">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isLast = index === steps.length - 1;
            return (
              <Animated.View
                key={index}
                entering={FadeInLeft.delay(400 + index * 200).duration(500)}
                className="flex-row"
              >
                {/* Timeline column */}
                <View className="items-center mr-4">
                  <View style={styles.iconCircle}>
                    <Icon
                      size={22}
                      color={COLORS.white}
                      weight="bold"
                    />
                  </View>
                  {!isLast && <View style={styles.line} />}
                </View>

                {/* Content column */}
                <View className="flex-1 pb-8">
                  <Text className="text-base font-semibold text-charcoal mb-1">
                    {step.title}
                  </Text>
                  <Text className="text-sm text-muted">
                    {step.description}
                  </Text>
                </View>
              </Animated.View>
            );
          })}
        </View>
      </View>

      <View className="px-8 pb-12">
        <GradientButton
          label="Chci to vidět"
          onPress={() => router.push("/(onboarding)/demo")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.coral.default,
    alignItems: "center",
    justifyContent: "center",
    ...SHADOWS.glow,
  },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: COLORS.peach.light,
    marginVertical: 4,
  },
});
```

**Step 2: Commit**

```bash
git add app/(onboarding)/solution.tsx
git commit -m "feat: add solution timeline screen with staggered animations"
```

---

### Task 7: Create Screen 4 — Wow Moment (Demo + Mock Notification)

**Files:**
- Create: `components/onboarding/MockNotification.tsx`
- Create: `app/(onboarding)/demo.tsx`

**Step 1: Create the mock notification component**

```typescript
import { View, Text, StyleSheet, Image } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";
import { BlurView } from "expo-blur";
import { COLORS, SHADOWS } from "@/constants/design";

interface MockNotificationProps {
  message: string;
  visible: boolean;
  onHidden?: () => void;
}

const SHOW_DURATION = 2500;

export function MockNotification({
  message,
  visible,
  onHidden,
}: MockNotificationProps) {
  const translateY = useSharedValue(-120);

  useEffect(() => {
    if (visible) {
      translateY.value = withSequence(
        withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }),
        withDelay(
          SHOW_DURATION,
          withTiming(-120, {
            duration: 400,
            easing: Easing.in(Easing.cubic),
          })
        )
      );
      // Call onHidden after full animation
      if (onHidden) {
        const timeout = setTimeout(onHidden, 500 + SHOW_DURATION + 400);
        return () => clearTimeout(timeout);
      }
    }
  }, [visible, translateY, onHidden]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <BlurView intensity={80} tint="light" style={styles.blur}>
        <View className="flex-row items-center px-4 py-3">
          <View style={styles.appIcon}>
            <Text className="text-white text-xs font-bold">H</Text>
          </View>
          <View className="flex-1 ml-3">
            <Text className="text-xs text-muted font-medium uppercase tracking-wider">
              Hlásím se
            </Text>
            <Text className="text-sm text-charcoal mt-0.5">{message}</Text>
          </View>
          <Text className="text-xs text-muted">teď</Text>
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    zIndex: 100,
    borderRadius: 16,
    overflow: "hidden",
    ...SHADOWS.floating,
  },
  blur: {
    borderRadius: 16,
    overflow: "hidden",
  },
  appIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.coral.default,
    alignItems: "center",
    justifyContent: "center",
  },
});
```

**Step 2: Create the demo screen**

```typescript
import { useState, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useOnboardingStore } from "@/stores/onboarding";
import { NOTIFICATION_MESSAGE } from "@/constants/onboarding";
import { COLORS } from "@/constants/design";
import { HeroButton } from "@/components/HeroButton";
import { GradientButton } from "@/components/ui";
import { MockNotification } from "@/components/onboarding/MockNotification";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

type DemoPhase = "initial" | "loading" | "success" | "notification" | "cta";

export default function DemoScreen() {
  const { selectedPersona } = useOnboardingStore();
  const [phase, setPhase] = useState<DemoPhase>("initial");

  const handlePress = useCallback(() => {
    if (phase !== "initial") return;
    setPhase("loading");

    // Simulate check-in
    setTimeout(() => {
      setPhase("success");
      // Show notification after success animation
      setTimeout(() => {
        setPhase("notification");
      }, 1500);
    }, 800);
  }, [phase]);

  const handleNotificationHidden = useCallback(() => {
    setPhase("cta");
  }, []);

  if (!selectedPersona) return null;

  const notificationMsg = NOTIFICATION_MESSAGE[selectedPersona];

  return (
    <View className="flex-1 bg-cream">
      <ProgressDots currentStep={3} />

      {/* Mock notification overlay */}
      <MockNotification
        message={notificationMsg}
        visible={phase === "notification"}
        onHidden={handleNotificationHidden}
      />

      <View className="flex-1 justify-center items-center px-8">
        {phase === "initial" && (
          <Animated.View entering={FadeIn.duration(500)} className="items-center mb-8">
            <Text className="text-2xl font-semibold text-charcoal text-center">
              Zkuste to. Klepněte.
            </Text>
          </Animated.View>
        )}

        {(phase === "success" || phase === "notification") && (
          <Animated.View entering={FadeIn.duration(300)} className="items-center mb-8">
            <Text className="text-2xl font-semibold text-charcoal text-center">
              Právě jste se ohlásili!
            </Text>
          </Animated.View>
        )}

        {phase === "cta" && (
          <Animated.View entering={FadeIn.duration(500)} className="items-center mb-8">
            <Text className="text-2xl font-semibold text-charcoal text-center">
              Tohle uvidí vaši blízcí.{"\n"}Pokaždé.
            </Text>
          </Animated.View>
        )}

        <HeroButton
          onPress={handlePress}
          isLoading={phase === "loading"}
          showSuccess={phase === "success" || phase === "notification" || phase === "cta"}
          disabled={phase !== "initial"}
        />
      </View>

      {phase === "cta" && (
        <Animated.View entering={FadeInUp.duration(500)} className="px-8 pb-12">
          <GradientButton
            label="Chci začít"
            onPress={() => router.push("/(onboarding)/signup")}
          />
        </Animated.View>
      )}
    </View>
  );
}
```

**Step 3: Commit**

```bash
git add components/onboarding/MockNotification.tsx app/(onboarding)/demo.tsx
git commit -m "feat: add demo screen with interactive check-in and mock notification"
```

---

### Task 8: Create Screen 5 — Sign Up

**Files:**
- Create: `app/(onboarding)/signup.tsx`

**Step 1: Create the sign up screen**

```typescript
import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { useOnboardingStore } from "@/stores/onboarding";
import { AnimatedInput } from "@/components/ui/AnimatedInput";
import { GradientButton } from "@/components/ui";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

export default function SignUpScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { completeOnboarding } = useOnboardingStore();

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const handleSignUp = async () => {
    // Validation
    if (!name.trim()) {
      setError("Vyplňte prosím své jméno.");
      return;
    }
    if (!email.trim()) {
      setError("Vyplňte prosím e-mail.");
      return;
    }
    if (password.length < 6) {
      setError("Heslo musí mít alespoň 6 znaků.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim() },
        },
      });

      if (signUpError) {
        if (signUpError.message.includes("invalid email")) {
          setError("Neplatný formát e-mailu.");
        } else {
          setError("Registrace se nezdařila. Zkuste to prosím znovu.");
        }
        return;
      }

      if (data.user?.identities?.length === 0) {
        setError("Tento e-mail je již zaregistrován.");
        return;
      }

      await completeOnboarding();
      // Auth listener in root layout will handle navigation to tabs
    } catch (err) {
      console.error("Registration error:", err);
      setError("Nastala neočekávaná chyba. Zkuste to prosím znovu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cream"
    >
      <ProgressDots currentStep={4} />

      <ScrollView
        contentContainerClassName="flex-grow justify-center px-8 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={FadeInDown.duration(500)}>
          <Text className="text-3xl font-semibold text-charcoal text-center mb-2">
            Pojďme na to
          </Text>
          <Text className="text-base text-muted text-center mb-10">
            Vytvoření účtu zabere minutu
          </Text>
        </Animated.View>

        {error && (
          <Animated.View
            entering={FadeInDown.duration(300)}
            className="bg-coral/10 border border-coral rounded-2xl p-3 mb-6"
          >
            <Text className="text-coral text-center text-sm">{error}</Text>
          </Animated.View>
        )}

        <View className="mb-8">
          <AnimatedInput
            label="Jméno"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            editable={!loading}
          />

          <AnimatedInput
            ref={emailRef}
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!loading}
          />

          <AnimatedInput
            ref={passwordRef}
            label="Heslo (min. 6 znaků)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={handleSignUp}
            editable={!loading}
          />
        </View>

        <GradientButton
          label="Vytvořit účet"
          onPress={handleSignUp}
          loading={loading}
          size="lg"
        />

        <View className="flex-row justify-center mt-6">
          <Text className="text-muted">Už máte účet? </Text>
          <TouchableOpacity
            onPress={async () => {
              await completeOnboarding();
              router.replace("/(auth)/login");
            }}
            disabled={loading}
          >
            <Text className="text-coral font-semibold">Přihlásit se</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

**Step 2: Commit**

```bash
git add app/(onboarding)/signup.tsx
git commit -m "feat: add sign up screen to onboarding flow"
```

---

### Task 9: Update Onboarding Layout for All Routes

**Files:**
- Modify: `app/(onboarding)/_layout.tsx`

**Step 1: Update layout to include all onboarding routes with slide animation**

```typescript
import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#FFF8F5" },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="empathy" />
      <Stack.Screen name="solution" />
      <Stack.Screen name="demo" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
```

**Step 2: Commit**

```bash
git add app/(onboarding)/_layout.tsx
git commit -m "feat: update onboarding layout with all routes and slide animation"
```

---

### Task 10: Clean Up Old Components

**Files:**
- Delete: `components/DemoCheckIn.tsx`
- Modify: `app/_layout.tsx` (no changes needed — routing logic already works)

**Step 1: Delete the old DemoCheckIn component**

Delete `components/DemoCheckIn.tsx` — it's no longer imported anywhere since the onboarding index.tsx was completely rewritten.

**Step 2: Verify no remaining imports**

Search for `DemoCheckIn` in the codebase. There should be zero references after the onboarding rewrite.

**Step 3: Commit**

```bash
git rm components/DemoCheckIn.tsx
git commit -m "refactor: remove unused DemoCheckIn component"
```

---

### Task 11: Test Full Flow End-to-End

**Step 1: Reset onboarding state for testing**

In the app, call `resetOnboarding()` from the settings screen, or clear AsyncStorage manually.

**Step 2: Walk through the entire flow**

1. App opens → persona selection screen (3 cards visible, progress dots at step 1)
2. Tap "Bydlím sám/sama" → card highlights, auto-advance to empathy
3. Empathy screen shows personalized text with word-by-word animation, HeartHalf icon
4. Tap "Jak to funguje?" → solution timeline with 3 animated steps
5. Tap "Chci to vidět" → demo screen with HeroButton
6. Tap HeroButton → loading → success → mock notification slides down → auto-hides → CTA appears
7. Tap "Chci začít" → sign up form
8. Fill form and submit → account created → redirected to main app

**Step 3: Test back navigation**

Swipe back on each screen — should go to previous screen correctly.

**Step 4: Test persona persistence**

Kill app during onboarding flow (e.g. on empathy screen), relaunch — should go back to onboarding start (since onboarding isn't complete yet).

**Step 5: Commit all verified changes**

```bash
git add -A
git commit -m "feat: complete onboarding redesign with personalized 5-screen flow"
```
