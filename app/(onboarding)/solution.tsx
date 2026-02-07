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
          <Text className="text-4xl font-semibold text-charcoal text-center mb-12 font-lora-semibold">
            Takhle to řešíme
          </Text>
        </Animated.View>

        <View>
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
                      size={26}
                      color={COLORS.white}
                      weight="bold"
                    />
                  </View>
                  {!isLast && <View style={styles.line} />}
                </View>

                {/* Content column */}
                <View className="flex-1 pb-8">
                  <Text className="text-xl font-semibold text-charcoal mb-1 font-lora-semibold">
                    {step.title}
                  </Text>
                  <Text className="text-lg text-muted leading-7 font-lora">
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
    width: 52,
    height: 52,
    borderRadius: 26,
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
