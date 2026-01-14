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
  const [showOfflineToast, setShowOfflineToast] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    return <Text className="text-white text-xl font-bold">Hlásím se!</Text>;
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
