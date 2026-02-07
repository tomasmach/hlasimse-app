import { useState, useCallback, useRef, useEffect } from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import { useOnboardingStore } from "@/stores/onboarding";
import { NOTIFICATION_MESSAGE } from "@/constants/onboarding";
import { HeroButton } from "@/components/HeroButton";
import { GradientButton } from "@/components/ui";
import { MockNotification } from "@/components/onboarding/MockNotification";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

type DemoPhase = "initial" | "loading" | "success" | "notification" | "cta";

export default function DemoScreen() {
  const { selectedPersona } = useOnboardingStore();
  const [phase, setPhase] = useState<DemoPhase>("initial");
  const successTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const notificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handlePress = useCallback(() => {
    if (phase !== "initial") return;
    setPhase("loading");

    // Simulate check-in
    successTimeoutRef.current = setTimeout(() => {
      setPhase("success");
      // Show notification after success animation
      notificationTimeoutRef.current = setTimeout(() => {
        setPhase("notification");
      }, 1500);
    }, 800);
  }, [phase]);

  // Cleanup timeouts on unmount or when phase changes
  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) {
        clearTimeout(successTimeoutRef.current);
        successTimeoutRef.current = null;
      }
      if (notificationTimeoutRef.current) {
        clearTimeout(notificationTimeoutRef.current);
        notificationTimeoutRef.current = null;
      }
    };
  }, [phase]);

  const handleNotificationHidden = useCallback(() => {
    setPhase("cta");
  }, []);

  if (!selectedPersona) return null;

  const notificationMsg = NOTIFICATION_MESSAGE[selectedPersona];

  return (
    <View className="flex-1 bg-cream">
      <ProgressDots currentStep={3} />

      {/* Mock notification overlay */}
      <MockNotification
        message={notificationMsg}
        visible={phase === "notification"}
        onHidden={handleNotificationHidden}
      />

      <View className="flex-1 justify-center items-center px-8" style={{ marginTop: -80 }}>
        {/* Text container with fixed height to prevent layout shift */}
        <View className="items-center mb-12" style={{ minHeight: 100 }}>
          {phase === "initial" && (
            <Animated.View entering={FadeIn.duration(500)} className="items-center">
              <Text className="text-3xl font-semibold text-charcoal text-center font-lora-semibold">
                Zkuste to. Klepněte.
              </Text>
            </Animated.View>
          )}

          {(phase === "success" || phase === "notification") && (
            <Animated.View entering={FadeIn.duration(300)} className="items-center">
              <Text className="text-3xl font-semibold text-charcoal text-center font-lora-semibold">
                Právě jste se ohlásili!
              </Text>
            </Animated.View>
          )}

          {phase === "cta" && (
            <Animated.View entering={FadeIn.duration(500)} className="items-center">
              <Text className="text-3xl font-semibold text-charcoal text-center font-lora-semibold">
                Tohle uvidí vaši blízcí.{"\n"}Pokaždé.
              </Text>
            </Animated.View>
          )}
        </View>

        <HeroButton
          onPress={handlePress}
          isLoading={phase === "loading"}
          showSuccess={phase === "success" || phase === "notification" || phase === "cta"}
          disabled={phase !== "initial"}
        />
      </View>

      {phase === "cta" && (
        <Animated.View entering={FadeInUp.duration(500)} className="px-8 pb-12">
          <GradientButton
            label="Chci začít"
            onPress={() => router.push("/(onboarding)/signup")}
          />
        </Animated.View>
      )}
    </View>
  );
}
