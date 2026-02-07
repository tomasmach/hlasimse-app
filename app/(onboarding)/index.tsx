import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { router } from "expo-router";
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useOnboardingStore } from "@/stores/onboarding";
import { PERSONA_CARDS, type PersonaCard } from "@/constants/onboarding";
import type { Persona } from "@/stores/onboarding";
import { COLORS, ANIMATION, SHADOWS } from "@/constants/design";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function PersonaCardItem({
  card,
  isSelected,
  onSelect,
  index,
}: {
  card: PersonaCard;
  isSelected: boolean;
  onSelect: (id: Persona) => void;
  index: number;
}) {
  const Icon = card.icon;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        scale: withSpring(isSelected ? 1.02 : 1, ANIMATION.spring.default),
      },
    ],
    borderColor: withTiming(
      isSelected ? COLORS.coral.default : "transparent",
      { duration: ANIMATION.timing.normal }
    ),
    backgroundColor: withTiming(
      isSelected ? COLORS.cream.dark : COLORS.white,
      { duration: ANIMATION.timing.normal }
    ),
  }));

  return (
    <AnimatedPressable
      onPress={() => onSelect(card.id)}
      style={[styles.card, animatedStyle, SHADOWS.elevated]}
    >
      <Animated.View entering={FadeInDown.delay(200 + index * 100).duration(400)}>
        <View className="flex-row items-center gap-4">
          <View style={styles.iconCircle}>
            <Icon size={48} color={COLORS.coral.default} weight="regular" />
          </View>
          <View className="flex-1">
            <Text className="text-2xl font-semibold text-charcoal font-lora-semibold">
              {card.title}
            </Text>
            <Text className="text-lg text-muted mt-1 font-lora">
              {card.description}
            </Text>
          </View>
        </View>
      </Animated.View>
    </AnimatedPressable>
  );
}

export default function PersonaSelectionScreen() {
  const [selected, setSelected] = useState<Persona | null>(null);
  const { setPersona } = useOnboardingStore();

  const handleSelect = async (persona: Persona) => {
    if (selected) return; // prevent double-tap
    setSelected(persona);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await setPersona(persona);
    setTimeout(() => {
      router.push("/(onboarding)/empathy");
    }, 400);
  };

  return (
    <View className="flex-1 bg-cream">
      <ProgressDots currentStep={0} />

      <View className="flex-1 px-6 justify-center">
        <Animated.View entering={FadeInDown.duration(500)}>
          <Text className="text-5xl font-semibold text-charcoal text-center mb-3 font-lora-semibold">
            Co vás přivedlo?
          </Text>
          <Text className="text-xl text-muted text-center mb-10 font-lora">
            Díky tomu vám ukážeme, jak vám pomůžeme
          </Text>
        </Animated.View>

        <View className="gap-4">
          {PERSONA_CARDS.map((card, index) => (
            <PersonaCardItem
              key={card.id}
              card={card}
              isSelected={selected === card.id}
              onSelect={handleSelect}
              index={index}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 32,
    borderWidth: 2,
    padding: 20,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.cream.dark,
    alignItems: "center",
    justifyContent: "center",
  },
});
