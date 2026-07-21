import { useEffect } from "react";
import { Text, View } from "react-native";
import { BlurView } from "expo-blur";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { COLORS, SHADOWS } from "@/constants/design";

type MockNotificationProps = {
  message: string;
  visible: boolean;
  onHidden?: () => void;
};

const SHOW_DURATION_MS = 2800;

export function MockNotification({ message, visible, onHidden }: MockNotificationProps) {
  const reduceMotion = useReducedMotion();
  const translateY = useSharedValue(-140);

  useEffect(() => {
    if (!visible) {
      translateY.value = -140;
      return;
    }
    if (reduceMotion) {
      translateY.value = 0;
    } else {
      translateY.value = withSequence(
        withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }),
        withDelay(
          SHOW_DURATION_MS,
          withTiming(-140, { duration: 320, easing: Easing.in(Easing.cubic) }),
        ),
      );
    }
    if (!onHidden) return;
    const timeout = setTimeout(onHidden, reduceMotion ? SHOW_DURATION_MS : SHOW_DURATION_MS + 700);
    return () => clearTimeout(timeout);
  }, [onHidden, reduceMotion, translateY, visible]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;
  return (
    <Animated.View
      className="absolute left-4 right-4 top-[72px] z-[100] overflow-hidden rounded-[22px] border border-white"
      style={[style, SHADOWS.floating]}
      accessible
      accessibilityLabel={`Ukázka upozornění. ${message}`}
      accessibilityLiveRegion="polite"
      testID="onboarding-demo-notification"
    >
      <BlurView intensity={90} tint="light">
        <View className="flex-row items-center bg-white/80 px-4 py-3">
          <View className="h-10 w-10 items-center justify-center rounded-[12px] bg-charcoal">
            <Text className="font-body-semibold text-sm text-cream">HS</Text>
          </View>
          <View className="ml-3 flex-1">
            <Text className="font-body-semibold text-xs tracking-[1px] text-[#9E382E]">
              UKÁZKA UPOZORNĚNÍ
            </Text>
            <Text className="mt-1 font-body text-sm leading-5 text-charcoal">{message}</Text>
          </View>
          <Text className="font-body text-xs text-muted">teď</Text>
        </View>
      </BlurView>
    </Animated.View>
  );
}
