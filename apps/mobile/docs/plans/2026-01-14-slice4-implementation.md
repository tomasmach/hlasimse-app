# Slice 4: Check-in Logic - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Přidat GPS polohu při check-inu, offline podporu s queue, a backend deadline tracking přes Edge Function.

**Architecture:** GPS hook pro polohu, AsyncStorage queue pro offline check-iny, NetInfo pro detekci spojení, Supabase Edge Function s cron pro kontrolu prošlých deadlines.

**Tech Stack:** Expo Location, NetInfo, AsyncStorage, Supabase Edge Functions, pg_cron

---

## Task 1: Install NetInfo Dependency

**Files:**
- Modify: `package.json`

**Step 1: Install @react-native-community/netinfo**

```bash
npx expo install @react-native-community/netinfo
```

Expected: Package added to package.json

**Step 2: Verify installation**

```bash
cat package.json | grep netinfo
```

Expected: `"@react-native-community/netinfo": "..."`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add netinfo for offline detection"
```

---

## Task 2: Create useLocation Hook

**Files:**
- Create: `hooks/useLocation.ts`

**Step 1: Create the hook file**

```typescript
// hooks/useLocation.ts
import { useState, useEffect, useCallback } from "react";
import * as Location from "expo-location";

export type PermissionStatus = "granted" | "denied" | "undetermined" | null;

interface LocationCoords {
  lat: number;
  lng: number;
}

interface UseLocationResult {
  permissionStatus: PermissionStatus;
  isLoading: boolean;
  requestPermission: () => Promise<boolean>;
  getCurrentPosition: (timeoutMs?: number) => Promise<LocationCoords | null>;
}

export function useLocation(): UseLocationResult {
  const [permissionStatus, setPermissionStatus] =
    useState<PermissionStatus>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check permission on mount
  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      setPermissionStatus(status as PermissionStatus);
    } catch (error) {
      console.error("Error checking location permission:", error);
      setPermissionStatus("denied");
    } finally {
      setIsLoading(false);
    }
  };

  const requestPermission = useCallback(async (): Promise<boolean> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status as PermissionStatus);
      return status === "granted";
    } catch (error) {
      console.error("Error requesting location permission:", error);
      setPermissionStatus("denied");
      return false;
    }
  }, []);

  const getCurrentPosition = useCallback(
    async (timeoutMs: number = 5000): Promise<LocationCoords | null> => {
      // If permission not granted, try to request
      if (permissionStatus !== "granted") {
        const granted = await requestPermission();
        if (!granted) return null;
      }

      try {
        const location = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("Location timeout")), timeoutMs)
          ),
        ]);

        if (location && "coords" in location) {
          return {
            lat: location.coords.latitude,
            lng: location.coords.longitude,
          };
        }
        return null;
      } catch (error) {
        console.error("Error getting location:", error);
        return null;
      }
    },
    [permissionStatus, requestPermission]
  );

  return {
    permissionStatus,
    isLoading,
    requestPermission,
    getCurrentPosition,
  };
}
```

**Step 2: Verify file created**

```bash
cat hooks/useLocation.ts | head -20
```

Expected: File content visible

**Step 3: Commit**

```bash
git add hooks/useLocation.ts
git commit -m "feat: add useLocation hook for GPS permission and position"
```

---

## Task 3: Create Offline Queue

**Files:**
- Create: `lib/offlineQueue.ts`

**Step 1: Create the offline queue module**

```typescript
// lib/offlineQueue.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "offline_checkin_queue";

export interface PendingCheckIn {
  id: string;
  profileId: string;
  checkedInAt: string;
  nextDeadline: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  remainingCount: number;
}

// Generate unique ID for pending check-in
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function addToQueue(
  checkIn: Omit<PendingCheckIn, "id" | "createdAt">
): Promise<PendingCheckIn> {
  const queue = await getQueue();
  const newCheckIn: PendingCheckIn = {
    ...checkIn,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  queue.push(newCheckIn);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return newCheckIn;
}

export async function getQueue(): Promise<PendingCheckIn[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    if (!data) return [];
    return JSON.parse(data) as PendingCheckIn[];
  } catch (error) {
    console.error("Error reading offline queue:", error);
    return [];
  }
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueue();
  const filtered = queue.filter((item) => item.id !== id);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

export async function getQueueCount(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}
```

**Step 2: Verify file created**

```bash
cat lib/offlineQueue.ts | head -20
```

Expected: File content visible

**Step 3: Commit**

```bash
git add lib/offlineQueue.ts
git commit -m "feat: add offline queue for pending check-ins"
```

---

## Task 4: Create Network Status Hook

**Files:**
- Create: `hooks/useNetworkStatus.ts`

**Step 1: Create the hook**

```typescript
// hooks/useNetworkStatus.ts
import { useState, useEffect } from "react";
import NetInfo, { NetInfoState } from "@react-native-community/netinfo";

interface NetworkStatus {
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: null,
    isInternetReachable: null,
  });

  useEffect(() => {
    // Get initial state
    NetInfo.fetch().then((state: NetInfoState) => {
      setStatus({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      });
    });

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setStatus({
        isConnected: state.isConnected,
        isInternetReachable: state.isInternetReachable,
      });
    });

    return () => unsubscribe();
  }, []);

  return status;
}
```

**Step 2: Commit**

```bash
git add hooks/useNetworkStatus.ts
git commit -m "feat: add useNetworkStatus hook for connectivity detection"
```

---

## Task 5: Update atomic_check_in RPC to Support GPS

**Files:**
- Create: `docs/migrations/atomic_check_in_v2.sql`

**Step 1: Create updated RPC migration**

```sql
-- Migration: Atomic Check-In Function v2
-- Adds GPS coordinates support and auto-resolves active alerts

CREATE OR REPLACE FUNCTION atomic_check_in(
  p_profile_id UUID,
  p_checked_in_at TIMESTAMPTZ,
  p_next_deadline TIMESTAMPTZ,
  p_was_offline BOOLEAN DEFAULT FALSE,
  p_lat FLOAT DEFAULT NULL,
  p_lng FLOAT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  owner_id UUID,
  name TEXT,
  interval_hours INTEGER,
  next_deadline TIMESTAMPTZ,
  last_check_in_at TIMESTAMPTZ,
  last_known_lat FLOAT,
  last_known_lng FLOAT,
  is_active BOOLEAN,
  is_paused BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert check-in record with coordinates
  INSERT INTO check_ins (check_in_profile_id, checked_in_at, was_offline, lat, lng)
  VALUES (p_profile_id, p_checked_in_at, p_was_offline, p_lat, p_lng);

  -- Auto-resolve any active alerts for this profile
  UPDATE alerts
  SET resolved_at = NOW()
  WHERE check_in_profile_id = p_profile_id
    AND resolved_at IS NULL;

  -- Update profile with new deadline, last check-in time, and coordinates
  RETURN QUERY
  UPDATE check_in_profiles
  SET
    last_check_in_at = p_checked_in_at,
    next_deadline = p_next_deadline,
    last_known_lat = COALESCE(p_lat, last_known_lat),
    last_known_lng = COALESCE(p_lng, last_known_lng),
    updated_at = NOW()
  WHERE check_in_profiles.id = p_profile_id
  RETURNING
    check_in_profiles.id,
    check_in_profiles.owner_id,
    check_in_profiles.name,
    check_in_profiles.interval_hours,
    check_in_profiles.next_deadline,
    check_in_profiles.last_check_in_at,
    check_in_profiles.last_known_lat,
    check_in_profiles.last_known_lng,
    check_in_profiles.is_active,
    check_in_profiles.is_paused,
    check_in_profiles.created_at,
    check_in_profiles.updated_at;
END;
$$;
```

**Step 2: Commit migration file**

```bash
git add docs/migrations/atomic_check_in_v2.sql
git commit -m "feat: update atomic_check_in RPC with GPS and auto-resolve alerts"
```

**Step 3: Apply migration to Supabase**

Run this SQL in Supabase Dashboard > SQL Editor.

---

## Task 6: Update Check-in Store with GPS and Offline Support

**Files:**
- Modify: `stores/checkin.ts`

**Step 1: Replace checkin store with updated version**

```typescript
// stores/checkin.ts
import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { CheckInProfile } from "@/types/database";
import {
  addToQueue,
  getQueue,
  removeFromQueue,
  getQueueCount,
  PendingCheckIn,
} from "@/lib/offlineQueue";

interface CheckInState {
  profile: CheckInProfile | null;
  isLoading: boolean;
  error: string | null;
  pendingCount: number;
  lastCheckInWasOffline: boolean;
  fetchProfile: (userId: string) => Promise<void>;
  createProfile: (
    userId: string,
    name: string
  ) => Promise<CheckInProfile | null>;
  checkIn: (coords: { lat: number; lng: number } | null) => Promise<{
    success: boolean;
    offline: boolean;
  }>;
  syncPendingCheckIns: () => Promise<{ synced: number; failed: number }>;
  refreshPendingCount: () => Promise<void>;
  clearProfile: () => void;
}

export const useCheckInStore = create<CheckInState>((set, get) => ({
  profile: null,
  isLoading: false,
  error: null,
  pendingCount: 0,
  lastCheckInWasOffline: false,

  fetchProfile: async (userId: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase
        .from("check_in_profiles")
        .select("*")
        .eq("owner_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          set({ profile: null, isLoading: false });
          return;
        }
        throw error;
      }

      set({ profile: data, isLoading: false });

      // Also refresh pending count
      get().refreshPendingCount();
    } catch (error) {
      console.error("Error fetching check-in profile:", error);
      set({
        error:
          error instanceof Error ? error.message : "Failed to fetch profile",
        isLoading: false,
      });
    }
  },

  createProfile: async (userId: string, name: string) => {
    try {
      set({ isLoading: true, error: null });

      const { data: existingProfile } = await supabase
        .from("check_in_profiles")
        .select("*")
        .eq("owner_id", userId)
        .maybeSingle();

      if (existingProfile) {
        set({ profile: existingProfile, isLoading: false });
        return existingProfile;
      }

      const now = new Date();
      const nextDeadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const { data, error } = await supabase
        .from("check_in_profiles")
        .insert({
          owner_id: userId,
          name: name,
          interval_hours: 24,
          next_deadline: nextDeadline.toISOString(),
          is_active: true,
          is_paused: false,
        })
        .select()
        .single();

      if (error) {
        if (error.code === "23505") {
          const { data: existing } = await supabase
            .from("check_in_profiles")
            .select("*")
            .eq("owner_id", userId)
            .single();

          if (existing) {
            set({ profile: existing, isLoading: false });
            return existing;
          }
        }
        throw error;
      }

      set({ profile: data, isLoading: false });
      return data;
    } catch (error) {
      console.error("Error creating check-in profile:", error);
      set({
        error:
          error instanceof Error ? error.message : "Failed to create profile",
        isLoading: false,
      });
      return null;
    }
  },

  checkIn: async (coords) => {
    const { profile } = get();

    if (!profile) {
      set({ error: "No profile found" });
      return { success: false, offline: false };
    }

    const now = new Date();
    const nextDeadline = new Date(
      now.getTime() + profile.interval_hours * 60 * 60 * 1000
    );

    try {
      set({ isLoading: true, error: null });

      const { data, error } = await supabase.rpc("atomic_check_in", {
        p_profile_id: profile.id,
        p_checked_in_at: now.toISOString(),
        p_next_deadline: nextDeadline.toISOString(),
        p_was_offline: false,
        p_lat: coords?.lat ?? null,
        p_lng: coords?.lng ?? null,
      });

      if (error) {
        throw error;
      }

      const updatedProfile = Array.isArray(data) ? data[0] : data;

      if (!updatedProfile) {
        throw new Error("No profile returned from check-in");
      }

      set({
        profile: updatedProfile,
        isLoading: false,
        lastCheckInWasOffline: false,
      });
      return { success: true, offline: false };
    } catch (error) {
      console.error("Check-in failed, saving offline:", error);

      // Save to offline queue
      await addToQueue({
        profileId: profile.id,
        checkedInAt: now.toISOString(),
        nextDeadline: nextDeadline.toISOString(),
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      });

      // Optimistically update local state
      set({
        profile: {
          ...profile,
          last_check_in_at: now.toISOString(),
          next_deadline: nextDeadline.toISOString(),
          last_known_lat: coords?.lat ?? profile.last_known_lat,
          last_known_lng: coords?.lng ?? profile.last_known_lng,
        },
        isLoading: false,
        lastCheckInWasOffline: true,
        error: null,
      });

      get().refreshPendingCount();

      return { success: true, offline: true };
    }
  },

  syncPendingCheckIns: async () => {
    const queue = await getQueue();
    let synced = 0;
    let failed = 0;

    for (const pending of queue) {
      try {
        const { error } = await supabase.rpc("atomic_check_in", {
          p_profile_id: pending.profileId,
          p_checked_in_at: pending.checkedInAt,
          p_next_deadline: pending.nextDeadline,
          p_was_offline: true,
          p_lat: pending.lat,
          p_lng: pending.lng,
        });

        if (error) throw error;

        await removeFromQueue(pending.id);
        synced++;
      } catch (error) {
        console.error("Failed to sync pending check-in:", error);
        failed++;
      }
    }

    get().refreshPendingCount();

    return { synced, failed };
  },

  refreshPendingCount: async () => {
    const count = await getQueueCount();
    set({ pendingCount: count });
  },

  clearProfile: () => {
    set({
      profile: null,
      isLoading: false,
      error: null,
      pendingCount: 0,
      lastCheckInWasOffline: false,
    });
  },
}));
```

**Step 2: Commit**

```bash
git add stores/checkin.ts
git commit -m "feat: update check-in store with GPS coords and offline queue"
```

---

## Task 7: Create LocationBanner Component

**Files:**
- Create: `components/LocationBanner.tsx`

**Step 1: Create the component**

```typescript
// components/LocationBanner.tsx
import { View, Text, Pressable, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface LocationBannerProps {
  onRequestPermission: () => void;
}

export function LocationBanner({ onRequestPermission }: LocationBannerProps) {
  const openSettings = () => {
    if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    } else {
      Linking.openSettings();
    }
  };

  return (
    <View className="mx-4 mb-4 bg-peach/30 border border-peach rounded-2xl p-4">
      <View className="flex-row items-center mb-2">
        <Ionicons name="location-outline" size={20} color="#FF6B5B" />
        <Text className="text-charcoal font-semibold ml-2">
          Poloha není povolena
        </Text>
      </View>
      <Text className="text-muted text-sm mb-3">
        Pro větší bezpečí povolte přístup k poloze. Strážci uvidí kde jste byli
        při posledním hlášení.
      </Text>
      <Pressable
        onPress={openSettings}
        className="bg-coral rounded-xl py-2 px-4 self-start"
      >
        <Text className="text-white font-medium">Otevřít nastavení</Text>
      </Pressable>
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add components/LocationBanner.tsx
git commit -m "feat: add LocationBanner component for GPS permission prompt"
```

---

## Task 8: Create OfflineBanner Component

**Files:**
- Create: `components/OfflineBanner.tsx`

**Step 1: Create the component**

```typescript
// components/OfflineBanner.tsx
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface OfflineBannerProps {
  pendingCount: number;
  onSync: () => void;
  isSyncing: boolean;
}

export function OfflineBanner({
  pendingCount,
  onSync,
  isSyncing,
}: OfflineBannerProps) {
  if (pendingCount === 0) return null;

  return (
    <View className="mx-4 mb-4 bg-sand border border-muted/30 rounded-2xl p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <Ionicons name="cloud-offline-outline" size={20} color="#8B7F7A" />
          <Text className="text-charcoal ml-2 flex-1">
            {pendingCount} {pendingCount === 1 ? "hlášení čeká" : "hlášení čekají"}{" "}
            na odeslání
          </Text>
        </View>
        <Pressable
          onPress={onSync}
          disabled={isSyncing}
          className={`bg-coral rounded-xl py-2 px-4 ${isSyncing ? "opacity-50" : ""}`}
        >
          <Text className="text-white font-medium">
            {isSyncing ? "Odesílám..." : "Odeslat"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add components/OfflineBanner.tsx
git commit -m "feat: add OfflineBanner component for pending check-ins"
```

---

## Task 9: Update Main Check-in Screen

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Step 1: Replace with updated version**

```typescript
// app/(tabs)/index.tsx
import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  Animated,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { useCountdown } from "@/hooks/useCountdown";
import { useLocation } from "@/hooks/useLocation";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { LocationBanner } from "@/components/LocationBanner";
import { OfflineBanner } from "@/components/OfflineBanner";

export default function CheckInScreen() {
  const { user } = useAuth();
  const {
    profile,
    isLoading,
    pendingCount,
    lastCheckInWasOffline,
    fetchProfile,
    checkIn,
    syncPendingCheckIns,
    refreshPendingCount,
  } = useCheckInStore();
  const countdown = useCountdown(profile?.next_deadline ?? null);
  const { permissionStatus, getCurrentPosition, requestPermission } =
    useLocation();
  const { isConnected } = useNetworkStatus();

  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showOfflineToast, setShowOfflineToast] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideToastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const toastAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // Fetch profile on mount
  useEffect(() => {
    if (user?.id) {
      fetchProfile(user.id);
    }
  }, [user?.id]);

  // Redirect to profile-setup if no profile exists
  useEffect(() => {
    if (user && !isLoading && profile === null) {
      router.replace("/(tabs)/profile-setup");
    }
  }, [user, isLoading, profile]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isConnected && pendingCount > 0) {
      handleSync();
    }
  }, [isConnected]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
      if (hideToastTimeoutRef.current) clearTimeout(hideToastTimeoutRef.current);
      if (toastAnimRef.current) toastAnimRef.current.stop();
    };
  }, []);

  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </SafeAreaView>
    );
  }

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      friction: 3,
      tension: 40,
      useNativeDriver: true,
    }).start();
  };

  const showToastMessage = (isOffline: boolean) => {
    setShowToast(true);
    setShowOfflineToast(isOffline);

    if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    if (hideToastTimeoutRef.current) clearTimeout(hideToastTimeoutRef.current);
    if (toastAnimRef.current) toastAnimRef.current.stop();

    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    successTimeoutRef.current = setTimeout(() => {
      setShowSuccess(false);
    }, 1500);

    hideToastTimeoutRef.current = setTimeout(() => {
      toastAnimRef.current = Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      });
      toastAnimRef.current.start(() => {
        setShowToast(false);
        setShowOfflineToast(false);
      });
    }, 3000);
  };

  const handleCheckIn = async () => {
    if (isCheckingIn) return;

    setIsCheckingIn(true);

    // Try to get GPS coordinates (with 5s timeout)
    const coords = await getCurrentPosition(5000);

    const result = await checkIn(coords);

    if (result.success) {
      setShowSuccess(true);
      showToastMessage(result.offline);
    }

    setIsCheckingIn(false);
  };

  const handleSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    await syncPendingCheckIns();
    setIsSyncing(false);
  };

  if (isLoading && !profile) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </SafeAreaView>
    );
  }

  const renderButtonContent = () => {
    if (isCheckingIn) {
      return <ActivityIndicator size="large" color="#FFFFFF" />;
    }
    if (showSuccess) {
      return <Text className="text-white text-4xl">✓</Text>;
    }
    return (
      <Text className="text-white text-xl font-bold">Hlásím se!</Text>
    );
  };

  const getToastMessage = () => {
    if (showOfflineToast) {
      return "Uloženo, odešleme až budete online";
    }
    return "Hlášení úspěšně odesláno!";
  };

  const getToastStyle = () => {
    if (showOfflineToast) {
      return "bg-sand border-muted/30";
    }
    return "bg-success/20 border-success";
  };

  const getToastTextStyle = () => {
    if (showOfflineToast) {
      return "text-charcoal";
    }
    return "text-success";
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Banners */}
        <View className="pt-4">
          {permissionStatus === "denied" && (
            <LocationBanner onRequestPermission={requestPermission} />
          )}
          <OfflineBanner
            pendingCount={pendingCount}
            onSync={handleSync}
            isSyncing={isSyncing}
          />
        </View>

        {/* Main content */}
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-charcoal text-2xl font-semibold mb-4">
            Ahoj, {profile.name}!
          </Text>
          <Text className="text-muted text-center mb-8">
            {countdown.isExpired
              ? "Zmáčkni tlačítko a dej vědět, že jsi v pořádku!"
              : "Zmáčkni tlačítko a dej vědět, že jsi v pořádku"}
          </Text>

          <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
            <Pressable
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              onPress={handleCheckIn}
              disabled={isCheckingIn}
              className="bg-coral w-48 h-48 rounded-full items-center justify-center"
              style={{
                shadowColor: "#FF6B5B",
                shadowOffset: { width: 0, height: 8 },
                shadowOpacity: 0.4,
                shadowRadius: 16,
                elevation: 8,
              }}
            >
              {renderButtonContent()}
            </Pressable>
          </Animated.View>

          <View className="mt-8 items-center">
            <Text className="text-muted mb-1">
              {countdown.isExpired ? "Čas překročen o:" : "Další hlášení za:"}
            </Text>
            <Text
              className={`text-2xl font-semibold ${
                countdown.isExpired ? "text-coral" : "text-charcoal"
              }`}
            >
              {countdown.formatted}
            </Text>
          </View>

          {/* Connection status indicator */}
          {isConnected === false && (
            <View className="mt-4 flex-row items-center">
              <View className="w-2 h-2 rounded-full bg-muted mr-2" />
              <Text className="text-muted text-sm">Offline</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Toast */}
      {showToast && (
        <Animated.View
          style={{
            opacity: toastOpacity,
            position: "absolute",
            bottom: 40,
            left: 24,
            right: 24,
          }}
        >
          <View className={`${getToastStyle()} border rounded-2xl py-4 px-6`}>
            <Text className={`${getToastTextStyle()} text-center font-semibold`}>
              {getToastMessage()}
            </Text>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}
```

**Step 2: Commit**

```bash
git add app/\(tabs\)/index.tsx
git commit -m "feat: update check-in screen with GPS and offline support"
```

---

## Task 10: Create Edge Function for Deadline Checking

**Files:**
- Create: `supabase/functions/check-deadlines/index.ts`

**Step 1: Create supabase functions directory structure**

```bash
mkdir -p supabase/functions/check-deadlines
```

**Step 2: Create the Edge Function**

```typescript
// supabase/functions/check-deadlines/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface ExpiredProfile {
  id: string;
  owner_id: string;
  name: string;
  next_deadline: string;
  last_known_lat: number | null;
  last_known_lng: number | null;
}

interface Guardian {
  user_id: string;
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find expired profiles without active alerts
    const { data: expiredProfiles, error: profilesError } = await supabase
      .from("check_in_profiles")
      .select("id, owner_id, name, next_deadline, last_known_lat, last_known_lng")
      .lt("next_deadline", new Date().toISOString())
      .eq("is_active", true)
      .eq("is_paused", false)
      .returns<ExpiredProfile[]>();

    if (profilesError) {
      throw profilesError;
    }

    if (!expiredProfiles || expiredProfiles.length === 0) {
      return new Response(
        JSON.stringify({ message: "No expired profiles found", alertsCreated: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let alertsCreated = 0;

    for (const profile of expiredProfiles) {
      // Check if there's already an active alert for this profile
      const { data: existingAlert } = await supabase
        .from("alerts")
        .select("id")
        .eq("check_in_profile_id", profile.id)
        .is("resolved_at", null)
        .single();

      if (existingAlert) {
        // Already has an active alert, skip
        continue;
      }

      // Get guardians for this profile
      const { data: guardians } = await supabase
        .from("guardians")
        .select("user_id")
        .eq("check_in_profile_id", profile.id)
        .returns<Guardian[]>();

      const guardianIds = guardians?.map((g) => g.user_id) || [];

      // Create alert
      const { error: alertError } = await supabase.from("alerts").insert({
        check_in_profile_id: profile.id,
        triggered_at: new Date().toISOString(),
        alert_type: "push",
        notified_guardians: guardianIds,
      });

      if (alertError) {
        console.error(`Failed to create alert for profile ${profile.id}:`, alertError);
        continue;
      }

      alertsCreated++;

      // TODO: In Slice 6, send push notifications to guardians here
      console.log(
        `Alert created for profile ${profile.name} (${profile.id}), guardians: ${guardianIds.join(", ")}`
      );
    }

    return new Response(
      JSON.stringify({
        message: "Deadline check completed",
        profilesChecked: expiredProfiles.length,
        alertsCreated,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in check-deadlines function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
```

**Step 3: Commit**

```bash
git add supabase/functions/check-deadlines/index.ts
git commit -m "feat: add Edge Function for deadline checking and alert creation"
```

---

## Task 11: Create Cron Job Configuration

**Files:**
- Create: `docs/migrations/cron_check_deadlines.sql`

**Step 1: Create cron job SQL**

```sql
-- Migration: Cron job for deadline checking
-- Run this in Supabase SQL Editor after enabling pg_cron extension

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Create cron job to call Edge Function every 5 minutes
SELECT cron.schedule(
  'check-deadlines-job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/check-deadlines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- To verify the job is scheduled:
-- SELECT * FROM cron.job;

-- To unschedule (if needed):
-- SELECT cron.unschedule('check-deadlines-job');
```

**Step 2: Create alternative config doc**

```markdown
<!-- docs/migrations/cron_setup_instructions.md -->
# Cron Job Setup for check-deadlines

## Option 1: Using Supabase Dashboard (Recommended for MVP)

1. Go to Supabase Dashboard > Database > Extensions
2. Enable `pg_cron` and `pg_net` extensions
3. Go to SQL Editor and run:

\`\`\`sql
SELECT cron.schedule(
  'check-deadlines-job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/check-deadlines',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
\`\`\`

## Option 2: Using External Cron (Alternative)

Use services like:
- Vercel Cron Jobs
- GitHub Actions scheduled workflows
- AWS EventBridge

Example GitHub Action:
\`\`\`yaml
name: Check Deadlines
on:
  schedule:
    - cron: '*/5 * * * *'
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/check-deadlines \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
\`\`\`

## Verify Cron Job

\`\`\`sql
SELECT * FROM cron.job;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
\`\`\`
```

**Step 3: Commit**

```bash
git add docs/migrations/cron_check_deadlines.sql docs/migrations/cron_setup_instructions.md
git commit -m "docs: add cron job setup for deadline checking"
```

---

## Task 12: Deploy Edge Function

**Step 1: Install Supabase CLI (if not installed)**

```bash
brew install supabase/tap/supabase
```

**Step 2: Login to Supabase**

```bash
supabase login
```

**Step 3: Link project**

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

**Step 4: Deploy function**

```bash
supabase functions deploy check-deadlines
```

**Step 5: Test function**

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/check-deadlines \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"
```

Expected: `{"message":"No expired profiles found","alertsCreated":0}` or similar

---

## Task 13: Final Testing

**Step 1: Test GPS permission flow**

1. Run app: `npx expo start`
2. Deny location permission when prompted
3. Verify LocationBanner appears
4. Tap "Otevřít nastavení" - should open app settings

**Step 2: Test check-in with GPS**

1. Allow location permission
2. Tap "Hlásím se!"
3. Verify check-in succeeds
4. Check Supabase: `check_ins` table should have `lat/lng` values

**Step 3: Test offline check-in**

1. Enable airplane mode
2. Tap "Hlásím se!"
3. Verify toast shows "Uloženo, odešleme až budete online"
4. Verify OfflineBanner appears with pending count
5. Disable airplane mode
6. Verify auto-sync or manual sync works

**Step 4: Test deadline alert creation**

1. In Supabase, manually set a profile's `next_deadline` to past
2. Call Edge Function manually or wait for cron
3. Verify alert created in `alerts` table

---

## Task 14: Final Commit

**Step 1: Verify all changes**

```bash
git status
```

**Step 2: Final commit if needed**

```bash
git add -A
git commit -m "feat: complete Slice 4 check-in logic implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Install NetInfo | package.json |
| 2 | useLocation hook | hooks/useLocation.ts |
| 3 | Offline queue | lib/offlineQueue.ts |
| 4 | useNetworkStatus hook | hooks/useNetworkStatus.ts |
| 5 | Update RPC with GPS | docs/migrations/atomic_check_in_v2.sql |
| 6 | Update check-in store | stores/checkin.ts |
| 7 | LocationBanner component | components/LocationBanner.tsx |
| 8 | OfflineBanner component | components/OfflineBanner.tsx |
| 9 | Update main screen | app/(tabs)/index.tsx |
| 10 | Edge Function | supabase/functions/check-deadlines/index.ts |
| 11 | Cron job config | docs/migrations/cron_*.sql |
| 12 | Deploy Edge Function | - |
| 13 | Testing | - |
| 14 | Final commit | - |
