import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { ShieldWarning } from "phosphor-react-native";
import { AuthButton } from "@/components/auth";
import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { useOnboardingPersona } from "@/components/onboarding/useOnboardingPersona";
import { SOLUTION_STEPS } from "@/constants/onboarding";
import { COLORS } from "@/constants/design";

export default function SolutionScreen() {
  const { selectedPersona, loading } = useOnboardingPersona();

  if (loading || !selectedPersona) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream" testID="onboarding-solution-loading">
        <ActivityIndicator color={COLORS.charcoal.default} />
      </SafeAreaView>
    );
  }

  const steps = SOLUTION_STEPS[selectedPersona];

  return (
    <OnboardingFrame
      step={2}
      testID="onboarding-solution-screen"
      title="Tři kroky. Server je rozhodčí."
      intro="Aplikace rozlišuje požadavek v telefonu od check-inu skutečně potvrzeného serverem."
      footer={
        <AuthButton
          label="Vyzkoušet nanečisto"
          onPress={() => router.push("/(onboarding)/demo")}
          testID="onboarding-solution-continue-button"
        />
      }
    >
      <View testID="onboarding-solution-steps">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <Animated.View
              key={step.title}
              entering={FadeInDown.delay(80 + index * 90)
                .duration(380)
                .reduceMotion(ReduceMotion.System)}
              className="flex-row border-t border-sand py-6"
              accessible
              accessibilityLabel={`Krok ${index + 1}. ${step.title}. ${step.description}`}
              testID={`onboarding-solution-step-${index + 1}`}
            >
              <View className="mr-4 h-12 w-12 items-center justify-center rounded-[16px] bg-charcoal" importantForAccessibility="no">
                <Icon size={24} color={COLORS.cream.default} weight="regular" />
              </View>
              <View className="flex-1" importantForAccessibility="no-hide-descendants">
                <Text className="font-body-semibold text-[18px] leading-6 text-charcoal">
                  {step.title}
                </Text>
                <Text className="mt-2 font-body text-[15px] leading-6 text-muted">
                  {step.description}
                </Text>
              </View>
            </Animated.View>
          );
        })}
      </View>
      <View className="mb-2 mt-3 flex-row items-start gap-3 rounded-[20px] bg-white p-5">
        <ShieldWarning size={24} color="#9E382E" weight="regular" />
        <Text className="flex-1 font-body text-sm leading-5 text-muted">
          Incident ani push není potvrzení nouze. Služba nekontaktuje tísňovou linku a doručení upozornění nelze garantovat.
        </Text>
      </View>
    </OnboardingFrame>
  );
}
