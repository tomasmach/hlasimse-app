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
    <View
      style={[
        styles.content,
        isLarge ? styles.contentLarge : styles.contentMedium,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={isPrimary ? COLORS.white : COLORS.coral.default}
          size="small"
        />
      ) : (
        <Text
          style={[
            styles.label,
            isLarge ? styles.labelLarge : styles.labelMedium,
            isPrimary ? styles.labelPrimary : styles.labelSecondary,
          ]}
        >
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
        isPrimary ? styles.shadowPrimary : styles.shadowSecondary,
        (disabled || loading) && styles.disabled,
      ]}
    >
      {isPrimary ? (
        <LinearGradient
          colors={GRADIENTS.coral}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.button, isLarge ? styles.buttonLarge : styles.buttonMedium]}
        >
          {buttonContent}
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.button,
            styles.buttonSecondary,
            isLarge ? styles.buttonLarge : styles.buttonMedium,
          ]}
        >
          {buttonContent}
        </View>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 16,
    overflow: "hidden",
  },
  buttonMedium: {
    minHeight: 48,
  },
  buttonLarge: {
    minHeight: 56,
  },
  buttonSecondary: {
    backgroundColor: COLORS.white,
    borderWidth: 2,
    borderColor: COLORS.coral.default,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
  },
  contentMedium: {
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  contentLarge: {
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  label: {
    fontWeight: "600",
  },
  labelMedium: {
    fontSize: 16,
  },
  labelLarge: {
    fontSize: 18,
  },
  labelPrimary: {
    color: COLORS.white,
  },
  labelSecondary: {
    color: COLORS.coral.default,
  },
  shadowPrimary: {
    ...SHADOWS.glow,
  },
  shadowSecondary: {
    ...SHADOWS.elevated,
  },
  disabled: {
    opacity: 0.5,
  },
});
