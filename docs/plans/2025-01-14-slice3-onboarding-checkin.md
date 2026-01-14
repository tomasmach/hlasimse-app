# Slice 3: Onboarding & Check-in Profile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement onboarding flow for first-time users (before registration) and functional check-in profile with countdown timer.

**Architecture:**
- Onboarding uses AsyncStorage to track first-launch state
- Check-in profile is created automatically after registration
- Main screen shows real countdown to next deadline with functional check-in button
- Zustand store manages check-in profile state

**Tech Stack:** Expo Router, NativeWind, Zustand, Supabase, AsyncStorage, expo-location

**Style Guide Reference:** `styles.md` - brand-500 (#f97316), bg (#fffaf5), rounded-[2rem], Outfit font

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install AsyncStorage for onboarding state persistence**

```bash
npx expo install @react-native-async-storage/async-storage
```

**Step 2: Verify installation**

```bash
cat package.json | grep async-storage
```

Expected: `"@react-native-async-storage/async-storage": "..."`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add async-storage for onboarding state"
```

---

## Task 2: Create Onboarding Store

**Files:**
- Create: `stores/onboarding.ts`

**Step 1: Create the onboarding store**

```typescript
import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDING_KEY = "hasSeenOnboarding";

interface OnboardingState {
  hasSeenOnboarding: boolean | null;
  isLoading: boolean;
  checkOnboardingStatus: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  hasSeenOnboarding: null,
  isLoading: true,

  checkOnboardingStatus: async () => {
    try {
      const value = await AsyncStorage.getItem(ONBOARDING_KEY);
      set({ hasSeenOnboarding: value === "true", isLoading: false });
    } catch {
      set({ hasSeenOnboarding: false, isLoading: false });
    }
  },

  completeOnboarding: async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, "true");
      set({ hasSeenOnboarding: true });
    } catch (error) {
      console.error("Failed to save onboarding status:", error);
    }
  },
}));
```

**Step 2: Commit**

```bash
git add stores/onboarding.ts
git commit -m "feat: add onboarding store with AsyncStorage persistence"
```

---

## Task 3: Create Onboarding Screens

**Files:**
- Create: `app/(onboarding)/_layout.tsx`
- Create: `app/(onboarding)/index.tsx`

**Step 1: Create onboarding layout**

```typescript
// app/(onboarding)/_layout.tsx
import { Stack } from "expo-router";

export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
```

**Step 2: Create onboarding screen with 3 slides**

```typescript
// app/(onboarding)/index.tsx
import { useState, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  Dimensions,
  FlatList,
  ViewToken,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useOnboardingStore } from "@/stores/onboarding";

const { width } = Dimensions.get("window");

interface OnboardingSlide {
  id: string;
  emoji: string;
  title: string;
  description: string;
}

const slides: OnboardingSlide[] = [
  {
    id: "1",
    emoji: "👋",
    title: "Vítejte v Hlásím se",
    description:
      "Jednoduchá aplikace, která dá vašim blízkým vědět, že jste v pořádku.",
  },
  {
    id: "2",
    emoji: "⏰",
    title: "Pravidelné hlášení",
    description:
      "Nastavte si interval a jedním kliknutím potvrďte, že je vše OK. Žádné složité formuláře.",
  },
  {
    id: "3",
    emoji: "🛡️",
    title: "Klid pro vaše blízké",
    description:
      "Pokud se neohlásíte včas, vaši strážci dostanou upozornění s vaší poslední známou polohou.",
  },
];

export default function OnboardingScreen() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const router = useRouter();
  const { completeOnboarding } = useOnboardingStore();

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const handleNext = () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      handleComplete();
    }
  };

  const handleComplete = async () => {
    await completeOnboarding();
    router.replace("/(auth)/login");
  };

  const renderSlide = ({ item }: { item: OnboardingSlide }) => (
    <View style={{ width }} className="flex-1 items-center justify-center px-8">
      <Text className="text-8xl mb-8">{item.emoji}</Text>
      <Text className="text-3xl font-bold text-charcoal text-center mb-4">
        {item.title}
      </Text>
      <Text className="text-lg text-muted text-center leading-7">
        {item.description}
      </Text>
    </View>
  );

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1">
        <FlatList
          ref={flatListRef}
          data={slides}
          renderItem={renderSlide}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
        />
      </View>

      {/* Pagination dots */}
      <View className="flex-row justify-center gap-2 mb-8">
        {slides.map((_, index) => (
          <View
            key={index}
            className={`w-2 h-2 rounded-full ${
              index === currentIndex ? "bg-coral w-6" : "bg-sand"
            }`}
          />
        ))}
      </View>

      {/* Buttons */}
      <View className="px-6 pb-8 gap-3">
        <Pressable
          onPress={handleNext}
          className="bg-coral rounded-[2rem] py-4 items-center active:opacity-90"
        >
          <Text className="text-white font-semibold text-lg">
            {isLastSlide ? "Začít" : "Pokračovat"}
          </Text>
        </Pressable>

        {!isLastSlide && (
          <Pressable onPress={handleComplete} className="py-3 items-center">
            <Text className="text-muted font-medium">Přeskočit</Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}
```

**Step 3: Commit**

```bash
git add app/\(onboarding\)
git commit -m "feat: add onboarding screens with swipeable slides"
```

---

## Task 4: Update Root Layout for Onboarding Flow

**Files:**
- Modify: `app/_layout.tsx`

**Step 1: Update root layout to handle onboarding state**

Replace content of `app/_layout.tsx`:

```typescript
import "../global.css";
import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingStore } from "@/stores/onboarding";

function useProtectedRoute(
  user: any,
  isAuthLoading: boolean,
  hasSeenOnboarding: boolean | null,
  isOnboardingLoading: boolean
) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isAuthLoading || isOnboardingLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inOnboarding = segments[0] === "(onboarding)";

    // First time user - show onboarding
    if (!hasSeenOnboarding && !inOnboarding) {
      router.replace("/(onboarding)");
      return;
    }

    // Has seen onboarding but not logged in
    if (hasSeenOnboarding && !user && !inAuthGroup && !inOnboarding) {
      router.replace("/(auth)/login");
      return;
    }

    // Logged in user trying to access auth/onboarding
    if (user && (inAuthGroup || inOnboarding)) {
      router.replace("/(tabs)");
      return;
    }
  }, [user, segments, isAuthLoading, hasSeenOnboarding, isOnboardingLoading]);
}

export default function RootLayout() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    hasSeenOnboarding,
    isLoading: isOnboardingLoading,
    checkOnboardingStatus,
  } = useOnboardingStore();

  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  useProtectedRoute(
    user,
    isAuthLoading,
    hasSeenOnboarding,
    isOnboardingLoading
  );

  if (isAuthLoading || isOnboardingLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
```

**Step 2: Test the onboarding flow**

```bash
npx expo start
```

Expected: First launch shows onboarding, after completion shows login.

**Step 3: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: integrate onboarding flow into root navigation"
```

---

## Task 5: Create Check-in Profile Store

**Files:**
- Create: `stores/checkin.ts`

**Step 1: Create the check-in store**

```typescript
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { CheckInProfile } from "@/types/database";

interface CheckInState {
  profile: CheckInProfile | null;
  isLoading: boolean;
  error: string | null;
  fetchProfile: (userId: string) => Promise<void>;
  createProfile: (userId: string, name: string) => Promise<CheckInProfile | null>;
  checkIn: () => Promise<boolean>;
  clearProfile: () => void;
}

export const useCheckInStore = create<CheckInState>((set, get) => ({
  profile: null,
  isLoading: false,
  error: null,

  fetchProfile: async (userId: string) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase
        .from("check_in_profiles")
        .select("*")
        .eq("owner_id", userId)
        .single();

      if (error && error.code !== "PGRST116") {
        throw error;
      }

      set({ profile: data, isLoading: false });
    } catch (error) {
      console.error("Error fetching profile:", error);
      set({ error: "Nepodařilo se načíst profil.", isLoading: false });
    }
  },

  createProfile: async (userId: string, name: string) => {
    // Input validation constants
    const MIN_NAME_LENGTH = 2;
    const MAX_NAME_LENGTH = 100;

    // Trim the incoming name
    const trimmedName = name.trim();

    // Validate name length
    if (trimmedName.length < MIN_NAME_LENGTH) {
      set({ error: "Jméno musí mít alespoň 2 znaky.", isLoading: false });
      return null;
    }

    if (trimmedName.length > MAX_NAME_LENGTH) {
      set({ error: "Jméno je příliš dlouhé (max 100 znaků).", isLoading: false });
      return null;
    }

    // Validate against disallowed characters (control chars, only whitespace)
    // Allow letters, numbers, spaces, and common punctuation
    const nameRegex = /^[\p{L}\p{N}\s.,'-]+$/u;
    if (!nameRegex.test(trimmedName)) {
      set({ error: "Jméno obsahuje nepovolené znaky.", isLoading: false });
      return null;
    }

    set({ isLoading: true, error: null });
    try {
      const now = new Date();
      const nextDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from("check_in_profiles")
        .insert({
          owner_id: userId,
          name: trimmedName,
          interval_hours: 24,
          next_deadline: nextDeadline.toISOString(),
          is_active: true,
          is_paused: false,
        })
        .select()
        .single();

      if (error) throw error;

      set({ profile: data, isLoading: false });
      return data;
    } catch (error) {
      console.error("Error creating profile:", error);
      set({ error: "Nepodařilo se vytvořit profil.", isLoading: false });
      return null;
    }
  },

  checkIn: async () => {
    const { profile } = get();
    if (!profile) return false;

    set({ isLoading: true, error: null });
    try {
      const now = new Date();
      const nextDeadline = new Date(
        now.getTime() + profile.interval_hours * 60 * 60 * 1000
      );

      // Insert check-in record
      const { error: checkInError } = await supabase.from("check_ins").insert({
        check_in_profile_id: profile.id,
        checked_in_at: now.toISOString(),
        was_offline: false,
      });

      if (checkInError) throw checkInError;

      // Update profile with new deadline
      const { data, error: updateError } = await supabase
        .from("check_in_profiles")
        .update({
          last_check_in_at: now.toISOString(),
          next_deadline: nextDeadline.toISOString(),
        })
        .eq("id", profile.id)
        .select()
        .single();

      if (updateError) throw updateError;

      set({ profile: data, isLoading: false });
      return true;
    } catch (error) {
      console.error("Error checking in:", error);
      set({ error: "Nepodařilo se odeslat hlášení.", isLoading: false });
      return false;
    }
  },

  clearProfile: () => {
    set({ profile: null, isLoading: false, error: null });
  },
}));
```

**Step 2: Commit**

```bash
git add stores/checkin.ts
git commit -m "feat: add check-in store with profile management"
```

---

## Task 6: Create useCountdown Hook

**Files:**
- Create: `hooks/useCountdown.ts`

**Step 1: Create the countdown hook**

```typescript
import { useState, useEffect, useCallback } from "react";

interface CountdownResult {
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  formatted: string;
}

export function useCountdown(deadline: string | null): CountdownResult {
  const calculateTimeLeft = useCallback(() => {
    if (!deadline) {
      return { hours: 0, minutes: 0, seconds: 0, isExpired: true };
    }

    const now = new Date().getTime();
    const target = new Date(deadline).getTime();
    const difference = target - now;

    if (difference <= 0) {
      return { hours: 0, minutes: 0, seconds: 0, isExpired: true };
    }

    const hours = Math.floor(difference / (1000 * 60 * 60));
    const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((difference % (1000 * 60)) / 1000);

    return { hours, minutes, seconds, isExpired: false };
  }, [deadline]);

  const [timeLeft, setTimeLeft] = useState(calculateTimeLeft);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft(calculateTimeLeft());
    }, 1000);

    return () => clearInterval(timer);
  }, [calculateTimeLeft]);

  const formatted = `${String(timeLeft.hours).padStart(2, "0")}:${String(
    timeLeft.minutes
  ).padStart(2, "0")}:${String(timeLeft.seconds).padStart(2, "0")}`;

  return { ...timeLeft, formatted };
}
```

**Step 2: Commit**

```bash
git add hooks/useCountdown.ts
git commit -m "feat: add useCountdown hook for deadline timer"
```

---

## Task 7: Create Profile Setup Screen

**Files:**
- Create: `app/(tabs)/profile-setup.tsx`
- Modify: `app/(tabs)/_layout.tsx`

**Step 1: Create profile setup screen**

```typescript
// app/(tabs)/profile-setup.tsx
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";

export default function ProfileSetupScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { createProfile, isLoading } = useCheckInStore();
  const [name, setName] = useState(user?.user_metadata?.name || "");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("Vyplňte prosím své jméno.");
      return;
    }

    if (!user) return;

    const profile = await createProfile(user.id, name.trim());
    if (profile) {
      router.replace("/(tabs)");
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          <View className="items-center mb-12">
            <Text className="text-6xl mb-6">👤</Text>
            <Text className="text-3xl font-bold text-charcoal text-center">
              Nastavte svůj profil
            </Text>
            <Text className="text-muted text-center mt-2">
              Jak se máte jmenovat v hlášeních?
            </Text>
          </View>

          {error && (
            <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-6">
              <Text className="text-coral text-center">{error}</Text>
            </View>
          )}

          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-4 text-charcoal text-lg text-center mb-6"
            placeholder="Vaše jméno"
            placeholderTextColor="#8B7F7A"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            editable={!isLoading}
          />

          <Pressable
            onPress={handleSubmit}
            disabled={isLoading}
            className="bg-coral rounded-[2rem] py-4 items-center active:opacity-90"
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text className="text-white font-semibold text-lg">
                Pokračovat
              </Text>
            )}
          </Pressable>

          <Text className="text-muted text-center text-sm mt-6">
            Interval hlášení: 1× za 24 hodin
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

**Step 2: Update tabs layout to include profile-setup (hidden from tabs)**

Read current `app/(tabs)/_layout.tsx` first, then update to hide profile-setup from tab bar.

**Step 3: Commit**

```bash
git add app/\(tabs\)/profile-setup.tsx app/\(tabs\)/_layout.tsx
git commit -m "feat: add profile setup screen for new users"
```

---

## Task 8: Update Main Check-in Screen

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Step 1: Replace with functional check-in screen**

```typescript
import { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { useCountdown } from "@/hooks/useCountdown";

export default function CheckInScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const { profile, isLoading, fetchProfile, checkIn } = useCheckInStore();
  const countdown = useCountdown(profile?.next_deadline || null);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const scaleAnim = useState(new Animated.Value(1))[0];

  useEffect(() => {
    if (user) {
      fetchProfile(user.id);
    }
  }, [user]);

  useEffect(() => {
    if (profile === null && !isLoading && user) {
      router.replace("/(tabs)/profile-setup");
    }
  }, [profile, isLoading, user]);

  const handleCheckIn = async () => {
    setIsCheckingIn(true);

    // Button press animation
    Animated.sequence([
      Animated.timing(scaleAnim, {
        toValue: 0.95,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 100,
        useNativeDriver: true,
      }),
    ]).start();

    const success = await checkIn();
    setIsCheckingIn(false);

    if (success) {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 2000);
    }
  };

  if (isLoading || !profile) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        {/* Greeting */}
        <Text className="text-charcoal text-2xl font-semibold mb-2">
          Ahoj, {profile.name}!
        </Text>
        <Text className="text-muted text-center mb-12">
          {countdown.isExpired
            ? "Čas vypršel! Ohlas se prosím."
            : "Zmáčkni tlačítko a dej vědět, že jsi v pořádku"}
        </Text>

        {/* Check-in button */}
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
          <Pressable
            onPress={handleCheckIn}
            disabled={isCheckingIn}
            className={`w-48 h-48 rounded-full items-center justify-center shadow-lg ${
              countdown.isExpired ? "bg-coral" : "bg-coral"
            } ${isCheckingIn ? "opacity-70" : ""}`}
            style={{
              shadowColor: "#FF6B5B",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.4,
              shadowRadius: 16,
              elevation: 12,
            }}
          >
            {isCheckingIn ? (
              <ActivityIndicator color="#FFFFFF" size="large" />
            ) : showSuccess ? (
              <Text className="text-white text-5xl">✓</Text>
            ) : (
              <Text className="text-white text-xl font-bold text-center">
                Hlásím se!
              </Text>
            )}
          </Pressable>
        </Animated.View>

        {/* Countdown */}
        <View className="mt-12 items-center">
          <Text className="text-muted text-sm mb-1">
            {countdown.isExpired ? "Čas překročen o:" : "Další hlášení za:"}
          </Text>
          <Text
            className={`text-4xl font-bold ${
              countdown.isExpired ? "text-coral" : "text-charcoal"
            }`}
          >
            {countdown.formatted}
          </Text>
        </View>

        {/* Success message */}
        {showSuccess && (
          <View className="absolute bottom-32 bg-success/20 border border-success rounded-xl px-6 py-3">
            <Text className="text-success font-semibold">
              Hlášení odesláno! ✓
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
```

**Step 2: Commit**

```bash
git add app/\(tabs\)/index.tsx
git commit -m "feat: implement functional check-in screen with countdown"
```

---

## Task 9: Update Tabs Layout

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

**Step 1: Read current layout**

Read `app/(tabs)/_layout.tsx` and update to hide profile-setup screen from tab bar.

**Step 2: Update layout**

Add profile-setup as a stack screen that doesn't appear in tabs:

```typescript
// Add this Screen inside Tabs component
<Tabs.Screen
  name="profile-setup"
  options={{
    href: null, // This hides it from tab bar
    headerShown: false,
  }}
/>
```

**Step 3: Commit**

```bash
git add app/\(tabs\)/_layout.tsx
git commit -m "feat: hide profile-setup from tab bar navigation"
```

---

## Task 10: Handle Auth State Changes for Profile

**Files:**
- Modify: `hooks/useAuth.ts`

**Step 1: Update useAuth to clear check-in store on logout**

```typescript
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";
import { useCheckInStore } from "@/stores/checkin";

export function useAuth() {
  const { session, user, isLoading, setSession, setUser, setIsLoading } =
    useAuthStore();
  const { clearProfile } = useCheckInStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      // Clear profile on logout
      if (!session) {
        clearProfile();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, user, isLoading };
}
```

**Step 2: Commit**

```bash
git add hooks/useAuth.ts
git commit -m "feat: clear check-in profile on logout"
```

---

## Task 11: Test Complete Flow

**Step 1: Clear AsyncStorage and test fresh install**

```bash
npx expo start --clear
```

**Step 2: Test flow manually**

1. Fresh install → Onboarding appears
2. Complete onboarding → Login screen
3. Register new account → Profile setup
4. Set name → Main check-in screen with countdown
5. Press "Hlásím se!" → Timer resets
6. Logout → Returns to login
7. Login again → Goes directly to check-in (profile exists)

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete slice 3 - onboarding and check-in profile"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Install AsyncStorage | package.json |
| 2 | Onboarding store | stores/onboarding.ts |
| 3 | Onboarding screens | app/(onboarding)/* |
| 4 | Root layout update | app/_layout.tsx |
| 5 | Check-in store | stores/checkin.ts |
| 6 | Countdown hook | hooks/useCountdown.ts |
| 7 | Profile setup screen | app/(tabs)/profile-setup.tsx |
| 8 | Main check-in screen | app/(tabs)/index.tsx |
| 9 | Tabs layout update | app/(tabs)/_layout.tsx |
| 10 | Auth hook update | hooks/useAuth.ts |
| 11 | Integration testing | - |
