import "../global.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppState, View, ActivityIndicator } from "react-native";
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
import { AccessGateScreen } from "@/components/AccessGateScreen";
import { checkClientRelease, supportsMobileReleaseGate } from "@/lib/clientGate";
import { ApiError, clearReleaseGate, isNetworkError, setReleaseGateHandler } from "@/lib/api";
import type { ClientGate } from "@/lib/clientRelease";

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
  const [releaseGate, setReleaseGate] = useState<ClientGate | null>(null);
  const [releaseChecked, setReleaseChecked] = useState(!supportsMobileReleaseGate());
  const [releaseRetrying, setReleaseRetrying] = useState(false);
  const [pushRegistrationRetry, setPushRegistrationRetry] = useState(0);
  const pushRegistrationFailures = useRef(0);
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

  useEffect(() => {
    if (!supportsMobileReleaseGate()) return;
    let active = true;
    setReleaseGateHandler((gate) => {
      if (!active) return;
      setReleaseGate((current) => current?.kind === "update" ? current : gate);
      setReleaseChecked(true);
    });
    checkClientRelease()
      .then((gate) => {
        if (active && gate) setReleaseGate(gate);
      })
      .catch((error) => {
        if (!isNetworkError(error)) console.warn("Release gate check failed", error);
      })
      .finally(() => {
        if (active) setReleaseChecked(true);
      });
    return () => {
      active = false;
      setReleaseGateHandler(null);
    };
  }, []);

  const retryReleaseGate = useCallback(async () => {
    setReleaseRetrying(true);
    try {
      const gate = await checkClientRelease();
      if (gate) {
        setReleaseGate(gate);
      } else {
        clearReleaseGate();
        setReleaseGate(null);
      }
    } catch {
      // The maintenance screen stays visible until the public config is reachable again.
    } finally {
      setReleaseRetrying(false);
    }
  }, []);

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
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    void tokenTracker.update({
      userId: user?.id ?? null,
      expoPushToken,
    }).then((registered) => {
      if (registered) pushRegistrationFailures.current = 0;
    }).catch((error) => {
      if (!active) return;
      const attempt = pushRegistrationFailures.current;
      const retryable = isNetworkError(error) || (error instanceof ApiError && (error.status === 429 || error.status >= 500));
      if (!retryable || attempt >= 6) return;
      pushRegistrationFailures.current += 1;
      const baseDelay = Math.min(30_000, 1_000 * (2 ** attempt));
      const delay = Math.round(baseDelay * (0.75 + Math.random() * 0.5));
      retryTimer = setTimeout(() => {
        if (active && AppState.currentState === "active") setPushRegistrationRetry((value) => value + 1);
      }, delay);
    });
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [user, expoPushToken, tokenTracker, pushRegistrationRetry]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && user?.id && expoPushToken) {
        pushRegistrationFailures.current = 0;
        setPushRegistrationRetry((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, [user?.id, expoPushToken]);

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
  if (!fontsLoaded || !releaseChecked || isAuthLoading || isOnboardingLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color={COLORS.coral.default} />
      </View>
    );
  }

  if (releaseGate) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar style="dark" />
        <AccessGateScreen
          gate={releaseGate}
          retrying={releaseRetrying}
          onRetry={retryReleaseGate}
        />
      </GestureHandlerRootView>
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
