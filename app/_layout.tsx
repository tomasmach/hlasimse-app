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
    // Wait for both auth and onboarding status to be loaded
    if (isAuthLoading || isOnboardingLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inOnboardingGroup = segments[0] === "(onboarding)";

    // First-time user (hasn't seen onboarding) -> onboarding
    if (!hasSeenOnboarding && !inOnboardingGroup) {
      router.replace("/(onboarding)");
      return;
    }

    // Has seen onboarding but not logged in -> auth
    if (hasSeenOnboarding && !user && !inAuthGroup) {
      router.replace("/(auth)/login");
      return;
    }

    // Logged in user accessing onboarding or auth -> redirect to tabs
    if (user && (inAuthGroup || inOnboardingGroup)) {
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

  // Check onboarding status on mount
  useEffect(() => {
    checkOnboardingStatus();
  }, [checkOnboardingStatus]);

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
