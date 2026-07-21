import { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
  cancelAnimation,
  useReducedMotion,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check } from "phosphor-react-native";
import { COLORS, GRADIENTS, SHADOWS, ANIMATION } from "@/constants/design";
import { getHeroButtonAccessibility } from "@/components/heroButtonAccessibility";

const BUTTON_SIZE = 180;
const GLOW_SIZE = BUTTON_SIZE + 40;

interface HeroButtonProps {
  onPress: () => void;
  isLoading?: boolean;
  showSuccess?: boolean;
  disabled?: boolean;
}

const AnimatedLinearGradient = Animated.createAnimatedComponent(LinearGradient);

export function HeroButton({
  onPress,
  isLoading = false,
  showSuccess = false,
  disabled = false,
}: HeroButtonProps) {
  const reduceMotion = useReducedMotion();
  // Animation shared values
  const breathingScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.3);
  const pressScale = useSharedValue(1);
  const checkmarkScale = useSharedValue(0);

  // Start breathing and glow pulse animations
  useEffect(() => {
    if (reduceMotion) {
      cancelAnimation(breathingScale);
      cancelAnimation(glowOpacity);
      breathingScale.value = 1;
      glowOpacity.value = 0.3;
      return;
    }

    const easing = Easing.inOut(Easing.ease);

    breathingScale.value = withRepeat(
      withSequence(
        withTiming(1.02, { duration: ANIMATION.heroButton.breathingDuration / 2, easing }),
        withTiming(1.0, { duration: ANIMATION.heroButton.breathingDuration / 2, easing })
      ),
      -1,
      false
    );

    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.6, { duration: ANIMATION.heroButton.glowPulseDuration / 2, easing }),
        withTiming(0.3, { duration: ANIMATION.heroButton.glowPulseDuration / 2, easing })
      ),
      -1,
      false
    );
    return () => {
      cancelAnimation(breathingScale);
      cancelAnimation(glowOpacity);
    };
  }, [breathingScale, glowOpacity, reduceMotion]);

  // Handle success state
  useEffect(() => {
    if (showSuccess) {
      checkmarkScale.value = reduceMotion
        ? 1
        : withSpring(1, ANIMATION.spring.bouncy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      checkmarkScale.value = reduceMotion
        ? 0
        : withSpring(0, ANIMATION.spring.default);
    }
  }, [showSuccess, checkmarkScale, reduceMotion]);

  // Haptic feedback functions
  const triggerPressHaptic = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const triggerOnPress = () => {
    if (!disabled && !isLoading) {
      onPress();
    }
  };

  // Gesture handler
  const tapGesture = Gesture.Tap()
    .enabled(!disabled && !isLoading)
    .onBegin(() => {
      pressScale.value = reduceMotion
        ? 1
        : withTiming(0.92, { duration: ANIMATION.timing.fast });
      runOnJS(triggerPressHaptic)();
    })
    .onFinalize((_, success) => {
      pressScale.value = reduceMotion
        ? 1
        : withSpring(1, ANIMATION.spring.default);
      if (success) {
        runOnJS(triggerOnPress)();
      }
    });

  // Animated styles
  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: breathingScale.value * pressScale.value }],
  }));

  const glowAnimatedStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
    transform: [{ scale: breathingScale.value }],
  }));

  const checkmarkAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkmarkScale.value }],
    opacity: checkmarkScale.value,
  }));

  const accessibility = getHeroButtonAccessibility({
    disabled,
    isLoading,
    showSuccess,
  });

  const handleAccessibilityAction = () => {
    triggerOnPress();
  };

  return (
    <View style={styles.container}>
      {/* Glow effect behind button */}
      <Animated.View style={[styles.glow, glowAnimatedStyle]} />

      {/* Main button */}
      <GestureDetector gesture={tapGesture}>
        <Animated.View
          style={[styles.buttonWrapper, buttonAnimatedStyle]}
          accessible
          focusable
          accessibilityRole="button"
          accessibilityLabel={accessibility.label}
          accessibilityHint={accessibility.hint}
          accessibilityState={accessibility.state}
          accessibilityValue={accessibility.value}
          accessibilityActions={[{ name: "activate", label: "Odeslat hlášení" }]}
          onAccessibilityTap={triggerOnPress}
          onAccessibilityAction={handleAccessibilityAction}
        >
          <AnimatedLinearGradient
            colors={GRADIENTS.coral}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.button,
              disabled && styles.buttonDisabled,
            ]}
          >
            {isLoading ? (
              <ActivityIndicator size="large" color={COLORS.white} />
            ) : (
              <Animated.View style={showSuccess ? checkmarkAnimatedStyle : undefined}>
                <Check size={64} color={COLORS.white} weight="bold" />
              </Animated.View>
            )}
          </AnimatedLinearGradient>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

// Keep all styles - they use animated values, dynamic sizes, and shadows
const styles = StyleSheet.create({
  container: {
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  glow: {
    position: "absolute",
    width: GLOW_SIZE,
    height: GLOW_SIZE,
    borderRadius: GLOW_SIZE / 2,
    backgroundColor: COLORS.coral.default,
    ...SHADOWS.glowLarge,
  },
  buttonWrapper: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    ...SHADOWS.floating,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    borderRadius: BUTTON_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
