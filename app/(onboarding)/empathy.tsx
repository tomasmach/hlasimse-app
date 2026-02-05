import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { HeartHalf } from "phosphor-react-native";
import { useOnboardingStore } from "@/stores/onboarding";
import { EMPATHY_CONTENT } from "@/constants/onboarding";
import { COLORS } from "@/constants/design";
import { GradientButton } from "@/components/ui";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

function AnimatedWords({ text, delayMs = 30 }: { text: string; delayMs?: number }) {
  const words = text.split(" ");
  return (
    <View className="flex-row flex-wrap justify-center">
      {words.map((word, i) => (
        <Animated.Text
          key={i}
          entering={FadeIn.delay(300 + i * delayMs).duration(300)}
          className="text-xl text-charcoal-light leading-8"
        >
          {word}{" "}
        </Animated.Text>
      ))}
    </View>
  );
}

export default function EmpathyScreen() {
  const { selectedPersona, loadPersona } = useOnboardingStore();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (!selectedPersona) await loadPersona();
      setReady(true);
    };
    init();
  }, [selectedPersona, loadPersona]);

  if (!ready || !selectedPersona) return null;

  const content = EMPATHY_CONTENT[selectedPersona];

  return (
    <View className="flex-1 bg-cream">
      <ProgressDots currentStep={1} />

      <View className="flex-1 px-8 justify-center items-center">
        <Animated.View entering={FadeInDown.duration(600)}>
          <Text className="text-3xl font-semibold text-charcoal text-center mb-8">
            Víme, jaké to je
          </Text>
        </Animated.View>

        <View className="mb-10 px-2">
          <AnimatedWords text={content} />
        </View>

        <Animated.View entering={FadeIn.delay(content.split(" ").length * 30 + 600).duration(500)}>
          <HeartHalf size={64} color={COLORS.coral.default} weight="regular" />
        </Animated.View>
      </View>

      <View className="px-8 pb-12">
        <GradientButton
          label="Jak to funguje?"
          onPress={() => router.push("/(onboarding)/solution")}
        />
      </View>
    </View>
  );
}
