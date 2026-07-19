# Slice 1: Project Setup - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up a working Expo app with tab navigation, NativeWind styling, and Supabase connection.

**Architecture:** Expo Router for file-based navigation, NativeWind (Tailwind CSS) for styling, Zustand for state, Supabase for backend. The app will have 3 tabs: Check-in, Guardians, Settings.

**Tech Stack:** Expo SDK 52, TypeScript, Expo Router, NativeWind 4, Zustand, Supabase JS

---

## Task 1: Initialize Expo Project

**Files:**
- Create: All Expo template files in project root

**Step 1: Create Expo app in temp location**

```bash
cd /tmp && npx create-expo-app@latest hlasimse-temp --template tabs
```

Expected: New Expo project created with tabs template

**Step 2: Copy Expo files to project (preserving our git and docs)**

```bash
cp -r /tmp/hlasimse-temp/* /Users/tomasmach/Documents/Code/hlasimse-app/
cp /tmp/hlasimse-temp/.gitignore /Users/tomasmach/Documents/Code/hlasimse-app/
```

**Step 3: Clean up temp folder**

```bash
rm -rf /tmp/hlasimse-temp
```

**Step 4: Verify project structure**

```bash
cd /Users/tomasmach/Documents/Code/hlasimse-app && ls -la
```

Expected: See app/, package.json, tsconfig.json, etc.

**Step 5: Install dependencies**

```bash
npm install
```

**Step 6: Test that app runs on iOS Simulator**

```bash
npx expo start --ios
```

Expected: iOS Simulator opens with default tabs app

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: initialize Expo project with tabs template"
```

---

## Task 2: Install Core Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install NativeWind and Tailwind**

```bash
npm install nativewind tailwindcss@^3.4.0
```

**Step 2: Install Supabase client**

```bash
npm install @supabase/supabase-js
```

**Step 3: Install Zustand for state management**

```bash
npm install zustand
```

**Step 4: Install secure storage for auth tokens**

```bash
npx expo install expo-secure-store
```

**Step 5: Install additional Expo packages**

```bash
npx expo install expo-location expo-linking
```

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: add core dependencies"
```

---

## Task 3: Configure NativeWind

**Files:**
- Create: `tailwind.config.js`
- Create: `global.css`
- Modify: `babel.config.js`
- Modify: `metro.config.js`
- Modify: `app/_layout.tsx`

**Step 1: Create tailwind.config.js**

```javascript
// tailwind.config.js
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
        success: "#4ADE80",
      },
      fontFamily: {
        display: ["Lora"],
        body: ["Instrument Sans"],
      },
      borderRadius: {
        "4xl": "2rem",
        "5xl": "2.5rem",
      },
    },
  },
  plugins: [],
};
```

**Step 2: Create global.css**

```css
/* global.css */
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 3: Update babel.config.js**

```javascript
// babel.config.js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
```

**Step 4: Create/Update metro.config.js**

```javascript
// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
```

**Step 5: Create nativewind-env.d.ts**

```typescript
// nativewind-env.d.ts
/// <reference types="nativewind/types" />
```

**Step 6: Update app/_layout.tsx to import global.css**

Add at the top of the file:
```typescript
import "../global.css";
```

**Step 7: Test NativeWind works**

```bash
npx expo start --ios --clear
```

Expected: App starts without errors

**Step 8: Commit**

```bash
git add -A && git commit -m "feat: configure NativeWind with custom theme"
```

---

## Task 4: Create Project Structure

**Files:**
- Create: `lib/supabase.ts`
- Create: `stores/auth.ts`
- Create: `hooks/useAuth.ts`
- Create: `types/database.ts`
- Create: `constants/theme.ts`

**Step 1: Create lib folder with Supabase placeholder**

```typescript
// lib/supabase.ts
import "react-native-url-polyfill/dist/polyfill";
import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    return SecureStore.getItemAsync(key);
  },
  setItem: (key: string, value: string) => {
    SecureStore.setItemAsync(key, value);
  },
  removeItem: (key: string) => {
    SecureStore.deleteItemAsync(key);
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: ExpoSecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

**Step 2: Install URL polyfill**

```bash
npm install react-native-url-polyfill
```

**Step 3: Create stores folder with auth store**

```typescript
// stores/auth.ts
import { create } from "zustand";
import { Session, User } from "@supabase/supabase-js";

interface AuthState {
  session: Session | null;
  user: User | null;
  isLoading: boolean;
  setSession: (session: Session | null) => void;
  setUser: (user: User | null) => void;
  setIsLoading: (isLoading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  isLoading: true,
  setSession: (session) => set({ session }),
  setUser: (user) => set({ user }),
  setIsLoading: (isLoading) => set({ isLoading }),
}));
```

**Step 4: Create hooks folder with useAuth hook**

```typescript
// hooks/useAuth.ts
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";

export function useAuth() {
  const { session, user, isLoading, setSession, setUser, setIsLoading } =
    useAuthStore();

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, user, isLoading };
}
```

**Step 5: Create types folder with database types placeholder**

```typescript
// types/database.ts
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_premium: boolean;
  premium_expires_at: string | null;
  trial_used: boolean;
  created_at: string;
  updated_at: string;
}

export interface CheckInProfile {
  id: string;
  owner_id: string;
  name: string;
  avatar_url: string | null;
  interval_hours: number;
  next_deadline: string | null;
  last_check_in_at: string | null;
  last_known_lat: number | null;
  last_known_lng: number | null;
  is_paused: boolean;
  paused_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Guardian {
  id: string;
  check_in_profile_id: string;
  user_id: string;
  created_at: string;
}

export interface CheckIn {
  id: string;
  check_in_profile_id: string;
  checked_in_at: string;
  lat: number | null;
  lng: number | null;
  was_offline: boolean;
  synced_at: string | null;
}

export interface Alert {
  id: string;
  check_in_profile_id: string;
  triggered_at: string;
  resolved_at: string | null;
  alert_type: "push" | "sms";
  notified_guardians: string[];
}

export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  platform: "ios" | "android";
  created_at: string;
  updated_at: string;
}
```

**Step 6: Create constants folder with theme**

```typescript
// constants/theme.ts
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
```

**Step 7: Commit**

```bash
git add -A && git commit -m "feat: add project structure with lib, stores, hooks, types, constants"
```

---

## Task 5: Create Tab Navigation with Custom Styling

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `app/(tabs)/index.tsx`
- Create: `app/(tabs)/guardians.tsx`
- Modify: `app/(tabs)/explore.tsx` → rename to `settings.tsx`

**Step 1: Update tab layout with custom colors**

```typescript
// app/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#FF6B5B",
        tabBarInactiveTintColor: "#8B7F7A",
        tabBarStyle: {
          backgroundColor: "#FFFFFF",
          borderTopColor: "#F5E6DC",
        },
        headerStyle: {
          backgroundColor: "#FFF8F5",
        },
        headerTintColor: "#2D2926",
        headerTitleStyle: {
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Hlásím se",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="hand-left" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="guardians"
        options={{
          title: "Strážci",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Nastavení",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
```

**Step 2: Update main check-in screen**

```typescript
// app/(tabs)/index.tsx
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function CheckInScreen() {
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-2xl font-semibold mb-4">
          Ahoj!
        </Text>
        <Text className="text-muted text-center mb-8">
          Zmáčkni tlačítko a dej vědět, že jsi v pořádku
        </Text>

        <Pressable className="bg-coral w-48 h-48 rounded-full items-center justify-center shadow-lg active:bg-coral-dark">
          <Text className="text-white text-xl font-bold">
            Hlásím se!
          </Text>
        </Pressable>

        <Text className="text-muted mt-8">
          Další hlášení za: 23:45:12
        </Text>
      </View>
    </SafeAreaView>
  );
}
```

**Step 3: Create guardians screen**

```typescript
// app/(tabs)/guardians.tsx
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function GuardiansScreen() {
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-xl font-semibold mb-4">
          Strážci
        </Text>
        <Text className="text-muted text-center">
          Tady uvidíš lidi, kteří tě hlídají
        </Text>
      </View>
    </SafeAreaView>
  );
}
```

**Step 4: Delete explore.tsx and create settings.tsx**

```bash
rm app/\(tabs\)/explore.tsx
```

```typescript
// app/(tabs)/settings.tsx
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettingsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-xl font-semibold mb-4">
          Nastavení
        </Text>
        <Text className="text-muted text-center">
          Tady si nastavíš svůj profil a předplatné
        </Text>
      </View>
    </SafeAreaView>
  );
}
```

**Step 5: Clean up unused files from template**

```bash
rm -rf components/navigation
rm -rf components/Collapsible.tsx components/ExternalLink.tsx components/HapticTab.tsx components/HelloWave.tsx components/ParallaxScrollView.tsx components/ThemedText.tsx components/ThemedView.tsx
rm -rf constants/Colors.ts
rm -rf hooks/useColorScheme.ts hooks/useColorScheme.web.ts hooks/useThemeColor.ts
```

**Step 6: Update app/_layout.tsx**

```typescript
// app/_layout.tsx
import "../global.css";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
```

**Step 7: Test the app**

```bash
npx expo start --ios --clear
```

Expected: App shows 3 tabs with coral accent color, cream background

**Step 8: Commit**

```bash
git add -A && git commit -m "feat: create custom tab navigation with Hlásím se styling"
```

---

## Task 6: Create Supabase Project and Database

**Step 1: Create Supabase project**

Go to https://supabase.com/dashboard and create new project:
- Name: hlasimse
- Region: eu-central-1 (Frankfurt)
- Generate strong password

**Step 2: Create .env.local file**

```bash
# .env.local
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

Get values from Supabase Dashboard → Settings → API

**Step 3: Add .env.local to .gitignore**

```bash
echo ".env.local" >> .gitignore
```

**Step 4: Run database migrations in Supabase SQL Editor**

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  avatar_url TEXT,
  is_premium BOOLEAN DEFAULT false,
  premium_expires_at TIMESTAMPTZ,
  trial_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Check-in profiles
CREATE TABLE public.check_in_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  interval_hours INTEGER DEFAULT 24,
  next_deadline TIMESTAMPTZ,
  last_check_in_at TIMESTAMPTZ,
  last_known_lat FLOAT,
  last_known_lng FLOAT,
  is_paused BOOLEAN DEFAULT false,
  paused_until TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Guardians
CREATE TABLE public.guardians (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_in_profile_id UUID NOT NULL REFERENCES public.check_in_profiles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(check_in_profile_id, user_id)
);

-- Check-ins history
CREATE TABLE public.check_ins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_in_profile_id UUID NOT NULL REFERENCES public.check_in_profiles(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ DEFAULT now(),
  lat FLOAT,
  lng FLOAT,
  was_offline BOOLEAN DEFAULT false,
  synced_at TIMESTAMPTZ
);

-- Alerts
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  check_in_profile_id UUID NOT NULL REFERENCES public.check_in_profiles(id) ON DELETE CASCADE,
  triggered_at TIMESTAMPTZ DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  alert_type TEXT DEFAULT 'push',
  notified_guardians UUID[] DEFAULT '{}'
);

-- Push tokens
CREATE TABLE public.push_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_profiles_deadline ON public.check_in_profiles(next_deadline)
  WHERE is_paused = false AND is_active = true;
CREATE INDEX idx_guardians_profile ON public.guardians(check_in_profile_id);
CREATE INDEX idx_checkins_profile_time ON public.check_ins(check_in_profile_id, checked_in_at DESC);

-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_in_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_ins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- RLS Policies for check_in_profiles
CREATE POLICY "Users can view own profiles" ON public.check_in_profiles
  FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can create own profiles" ON public.check_in_profiles
  FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users can update own profiles" ON public.check_in_profiles
  FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users can delete own profiles" ON public.check_in_profiles
  FOR DELETE USING (auth.uid() = owner_id);
CREATE POLICY "Guardians can view profiles they guard" ON public.check_in_profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.guardians
      WHERE check_in_profile_id = id AND user_id = auth.uid()
    )
  );

-- RLS Policies for guardians
CREATE POLICY "Profile owners can manage guardians" ON public.guardians
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.check_in_profiles
      WHERE id = check_in_profile_id AND owner_id = auth.uid()
    )
  );
CREATE POLICY "Users can view where they are guardians" ON public.guardians
  FOR SELECT USING (user_id = auth.uid());

-- RLS Policies for check_ins
CREATE POLICY "Profile owners can manage check-ins" ON public.check_ins
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.check_in_profiles
      WHERE id = check_in_profile_id AND owner_id = auth.uid()
    )
  );

-- RLS Policies for alerts
CREATE POLICY "Profile owners can view alerts" ON public.alerts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.check_in_profiles
      WHERE id = check_in_profile_id AND owner_id = auth.uid()
    )
  );

-- RLS Policies for push_tokens
CREATE POLICY "Users can manage own tokens" ON public.push_tokens
  FOR ALL USING (auth.uid() = user_id);

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

**Step 5: Verify tables in Supabase Dashboard**

Go to Table Editor and confirm all 6 tables exist:
- users
- check_in_profiles
- guardians
- check_ins
- alerts
- push_tokens

**Step 6: Test Supabase connection in app**

Update `app/(tabs)/settings.tsx` temporarily to test connection:

```typescript
// app/(tabs)/settings.tsx
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useState } from "react";

export default function SettingsScreen() {
  const [status, setStatus] = useState("Not tested");

  const testConnection = async () => {
    try {
      const { data, error } = await supabase.from("users").select("count");
      if (error) throw error;
      setStatus("Connected!");
    } catch (error) {
      setStatus("Error: " + (error as Error).message);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-xl font-semibold mb-4">
          Nastavení
        </Text>
        <Pressable
          onPress={testConnection}
          className="bg-coral px-6 py-3 rounded-full mb-4"
        >
          <Text className="text-white font-semibold">Test Supabase</Text>
        </Pressable>
        <Text className="text-muted text-center">
          Status: {status}
        </Text>
      </View>
    </SafeAreaView>
  );
}
```

**Step 7: Run app and test**

```bash
npx expo start --ios --clear
```

Navigate to Settings tab and tap "Test Supabase". Should show "Connected!"

**Step 8: Commit (excluding .env.local)**

```bash
git add -A && git commit -m "feat: add Supabase database schema and connection"
```

---

## Task 7: Final Cleanup and Verification

**Step 1: Remove test code from settings**

Revert `app/(tabs)/settings.tsx` to simple version:

```typescript
// app/(tabs)/settings.tsx
import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettingsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-xl font-semibold mb-4">
          Nastavení
        </Text>
        <Text className="text-muted text-center">
          Tady si nastavíš svůj profil a předplatné
        </Text>
      </View>
    </SafeAreaView>
  );
}
```

**Step 2: Final test**

```bash
npx expo start --ios --clear
```

Verify:
- [ ] App starts without errors
- [ ] 3 tabs visible: Hlásím se, Strážci, Nastavení
- [ ] Coral accent color on active tab
- [ ] Cream background on all screens
- [ ] Big button visible on check-in screen

**Step 3: Final commit**

```bash
git add -A && git commit -m "chore: cleanup and finalize Slice 1"
```

---

## Slice 1 Complete Checklist

After completing all tasks, verify:

- [ ] Expo project initialized and running
- [ ] NativeWind configured with custom colors
- [ ] Project structure created (lib, stores, hooks, types, constants)
- [ ] 3-tab navigation working
- [ ] Supabase project created with all tables
- [ ] Database connected (tested)
- [ ] All code committed

**Next:** Slice 2 - Authentication (registrace, přihlášení, zapomenuté heslo)
