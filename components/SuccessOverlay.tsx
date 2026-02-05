import { useEffect, useRef, useCallback } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Check } from "phosphor-react-native";
import { COLORS, ANIMATION } from "@/constants/design";
import { formatInterval } from "@/utils/formatInterval";

interface SuccessOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  intervalHours?: number;
}

export function SuccessOverlay({
  visible,
  onDismiss,
  intervalHours = 24,
}: SuccessOverlayProps) {
  // Create stable Animated.Value refs that persist across renders
  const backdropOpacity = useRef(new Animated.Value(0));
  const circleScale = useRef(new Animated.Value(0));
  const checkmarkScale = useRef(new Animated.Value(0));
  const textOpacity = useRef(new Animated.Value(0));
  const textTranslateY = useRef(new Animated.Value(20));

  const handleDismiss = useCallback(() => {
    Animated.parallel([
      Animated.timing(backdropOpacity.current, {
        toValue: 0,
        duration: ANIMATION.timing.normal,
        useNativeDriver: true,
      }),
      Animated.timing(circleScale.current, {
        toValue: 0,
        duration: ANIMATION.timing.normal,
        useNativeDriver: true,
      }),
      Animated.timing(checkmarkScale.current, {
        toValue: 0,
        duration: ANIMATION.timing.normal,
        useNativeDriver: true,
      }),
      Animated.timing(textOpacity.current, {
        toValue: 0,
        duration: ANIMATION.timing.normal,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onDismiss();
    });
  }, [onDismiss]);

  useEffect(() => {
    if (visible) {
      // Reset values before animating in
      backdropOpacity.current.setValue(0);
      circleScale.current.setValue(0);
      checkmarkScale.current.setValue(0);
      textOpacity.current.setValue(0);
      textTranslateY.current.setValue(20);

      // Trigger haptic feedback
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Staggered animations
      // T+0ms: Backdrop fade in
      Animated.timing(backdropOpacity.current, {
        toValue: 1,
        duration: ANIMATION.timing.slow,
        useNativeDriver: true,
      }).start();

      // T+100ms: Circle scale up (spring bouncy)
      const circleTimer = setTimeout(() => {
        Animated.spring(circleScale.current, {
          toValue: 1,
          damping: ANIMATION.spring.bouncy.damping,
          stiffness: ANIMATION.spring.bouncy.stiffness,
          useNativeDriver: true,
        }).start();
      }, 100);

      // T+300ms: Checkmark scale up (spring bouncy)
      const checkmarkTimer = setTimeout(() => {
        Animated.spring(checkmarkScale.current, {
          toValue: 1,
          damping: ANIMATION.spring.bouncy.damping,
          stiffness: ANIMATION.spring.bouncy.stiffness,
          useNativeDriver: true,
        }).start();
      }, 300);

      // T+500ms: Text fade in + slide up
      const textTimer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(textOpacity.current, {
            toValue: 1,
            duration: ANIMATION.timing.slow,
            useNativeDriver: true,
          }),
          Animated.spring(textTranslateY.current, {
            toValue: 0,
            damping: ANIMATION.spring.gentle.damping,
            stiffness: ANIMATION.spring.gentle.stiffness,
            useNativeDriver: true,
          }),
        ]).start();
      }, 500);

      // Auto-dismiss after 3 seconds
      const autoDismissTimer = setTimeout(() => {
        handleDismiss();
      }, 3000);

      return () => {
        clearTimeout(circleTimer);
        clearTimeout(checkmarkTimer);
        clearTimeout(textTimer);
        clearTimeout(autoDismissTimer);

        // Stop all running animations to prevent memory leaks
        backdropOpacity.current.stopAnimation();
        circleScale.current.stopAnimation();
        checkmarkScale.current.stopAnimation();
        textOpacity.current.stopAnimation();
        textTranslateY.current.stopAnimation();
      };
    }
  }, [visible, handleDismiss]);

  if (!visible) return null;

  return (
    <Pressable onPress={handleDismiss} style={styles.container}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity.current }]}>
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.creamOverlay} />
      </Animated.View>

      <View className="flex-1 items-center justify-center">
        {/* Success Circle */}
        <Animated.View
          className="mb-6"
          style={{ transform: [{ scale: circleScale.current }] }}
        >
          <View className="w-[120px] h-[120px] rounded-[60px] bg-success items-center justify-center">
            {/* Checkmark with separate animation */}
            <Animated.View
              style={{ transform: [{ scale: checkmarkScale.current }] }}
            >
              <Check size={56} color={COLORS.white} weight="bold" />
            </Animated.View>
          </View>
        </Animated.View>

        {/* Text */}
        <Animated.View
          style={{
            opacity: textOpacity.current,
            transform: [{ translateY: textTranslateY.current }],
          }}
        >
          <Text className="text-[28px] font-bold text-charcoal mb-2 text-center">
            Vše v pořádku!
          </Text>
          <Text className="text-lg text-muted text-center leading-[26px]">
            Další hlášení za{"\n"}
            <Text className="font-semibold text-charcoal">{formatInterval(intervalHours)}</Text>
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

// Keep only styles that must remain (position, absolute fills, Animated.Value refs)
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  creamOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.cream.default,
    opacity: 0.6,
  },
});
