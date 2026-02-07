import { useEffect, useState, useCallback } from "react";
import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Animated, { FadeIn } from "react-native-reanimated";
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

// Time-based greeting helper
const getGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return "Dobré ráno";
  if (hour >= 12 && hour < 18) return "Dobré odpoledne";
  return "Dobrý večer";
};

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
  const [isSyncing, setIsSyncing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: "success" | "info" | "warning" | "error";
  }>({ visible: false, message: "", type: "info" });

  const handleToastDismiss = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const handleDismissSuccessOverlay = useCallback(() => {
    setShowSuccessOverlay(false);
  }, []);

  const handleSync = useCallback(async () => {
    setIsSyncing(true);
    await syncPendingCheckIns();
    setIsSyncing(false);
  }, [syncPendingCheckIns]);

  // Fetch profile on mount
  useEffect(() => {
    if (user?.id) {
      fetchProfile(user.id);
    }
  }, [user?.id, fetchProfile]);

  // Redirect to profile-setup if no profile exists after loading
  useEffect(() => {
    if (user && hasFetched && profile === null) {
      router.replace("/(tabs)/profile-setup");
    }
  }, [user, hasFetched, profile]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isConnected && pendingCount > 0) {
      handleSync();
    }
  }, [isConnected, pendingCount, handleSync]);

  // Reset success state after a delay
  useEffect(() => {
    if (showSuccess) {
      const timer = setTimeout(() => {
        setShowSuccess(false);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [showSuccess]);

  const showToastMessage = (type: "info" | "error", message: string) => {
    setToast({ visible: true, message, type });
  };

  const handleCheckIn = async () => {
    if (isCheckingIn) return;

    setIsCheckingIn(true);

    // Try to get GPS coordinates (with 5s timeout)
    const coords = await getCurrentPosition(5000);

    const result = await checkIn(coords);

    if (result.success) {
      setShowSuccess(true);
      if (result.offline) {
        showToastMessage("info", "Máme to! Pošleme hned, až bude signál.");
      } else {
        setShowSuccessOverlay(true);
      }
    } else {
      showToastMessage("error", "Nepodařilo se odeslat. Zkuste to znovu.");
    }

    setIsCheckingIn(false);
  };

  // Show loading state while waiting for user, profile fetch, or missing profile
  if (!user || !hasFetched || (isLoading && !profile) || !profile) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color={COLORS.coral.default} />
      </SafeAreaView>
    );
  }

  // Parse countdown values for display
  const countdownParts = countdown.formatted.split(":");
  const hours = countdownParts[0] || "00";
  const minutes = countdownParts[1] || "00";
  const seconds = countdownParts[2] || "00";

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      {/* Banners */}
      <View className="pt-2">
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
      <View className="flex-1 items-center justify-center" style={{ paddingHorizontal: SPACING.page }}>
        {/* Greeting */}
        <Animated.View entering={FadeIn.duration(600)} className="items-center mb-2">
          <Text className="text-xl font-lora text-muted">{getGreeting()},</Text>
          <Text className="text-[32px] font-lora-bold text-charcoal">{profile.name}!</Text>
        </Animated.View>

        {/* Subtitle */}
        <Animated.Text
          entering={FadeIn.duration(600).delay(100)}
          className="text-base text-muted text-center mb-10 leading-6 font-lora"
        >
          {countdown.isExpired
            ? "Zmáčkni tlačítko a dej vědět, že jsi v pořádku!"
            : "Zmáčkni tlačítko a dej vědět, že jsi v pořádku"}
        </Animated.Text>

        {/* Hero Button */}
        <Animated.View entering={FadeIn.duration(600).delay(200)} className="mb-12">
          <HeroButton
            onPress={handleCheckIn}
            isLoading={isCheckingIn}
            showSuccess={showSuccess}
            disabled={isCheckingIn}
          />
        </Animated.View>

        {/* Countdown */}
        <Animated.View entering={FadeIn.duration(600).delay(300)} className="items-center">
          <Text className="text-sm font-lora-medium text-muted mb-3 uppercase tracking-wider">
            {countdown.isExpired ? "Čas překročen o:" : "Další hlášení za:"}
          </Text>
          <View className="flex-row items-start">
            {/* Hours */}
            <View className="items-center min-w-[56px]">
              <Text style={styles.countdownNumber} className={countdown.isExpired ? 'text-coral' : 'text-charcoal'}>
                {hours}
              </Text>
              <Text className="text-xs font-lora-medium text-muted -mt-1 uppercase tracking-wide">hod</Text>
            </View>

            <Text style={styles.countdownSeparator} className={countdown.isExpired ? 'text-coral' : 'text-charcoal'}>:</Text>

            {/* Minutes */}
            <View className="items-center min-w-[56px]">
              <Text style={styles.countdownNumber} className={countdown.isExpired ? 'text-coral' : 'text-charcoal'}>
                {minutes}
              </Text>
              <Text className="text-xs font-lora-medium text-muted -mt-1 uppercase tracking-wide">min</Text>
            </View>

            <Text style={styles.countdownSeparator} className={countdown.isExpired ? 'text-coral' : 'text-charcoal'}>:</Text>

            {/* Seconds */}
            <View className="items-center min-w-[56px]">
              <Text style={styles.countdownNumber} className={countdown.isExpired ? 'text-coral' : 'text-charcoal'}>
                {seconds}
              </Text>
              <Text className="text-xs font-lora-medium text-muted -mt-1 uppercase tracking-wide">sek</Text>
            </View>
          </View>
        </Animated.View>

        {/* Connection status indicator */}
        {isConnected === false && (
          <Animated.View entering={FadeIn.duration(300)} className="flex-row items-center mt-6">
            <View className="w-2 h-2 rounded-full bg-muted mr-2" />
            <Text className="text-sm text-muted font-lora">Offline</Text>
          </Animated.View>
        )}
      </View>

      {/* Bottom padding for floating tab bar */}
      <View className="h-[100px]" />

      {/* Toast for offline/error states */}
      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
        onDismiss={handleToastDismiss}
        duration={3000}
      />

      {/* Success overlay for online check-ins */}
      <SuccessOverlay
        visible={showSuccessOverlay}
        onDismiss={handleDismissSuccessOverlay}
        intervalHours={profile?.interval_hours || 24}
      />
    </SafeAreaView>
  );
}

// Keep only styles that need specific values (fontSize, fontVariant, margins)
const styles = StyleSheet.create({
  countdownNumber: {
    fontSize: 48,
    fontWeight: "bold",
    fontVariant: ["tabular-nums"],
  },
  countdownSeparator: {
    fontSize: 48,
    fontWeight: "bold",
    marginHorizontal: 4,
    marginTop: -2,
  },
});
