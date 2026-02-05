import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown, FadeInLeft } from "react-native-reanimated";
import { useOnboardingStore } from "@/stores/onboarding";
import { SOLUTION_STEPS } from "@/constants/onboarding";
import { COLORS, SHADOWS } from "@/constants/design";
import { GradientButton } from "@/components/ui";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

export default function SolutionScreen() {
  const { selectedPersona } = useOnboardingStore();

  if (!selectedPersona) return null;

  const steps = SOLUTION_STEPS[selectedPersona];

  return (
    <View className="flex-1 bg-cream">
      <ProgressDots currentStep={2} />

      <View className="flex-1 px-8 justify-center">
        <Animated.View entering={FadeInDown.duration(500)}>
          <Text className="text-3xl font-semibold text-charcoal text-center mb-12">
            Takhle to řešíme
          </Text>
        </Animated.View>

        <View className="gap-0">
          {steps.map((step, index) => {
            const Icon = step.icon;
            const isLast = index === steps.length - 1;
            return (
              <Animated.View
                key={index}
                entering={FadeInLeft.delay(400 + index * 200).duration(500)}
                className="flex-row"
              >
                {/* Timeline column */}
                <View className="items-center mr-4">
                  <View style={styles.iconCircle}>
                    <Icon
                      size={22}
                      color={COLORS.white}
                      weight="bold"
                    />
                  </View>
                  {!isLast && <View style={styles.line} />}
                </View>

                {/* Content column */}
                <View className="flex-1 pb-8">
                  <Text className="text-base font-semibold text-charcoal mb-1">
                    {step.title}
                  </Text>
                  <Text className="text-sm text-muted">
                    {step.description}
                  </Text>
                </View>
              </Animated.View>
            );
          })}
        </View>
      </View>

      <View className="px-8 pb-12">
        <GradientButton
          label="Chci to vidět"
          onPress={() => router.push("/(onboarding)/demo")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.coral.default,
    alignItems: "center",
    justifyContent: "center",
    ...SHADOWS.glow,
  },
  line: {
    width: 2,
    flex: 1,
    backgroundColor: COLORS.peach.light,
    marginVertical: 4,
  },
});
