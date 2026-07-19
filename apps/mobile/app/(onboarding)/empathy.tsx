import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { router } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { HeartHalf } from "phosphor-react-native";
import { useOnboardingStore } from "@/stores/onboarding";
import { EMPATHY_CONTENT } from "@/constants/onboarding";
import { COLORS, SHADOWS } from "@/constants/design";
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
          className="text-2xl text-charcoal-light leading-9 font-lora"
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
        <Animated.View entering={FadeInDown.duration(600)} className="mb-8">
          <Text className="text-3xl font-semibold text-charcoal text-center font-lora-semibold">
            Víme, jaké to je
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(200).duration(600)}
          style={[{ borderColor: COLORS.peach.light }, SHADOWS.glow]}
          className="bg-white mx-4 rounded-[32px] border"
        >
          <View className="px-8 py-10">
            <View className="mb-8">
              <AnimatedWords text={content} />
            </View>

            <Animated.View
              entering={FadeIn.delay(content.split(" ").length * 30 + 800).duration(500)}
              className="items-center"
            >
              <HeartHalf size={96} color={COLORS.coral.default} weight="regular" />
            </Animated.View>
          </View>
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
