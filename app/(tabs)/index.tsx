import { useEffect, useState, useRef } from "react";
import { View, Text, Pressable, Animated, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { useCountdown } from "@/hooks/useCountdown";

export default function CheckInScreen() {
  const { user } = useAuth();
  const { profile, isLoading, fetchProfile, checkIn } = useCheckInStore();
  const countdown = useCountdown(profile?.next_deadline ?? null);

  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hideToastTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const toastAnimRef = useRef<Animated.CompositeAnimation | null>(null);

  // Fetch profile on mount (only if user is logged in)
  useEffect(() => {
    if (user?.id) {
      fetchProfile(user.id);
    }
  }, [user?.id]);

  // Redirect to profile-setup if no profile exists after loading
  // But only if user is actually logged in
  useEffect(() => {
    if (user && !isLoading && profile === null) {
      router.replace("/(tabs)/profile-setup");
    }
  }, [user, isLoading, profile]);

  // Cleanup timeouts and animations on unmount
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      if (hideToastTimeoutRef.current) {
        clearTimeout(hideToastTimeoutRef.current);
      }
      if (toastAnimRef.current) {
        toastAnimRef.current.stop();
      }
    };
  }, []);

  // Don't render anything if user is not logged in (root layout will redirect)
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

  const handleCheckIn = async () => {
    if (isCheckingIn) return;

    setIsCheckingIn(true);
    const success = await checkIn();

    if (success) {
      setShowSuccess(true);
      setShowToast(true);

      // Clear any existing timeouts and animations
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
      }
      if (hideToastTimeoutRef.current) {
        clearTimeout(hideToastTimeoutRef.current);
      }
      if (toastAnimRef.current) {
        toastAnimRef.current.stop();
      }

      // Animate toast in
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      // Hide success checkmark after brief delay
      successTimeoutRef.current = setTimeout(() => {
        setShowSuccess(false);
      }, 1500);

      // Hide toast after 3 seconds
      hideToastTimeoutRef.current = setTimeout(() => {
        toastAnimRef.current = Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        });
        toastAnimRef.current.start(() => {
          setShowToast(false);
        });
      }, 3000);
    }

    setIsCheckingIn(false);
  };

  // Show loading state while fetching profile
  if (isLoading && !profile) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </SafeAreaView>
    );
  }

  // Don't render if redirecting to profile setup
  if (!profile) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </SafeAreaView>
    );
  }

  const getSubtitle = () => {
    if (countdown.isExpired) {
      return "Zmáčkni tlačítko a dej vědět, že jsi v pořádku!";
    }
    return "Zmáčkni tlačítko a dej vědět, že jsi v pořádku";
  };

  const renderButtonContent = () => {
    if (isCheckingIn) {
      return <ActivityIndicator size="large" color="#FFFFFF" />;
    }
    if (showSuccess) {
      return <Text className="text-white text-4xl">✓</Text>;
    }
    return (
      <Text className="text-white text-xl font-bold">
        Hlásím se!
      </Text>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-2xl font-semibold mb-4">
          Ahoj, {profile.name}!
        </Text>
        <Text className="text-muted text-center mb-8">
          {getSubtitle()}
        </Text>

        <Animated.View
          style={{
            transform: [{ scale: scaleAnim }],
          }}
        >
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
      </View>

      {/* Success Toast */}
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
          <View className="bg-success/20 border border-success rounded-2xl py-4 px-6">
            <Text className="text-success text-center font-semibold">
              Hlášení úspěšně odesláno!
            </Text>
          </View>
        </Animated.View>
      )}
    </SafeAreaView>
  );
}
