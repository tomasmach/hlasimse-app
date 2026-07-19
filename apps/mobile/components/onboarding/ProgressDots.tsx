import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { COLORS, ANIMATION } from "@/constants/design";

const TOTAL_STEPS = 5;
const DOT_SIZE = 8;
const DOT_ACTIVE_WIDTH = 24;

interface ProgressDotsProps {
  currentStep: number;
}

function Dot({ isActive }: { isActive: boolean }) {
  const animatedStyle = useAnimatedStyle(() => ({
    width: withTiming(isActive ? DOT_ACTIVE_WIDTH : DOT_SIZE, {
      duration: ANIMATION.timing.normal,
    }),
    opacity: withTiming(isActive ? 1 : 0.3, {
      duration: ANIMATION.timing.normal,
    }),
  }));

  return (
    <Animated.View
      className="h-2 rounded-full"
      style={[
        animatedStyle,
        { backgroundColor: COLORS.coral.default },
      ]}
    />
  );
}

export function ProgressDots({ currentStep }: ProgressDotsProps) {
  return (
    <View className="flex-row justify-center items-center gap-2 pt-16 pb-8">
      {Array.from({ length: TOTAL_STEPS }, (_, i) => (
        <Dot key={i} isActive={i === currentStep} />
      ))}
    </View>
  );
}
