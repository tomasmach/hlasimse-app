import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { Check } from "phosphor-react-native";
import { AuthButton } from "@/components/auth";
import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { PERSONA_CARDS, type PersonaCard } from "@/constants/onboarding";
import { COLORS } from "@/constants/design";
import { useOnboardingStore, type Persona } from "@/stores/onboarding";

function PersonaChoice({
  card,
  selected,
  index,
  onSelect,
}: {
  card: PersonaCard;
  selected: boolean;
  index: number;
  onSelect: (persona: Persona) => void;
}) {
  const Icon = card.icon;

  return (
    <Animated.View
      entering={FadeInDown.delay(100 + index * 70)
        .duration(360)
        .reduceMotion(ReduceMotion.System)}
    >
      <Pressable
        onPress={() => onSelect(card.id)}
        className={`min-h-[94px] overflow-hidden rounded-[24px] border p-4 ${
          selected ? "border-charcoal bg-charcoal" : "border-sand bg-white"
        }`}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${card.title}. ${card.description}`}
        testID={`onboarding-persona-${card.id}`}
      >
        <View className="flex-row items-center gap-4">
          <View
            className={`h-14 w-14 items-center justify-center rounded-[18px] ${
              selected ? "bg-white/10" : "bg-cream-dark"
            }`}
            importantForAccessibility="no"
          >
            <Icon
              size={29}
              color={selected ? COLORS.cream.default : COLORS.charcoal.default}
              weight="regular"
            />
          </View>
          <View className="flex-1">
            <Text
              className={`font-body-semibold text-[18px] leading-6 ${
                selected ? "text-cream" : "text-charcoal"
              }`}
            >
              {card.title}
            </Text>
            <Text
              className={`mt-1 font-body text-[15px] leading-5 ${
                selected ? "text-white/75" : "text-muted"
              }`}
            >
              {card.description}
            </Text>
          </View>
          <View className="h-7 w-7 items-center justify-center" importantForAccessibility="no">
            {selected ? <Check size={24} color={COLORS.cream.default} weight="bold" /> : null}
          </View>
        </View>
        {selected ? (
          <Animated.Text
            entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
            className="ml-[72px] mt-3 font-body text-sm leading-5 text-white/75"
          >
            Volba upraví pouze úvodní vysvětlení. Funkce aplikace zůstávají stejné a zdarma.
          </Animated.Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export default function PersonaSelectionScreen() {
  const storedPersona = useOnboardingStore((state) => state.selectedPersona);
  const setPersona = useOnboardingStore((state) => state.setPersona);
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);
  const [selected, setSelected] = useState<Persona | null>(storedPersona);
  const [busy, setBusy] = useState(false);

  const select = (persona: Persona) => {
    setSelected(persona);
    void Haptics.selectionAsync();
  };

  const continueOnboarding = async () => {
    if (!selected || busy) return;
    setBusy(true);
    await setPersona(selected);
    router.push("/(onboarding)/empathy");
    setBusy(false);
  };

  const openLogin = async () => {
    if (busy) return;
    setBusy(true);
    await completeOnboarding();
    router.replace("/(auth)/login");
  };

  return (
    <OnboardingFrame
      step={0}
      showBack={false}
      testID="onboarding-persona-screen"
      title="Začněme tím, co právě potřebujete."
      intro="Volba změní jen následující vysvětlení. Později vás nijak neomezí."
      footer={
        <AuthButton
          label="Pokračovat"
          onPress={() => void continueOnboarding()}
          disabled={!selected}
          loading={busy}
          testID="onboarding-persona-continue-button"
        />
      }
    >
      <View className="gap-3" accessibilityRole="radiogroup">
        {PERSONA_CARDS.map((card, index) => (
          <PersonaChoice
            key={card.id}
            card={card}
            selected={selected === card.id}
            index={index}
            onSelect={select}
          />
        ))}
      </View>
      <Pressable
        onPress={() => void openLogin()}
        disabled={busy}
        className="mt-5 min-h-[48px] items-center justify-center"
        accessibilityRole="button"
        testID="onboarding-existing-account-button"
      >
        <Text className="font-body-semibold text-[15px] text-[#9E382E]">Už mám účet</Text>
      </Pressable>
    </OnboardingFrame>
  );
}
