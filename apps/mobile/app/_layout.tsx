import "../global.css";
import { useEffect, useMemo } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFonts } from "expo-font";
import {
  Lora_400Regular,
  Lora_500Medium,
  Lora_600SemiBold,
  Lora_700Bold,
} from "@expo-google-fonts/lora";
import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from "@expo-google-fonts/instrument-sans";
import { useAuth } from "@/hooks/useAuth";
import { COLORS } from "@/constants/design";
import { useOnboardingStore } from "@/stores/onboarding";
import { useNotifications } from "@/hooks/useNotifications";
import { createTokenRegistrationTracker } from "@/utils/pushTokenRegistration";
import { notificationDestination } from "@/lib/notificationRouting";

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
  const [fontsLoaded] = useFonts({
    Lora_400Regular,
    Lora_500Medium,
    Lora_600SemiBold,
    Lora_700Bold,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    Satoshi_400Regular: require("@/assets/fonts/satoshi/Satoshi-Regular.ttf"),
    Satoshi_500Medium: require("@/assets/fonts/satoshi/Satoshi-Medium.ttf"),
    Satoshi_700Bold: require("@/assets/fonts/satoshi/Satoshi-Bold.ttf"),
  });

  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    hasSeenOnboarding,
    isLoading: isOnboardingLoading,
    checkOnboardingStatus,
  } = useOnboardingStore();
  const { registerToken, expoPushToken, setNotificationResponseHandler } = useNotifications();
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

  // Register push token when available and user is logged in
  // The tracker automatically handles logout/login cycles
  useEffect(() => {
    tokenTracker.update({
      userId: user?.id ?? null,
      expoPushToken,
    });
  }, [user, expoPushToken, tokenTracker]);

  // Consume notification responses only after account restoration and navigation are ready.
  useEffect(() => {
    if (isAuthLoading || !user) return;
    setNotificationResponseHandler((data) => {
      const destination = notificationDestination(data);
      if (destination?.kind === "incident") {
        router.push({ pathname: "/(tabs)/incident/[id]", params: { id: destination.incidentId } });
      } else if (destination?.kind === "reminder") {
        router.push("/(tabs)");
      }
    });
    return () => setNotificationResponseHandler(null);
  }, [router, user?.id, isAuthLoading, setNotificationResponseHandler]);

  useProtectedRoute(user, isAuthLoading, hasSeenOnboarding, isOnboardingLoading);

  // Show loading while fonts, auth, or onboarding is loading
  if (!fontsLoaded || isAuthLoading || isOnboardingLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color={COLORS.coral.default} />
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
