import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeInDown,
  ReduceMotion,
  useReducedMotion,
} from "react-native-reanimated";
import { Check } from "phosphor-react-native";
import { AuthButton } from "@/components/auth";
import { MockNotification } from "@/components/onboarding/MockNotification";
import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { useOnboardingPersona } from "@/components/onboarding/useOnboardingPersona";
import { NOTIFICATION_MESSAGE } from "@/constants/onboarding";
import { COLORS } from "@/constants/design";

type DemoPhase = "initial" | "loading" | "result";

export default function DemoScreen() {
  const { selectedPersona, loading: personaLoading } = useOnboardingPersona();
  const reduceMotion = useReducedMotion();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [phase, setPhase] = useState<DemoPhase>("initial");
  const [notificationVisible, setNotificationVisible] = useState(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const runDemo = () => {
    if (phase !== "initial") return;
    setPhase("loading");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    timer.current = setTimeout(
      () => {
        setPhase("result");
        setNotificationVisible(true);
      },
      reduceMotion ? 100 : 650,
    );
  };

  if (personaLoading || !selectedPersona) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream" testID="onboarding-demo-loading">
        <ActivityIndicator color={COLORS.charcoal.default} />
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1">
      <MockNotification
        message={NOTIFICATION_MESSAGE[selectedPersona]}
        visible={notificationVisible}
        onHidden={() => setNotificationVisible(false)}
      />
      <OnboardingFrame
        step={3}
        testID="onboarding-demo-screen"
        title={phase === "result" ? "Nanečisto hotovo." : "Zkuste si hlavní gesto."}
        intro={
          phase === "result"
            ? "V ostré aplikaci se úspěch ukáže až po potvrzení serverem."
            : "Tahle ukázka nic neodesílá, nemění termín a nekontaktuje strážce."
        }
        footer={
          <AuthButton
            label="Pokračovat k účtu"
            onPress={() => router.push("/(onboarding)/signup")}
            disabled={phase !== "result"}
            testID="onboarding-demo-continue-button"
          />
        }
      >
        <View className="flex-1 items-center justify-center py-5">
          <Pressable
            onPress={runDemo}
            disabled={phase !== "initial"}
            className="h-[184px] w-[184px] items-center justify-center rounded-full bg-charcoal"
            accessibilityRole="button"
            accessibilityLabel={
              phase === "result"
                ? "Ukázkový check-in dokončen"
                : phase === "loading"
                  ? "Ukázkový check-in se zpracovává"
                  : "Spustit ukázkový check-in nanečisto"
            }
            accessibilityHint="Nic neodesílá na server ani strážcům"
            accessibilityState={{ disabled: phase !== "initial", busy: phase === "loading" }}
            testID="onboarding-demo-checkin-button"
          >
            {phase === "loading" ? (
              <ActivityIndicator size="large" color={COLORS.cream.default} />
            ) : phase === "result" ? (
              <Check size={60} color={COLORS.cream.default} weight="bold" />
            ) : (
              <>
                <Text className="font-display text-[28px] text-cream">Jsem OK</Text>
                <Text className="mt-2 font-body text-sm text-white/70">ukázka nanečisto</Text>
              </>
            )}
          </Pressable>

          <Animated.View
            entering={FadeInDown.delay(120).duration(360).reduceMotion(ReduceMotion.System)}
            className="mt-9 max-w-[320px]"
          >
            <Text className="text-center font-body text-[15px] leading-6 text-muted">
              Push je pouze jeden z pokusů o upozornění. Jeho doručení nelze garantovat.
            </Text>
          </Animated.View>
        </View>
      </OnboardingFrame>
    </View>
  );
}
