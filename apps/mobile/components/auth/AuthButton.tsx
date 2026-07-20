import { ActivityIndicator, Pressable, Text } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { COLORS } from "@/constants/design";

type AuthButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID: string;
  accessibilityHint?: string;
};

export function AuthButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  testID,
  accessibilityHint,
}: AuthButtonProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const unavailable = loading || disabled;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const press = () => {
    if (unavailable) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      testID={testID}
      onPress={press}
      onPressIn={() => {
        if (!reduceMotion && !unavailable) {
          scale.value = withSpring(0.98, { damping: 20, stiffness: 220 });
        }
      }}
      onPressOut={() => {
        scale.value = reduceMotion
          ? 1
          : withSpring(1, { damping: 20, stiffness: 220 });
      }}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={loading ? `${label}, probíhá` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      style={unavailable ? { opacity: 0.55 } : undefined}
      className="min-h-[58px] rounded-[20px]"
    >
      <Animated.View
        pointerEvents="none"
        style={animatedStyle}
        className="min-h-[58px] flex-row items-center justify-center overflow-hidden rounded-[20px] bg-charcoal px-6 py-4"
      >
        {loading ? (
          <ActivityIndicator color={COLORS.cream.default} />
        ) : (
          <Text className="font-body-semibold text-[17px] text-cream">{label}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
}
