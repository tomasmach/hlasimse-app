import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { ArrowLeft } from "phosphor-react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import { COLORS, ANIMATION } from "@/constants/design";

const TOTAL_STEPS = 5;

function Dot({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();
  const style = useAnimatedStyle(() => ({
    width: reduceMotion
      ? active
        ? 28
        : 8
      : withTiming(active ? 28 : 8, { duration: ANIMATION.timing.normal }),
    opacity: reduceMotion
      ? active
        ? 1
        : 0.28
      : withTiming(active ? 1 : 0.28, { duration: ANIMATION.timing.normal }),
  }));
  return <Animated.View importantForAccessibility="no" className="h-2 rounded-full bg-coral" style={style} />;
}

export function ProgressDots({
  currentStep,
  showBack = true,
}: {
  currentStep: number;
  showBack?: boolean;
}) {
  return (
    <View className="h-16 flex-row items-center px-5">
      <View className="w-12">
        {showBack ? (
          <Pressable
            onPress={() => router.back()}
            className="min-h-[48px] min-w-[48px] items-center justify-center rounded-full"
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel="Zpět"
            testID={`onboarding-back-${currentStep}`}
          >
            <ArrowLeft size={23} color={COLORS.charcoal.default} weight="bold" />
          </Pressable>
        ) : null}
      </View>
      <View
        className="flex-1 flex-row items-center justify-center gap-2"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Onboarding, krok ${currentStep + 1} z ${TOTAL_STEPS}`}
        accessibilityValue={{ min: 1, max: TOTAL_STEPS, now: currentStep + 1 }}
        testID="onboarding-progress"
      >
        {Array.from({ length: TOTAL_STEPS }, (_, index) => (
          <Dot key={index} active={index === currentStep} />
        ))}
      </View>
      <View className="w-12 items-end">
        <Text className="font-body-medium text-sm text-muted" importantForAccessibility="no">
          {currentStep + 1}/{TOTAL_STEPS}
        </Text>
      </View>
    </View>
  );
}
