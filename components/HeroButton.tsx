import React, { useEffect } from "react";
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
  interpolate,
  Easing,
  runOnJS,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check } from "phosphor-react-native";
import { COLORS, GRADIENTS, SHADOWS, ANIMATION } from "@/constants/design";

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
  // Animation shared values
  const breathingScale = useSharedValue(1);
  const glowOpacity = useSharedValue(0.3);
  const pressScale = useSharedValue(1);
  const checkmarkScale = useSharedValue(0);

  // Start breathing animation
  useEffect(() => {
    breathingScale.value = withRepeat(
      withSequence(
        withTiming(1.02, {
          duration: ANIMATION.heroButton.breathingDuration / 2,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(1.0, {
          duration: ANIMATION.heroButton.breathingDuration / 2,
          easing: Easing.inOut(Easing.ease),
        })
      ),
      -1, // infinite repeat
      false // no reverse
    );
  }, []);

  // Start glow pulse animation
  useEffect(() => {
    glowOpacity.value = withRepeat(
      withSequence(
        withTiming(0.6, {
          duration: ANIMATION.heroButton.glowPulseDuration / 2,
          easing: Easing.inOut(Easing.ease),
        }),
        withTiming(0.3, {
          duration: ANIMATION.heroButton.glowPulseDuration / 2,
          easing: Easing.inOut(Easing.ease),
        })
      ),
      -1,
      false
    );
  }, []);

  // Handle success state
  useEffect(() => {
    if (showSuccess) {
      checkmarkScale.value = withSpring(1, ANIMATION.spring.bouncy);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      checkmarkScale.value = withSpring(0, ANIMATION.spring.default);
    }
  }, [showSuccess]);

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
      pressScale.value = withTiming(0.92, { duration: ANIMATION.timing.fast });
      runOnJS(triggerPressHaptic)();
    })
    .onFinalize((_, success) => {
      pressScale.value = withSpring(1, ANIMATION.spring.default);
      if (success) {
        runOnJS(triggerOnPress)();
      }
    });

  // Animated styles
  const buttonAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { scale: breathingScale.value * pressScale.value },
      ],
    };
  });

  const glowAnimatedStyle = useAnimatedStyle(() => {
    return {
      opacity: glowOpacity.value,
      transform: [{ scale: breathingScale.value }],
    };
  });

  const checkmarkAnimatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: checkmarkScale.value }],
      opacity: checkmarkScale.value,
    };
  });

  return (
    <View style={styles.container}>
      {/* Glow effect behind button */}
      <Animated.View style={[styles.glow, glowAnimatedStyle]} />

      {/* Main button */}
      <GestureDetector gesture={tapGesture}>
        <Animated.View style={[styles.buttonWrapper, buttonAnimatedStyle]}>
          <AnimatedLinearGradient
            colors={GRADIENTS.coral}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.button,
              disabled && styles.buttonDisabled,
            ]}
          >
            {/* Content */}
            {isLoading ? (
              <ActivityIndicator size="large" color={COLORS.white} />
            ) : showSuccess ? (
              <Animated.View style={checkmarkAnimatedStyle}>
                <Check size={64} color={COLORS.white} weight="bold" />
              </Animated.View>
            ) : (
              <View style={styles.iconContainer}>
                <Check size={64} color={COLORS.white} weight="bold" />
              </View>
            )}
          </AnimatedLinearGradient>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

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
  iconContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
});

export default HeroButton;
