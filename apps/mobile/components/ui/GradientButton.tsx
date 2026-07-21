import {
  Pressable,
  Text,
  ActivityIndicator,
  StyleSheet,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { COLORS, GRADIENTS, SHADOWS } from "@/constants/design";

type GradientButtonProps = {
  onPress: () => void;
  label: string;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  size?: "md" | "lg";
  testID?: string;
  accessibilityLabel?: string;
};

export function GradientButton({
  onPress,
  label,
  loading = false,
  disabled = false,
  variant = "primary",
  size = "md",
  testID,
  accessibilityLabel,
}: GradientButtonProps) {
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
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={handlePress}
      disabled={disabled || loading}
      style={[
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
        <View className={`rounded-2xl overflow-hidden bg-white border-2 border-coral ${isLarge ? 'min-h-[68px]' : 'min-h-[60px]'}`}>
          {buttonContent}
        </View>
      )}
    </Pressable>
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
