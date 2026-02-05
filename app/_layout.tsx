import "../global.css";
import { useEffect, useMemo } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingStore } from "@/stores/onboarding";
// RevenueCat temporarily disabled
// import { usePremiumStore } from "@/stores/premium";
import { useNotifications } from "@/hooks/useNotifications";
import { createTokenRegistrationTracker } from "@/utils/pushTokenRegistration";

function useProtectedRoute(
  user: any,
  isAuthLoading: boolean,
  hasSeenOnboarding: boolean | null,
  isOnboardingLoading: boolean
) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Wait for both auth and onboarding status to be loaded
    if (isAuthLoading || isOnboardingLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inOnboardingGroup = segments[0] === "(onboarding)";
    const inTabsGroup = segments[0] === "(tabs)";

    // PRIORITY 1: Logged in user should always go to tabs
    if (user && !inTabsGroup) {
      router.replace("/(tabs)");
      return;
    }

    // PRIORITY 2: Not logged in - check onboarding
    if (!user) {
      // First-time user (hasn't seen onboarding) -> onboarding
      if (hasSeenOnboarding === false && !inOnboardingGroup) {
        router.replace("/(onboarding)");
        return;
      }

      // Has seen onboarding but not logged in -> auth
      if (hasSeenOnboarding === true && !inAuthGroup) {
        router.replace("/(auth)/login");
        return;
      }
    }
  }, [user, isAuthLoading, hasSeenOnboarding, isOnboardingLoading]);
}

export default function RootLayout() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    hasSeenOnboarding,
    isLoading: isOnboardingLoading,
    checkOnboardingStatus,
  } = useOnboardingStore();
  const { requestPermissions, registerToken, expoPushToken, setNotificationResponseHandler } = useNotifications();
  // RevenueCat temporarily disabled
  // const { initialize: initializePremium } = usePremiumStore();
  const router = useRouter();

  // Create token registration tracker that persists across re-renders
  const tokenTracker = useMemo(
    () => createTokenRegistrationTracker(registerToken),
    [registerToken]
  );

  // Check onboarding status on mount only
  useEffect(() => {
    checkOnboardingStatus();
  }, []);

  // RevenueCat temporarily disabled
  // useEffect(() => {
  //   initializePremium();
  // }, []);

  // Request notification permissions when user is logged in
  useEffect(() => {
    if (user && !isAuthLoading) {
      requestPermissions();
    }
  }, [user, isAuthLoading]);

  // Register push token when available and user is logged in
  // The tracker automatically handles logout/login cycles
  useEffect(() => {
    tokenTracker.update({
      userId: user?.id ?? null,
      expoPushToken,
    });
  }, [user, expoPushToken, tokenTracker]);

  // Handle notification tap - navigate to guardians screen
  useEffect(() => {
    setNotificationResponseHandler((data) => {
      if (data.type === "alert") {
        // Navigate to guardians tab where watched profiles are shown
        router.push("/(tabs)/guardians");
      }
    });
  }, [router]);

  useProtectedRoute(user, isAuthLoading, hasSeenOnboarding, isOnboardingLoading);

  // Show loading while either auth or onboarding is loading
  if (isAuthLoading || isOnboardingLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </GestureHandlerRootView>
  );
}
