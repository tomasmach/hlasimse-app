import { ActivityIndicator, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeInDown,
  ReduceMotion,
  useReducedMotion,
} from "react-native-reanimated";
import { HeartHalf } from "phosphor-react-native";
import { AuthButton } from "@/components/auth";
import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { useOnboardingPersona } from "@/components/onboarding/useOnboardingPersona";
import { EMPATHY_CONTENT } from "@/constants/onboarding";
import { COLORS } from "@/constants/design";

function EditorialQuote({ text }: { text: string }) {
  const reduceMotion = useReducedMotion();
  const words = text.split(" ");
  if (reduceMotion) {
    return <Text className="font-body text-[20px] leading-8 text-charcoal">{text}</Text>;
  }
  return (
    <View
      className="flex-row flex-wrap"
      accessible
      accessibilityLabel={text}
      testID="onboarding-empathy-copy"
    >
      {words.map((word, index) => (
        <Animated.Text
          key={`${word}-${index}`}
          entering={FadeIn.delay(180 + index * 24)
            .duration(240)
            .reduceMotion(ReduceMotion.System)}
          className="font-body text-[20px] leading-8 text-charcoal"
          importantForAccessibility="no-hide-descendants"
        >
          {word}{" "}
        </Animated.Text>
      ))}
    </View>
  );
}

export default function EmpathyScreen() {
  const { selectedPersona, loading } = useOnboardingPersona();

  if (loading || !selectedPersona) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream" testID="onboarding-empathy-loading">
        <ActivityIndicator color={COLORS.charcoal.default} />
      </SafeAreaView>
    );
  }

  return (
    <OnboardingFrame
      step={1}
      testID="onboarding-empathy-screen"
      title="Méně nejistoty. Více jasných signálů."
      intro="Rozumíme situaci, ale neslibujeme dohled, který aplikace nemůže zajistit."
      footer={
        <AuthButton
          label="Ukázat, jak to funguje"
          onPress={() => router.push("/(onboarding)/solution")}
          testID="onboarding-empathy-continue-button"
        />
      }
    >
      <Animated.View
        entering={FadeInDown.delay(100).duration(420).reduceMotion(ReduceMotion.System)}
        className="border-l-2 border-charcoal py-3 pl-6 pr-2"
      >
        <EditorialQuote text={EMPATHY_CONTENT[selectedPersona]} />
      </Animated.View>
      <View className="mt-10 flex-row items-start gap-4 border-t border-sand pt-6">
        <HeartHalf size={29} color={COLORS.charcoal.default} weight="regular" />
        <Text className="flex-1 font-body text-[15px] leading-6 text-muted">
          Hlásím se je doplňkový komunikační nástroj. V bezprostředním ohrožení volejte 112 nebo 155.
        </Text>
      </View>
    </OnboardingFrame>
  );
}
