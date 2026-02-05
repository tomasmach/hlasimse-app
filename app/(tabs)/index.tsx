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
    <SafeAreaView style={styles.container} edges={["top"]}>
      {/* Banners */}
      <View style={styles.bannersContainer}>
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
      <View style={styles.mainContent}>
        {/* Greeting */}
        <Animated.View entering={FadeIn.duration(600)} style={styles.greetingContainer}>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.userName}>{profile.name}!</Text>
        </Animated.View>

        {/* Subtitle */}
        <Animated.Text
          entering={FadeIn.duration(600).delay(100)}
          style={styles.subtitle}
        >
          {countdown.isExpired
            ? "Zmáčkni tlačítko a dej vědět, že jsi v pořádku!"
            : "Zmáčkni tlačítko a dej vědět, že jsi v pořádku"}
        </Animated.Text>

        {/* Hero Button */}
        <Animated.View entering={FadeIn.duration(600).delay(200)} style={styles.buttonContainer}>
          <HeroButton
            onPress={handleCheckIn}
            isLoading={isCheckingIn}
            showSuccess={showSuccess}
            disabled={isCheckingIn}
          />
        </Animated.View>

        {/* Countdown */}
        <Animated.View entering={FadeIn.duration(600).delay(300)} style={styles.countdownContainer}>
          <Text style={styles.countdownLabel}>
            {countdown.isExpired ? "Čas překročen o:" : "Další hlášení za:"}
          </Text>
          <View style={styles.countdownRow}>
            {/* Hours */}
            <View style={styles.countdownUnit}>
              <Text style={[styles.countdownNumber, countdown.isExpired && styles.countdownExpired]}>
                {hours}
              </Text>
              <Text style={styles.countdownUnitLabel}>hod</Text>
            </View>

            <Text style={[styles.countdownSeparator, countdown.isExpired && styles.countdownExpired]}>:</Text>

            {/* Minutes */}
            <View style={styles.countdownUnit}>
              <Text style={[styles.countdownNumber, countdown.isExpired && styles.countdownExpired]}>
                {minutes}
              </Text>
              <Text style={styles.countdownUnitLabel}>min</Text>
            </View>

            <Text style={[styles.countdownSeparator, countdown.isExpired && styles.countdownExpired]}>:</Text>

            {/* Seconds */}
            <View style={styles.countdownUnit}>
              <Text style={[styles.countdownNumber, countdown.isExpired && styles.countdownExpired]}>
                {seconds}
              </Text>
              <Text style={styles.countdownUnitLabel}>sek</Text>
            </View>
          </View>
        </Animated.View>

        {/* Connection status indicator */}
        {isConnected === false && (
          <Animated.View entering={FadeIn.duration(300)} style={styles.offlineIndicator}>
            <View style={styles.offlineDot} />
            <Text style={styles.offlineText}>Offline</Text>
          </Animated.View>
        )}
      </View>

      {/* Bottom padding for floating tab bar */}
      <View style={styles.bottomPadding} />

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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream.default,
  },
  bannersContainer: {
    paddingTop: 8,
  },
  mainContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACING.page,
  },
  greetingContainer: {
    alignItems: "center",
    marginBottom: 8,
  },
  greeting: {
    fontSize: 20,
    fontWeight: "500",
    color: COLORS.muted,
  },
  userName: {
    fontSize: 32,
    fontWeight: "bold",
    color: COLORS.charcoal.default,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.muted,
    textAlign: "center",
    marginBottom: 40,
    lineHeight: 24,
  },
  buttonContainer: {
    marginBottom: 48,
  },
  countdownContainer: {
    alignItems: "center",
  },
  countdownLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: COLORS.muted,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  countdownRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  countdownUnit: {
    alignItems: "center",
    minWidth: 56,
  },
  countdownNumber: {
    fontSize: 48,
    fontWeight: "bold",
    fontVariant: ["tabular-nums"],
    color: COLORS.charcoal.default,
  },
  countdownExpired: {
    color: COLORS.coral.default,
  },
  countdownUnitLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: COLORS.muted,
    marginTop: -4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  countdownSeparator: {
    fontSize: 48,
    fontWeight: "bold",
    color: COLORS.charcoal.default,
    marginHorizontal: 4,
    marginTop: -2,
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
  bottomPadding: {
    height: 100,
  },
});
