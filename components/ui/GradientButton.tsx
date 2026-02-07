import {
  Pressable,
  Text,
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { COLORS, GRADIENTS, SHADOWS, ANIMATION } from "@/constants/design";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type GradientButtonProps = {
  onPress: () => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
};

export function GradientButton({
  onPress,
  label,
  loading = false,
  disabled = false,
  variant = "primary",
  size = "md",
}: GradientButtonProps) {
  const scale = useSharedValue(1);

  // KEEP animated style (uses withSpring)
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, ANIMATION.spring.default);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, ANIMATION.spring.default);
  };

  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const isPrimary = variant === "primary";
  const isLarge = size === "lg";

  const buttonContent = (
    <View style={styles.content} className="items-center justify-center">
      {loading ? (
        <ActivityIndicator
          color={isPrimary ? COLORS.white : COLORS.coral.default}
          size="small"
        />
      ) : (
        <Text className={`font-lora-semibold ${isLarge ? 'text-2xl' : 'text-xl'} ${isPrimary ? 'text-white' : 'text-coral'}`}>
          {label}
        </Text>
      )}
    </View>
  );

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      style={[
        animatedStyle,
        isPrimary ? SHADOWS.glow : SHADOWS.elevated,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {isPrimary ? (
        <LinearGradient
          colors={GRADIENTS.coral}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.gradient, isLarge && styles.gradientLg]}
        >
          {buttonContent}
        </LinearGradient>
      ) : (
        <View className={`rounded-full overflow-hidden bg-white border-2 border-coral ${isLarge ? 'min-h-[56px]' : 'min-h-[48px]'}`}>
          {buttonContent}
        </View>
      )}
    </AnimatedPressable>
  );
}

// Keep only styles that can't be in NativeWind
const styles = StyleSheet.create({
  gradient: {
    borderRadius: 9999,
    overflow: "hidden",
    minHeight: 60,
  },
  gradientLg: {
    minHeight: 68,
  },
  content: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    minHeight: 60,
  },
  disabled: {
    opacity: 0.5,
  },
});
