import { useEffect, useRef, useCallback } from "react";
import { View, Text, Pressable, Animated, StyleSheet, Modal } from "react-native";
import * as Haptics from "expo-haptics";
import { Check } from "phosphor-react-native";
import { useReducedMotion } from "react-native-reanimated";
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
  const reduceMotion = useReducedMotion();
  // Create stable Animated.Value refs that persist across renders
  const backdropOpacity = useRef(new Animated.Value(0));
  const circleScale = useRef(new Animated.Value(0));
  const checkmarkScale = useRef(new Animated.Value(0));
  const textOpacity = useRef(new Animated.Value(0));
  const textTranslateY = useRef(new Animated.Value(20));
  const dismissingRef = useRef(false);

  const handleDismiss = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    if (reduceMotion) {
      onDismiss();
      return;
    }
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
    ]).start(({ finished }) => {
      if (finished) onDismiss();
      else dismissingRef.current = false;
    });
  }, [onDismiss, reduceMotion]);

  useEffect(() => {
    if (visible) {
      dismissingRef.current = false;
      // Reset values before animating in
      backdropOpacity.current.setValue(0);
      circleScale.current.setValue(0);
      checkmarkScale.current.setValue(0);
      textOpacity.current.setValue(0);
      textTranslateY.current.setValue(20);

      if (reduceMotion) {
        backdropOpacity.current.setValue(1);
        circleScale.current.setValue(1);
        checkmarkScale.current.setValue(1);
        textOpacity.current.setValue(1);
        textTranslateY.current.setValue(0);
        return;
      }

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

      return () => {
        clearTimeout(circleTimer);
        clearTimeout(checkmarkTimer);
        clearTimeout(textTimer);

        // Stop all running animations to prevent memory leaks
        backdropOpacity.current.stopAnimation();
        circleScale.current.stopAnimation();
        checkmarkScale.current.stopAnimation();
        textOpacity.current.stopAnimation();
        textTranslateY.current.stopAnimation();
      };
    }
  }, [visible, reduceMotion]);

  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <View
        testID="checkin-success-overlay"
        style={styles.container}
        accessibilityViewIsModal
        importantForAccessibility="yes"
      >
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity.current }]} />

        <View className="flex-1 items-center justify-center px-6">
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
            accessible
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
            accessibilityLabel={`Check-in potvrzen serverem. Server přijal hlášení. Další termín za ${formatInterval(intervalHours)}.`}
            style={{
              opacity: textOpacity.current,
              transform: [{ translateY: textTranslateY.current }],
            }}
          >
            <Text className="text-[28px] font-bold text-charcoal mb-2 text-center font-lora-bold">
              Check-in potvrzen serverem
            </Text>
            <Text className="text-lg text-muted text-center leading-[26px] font-lora">
              Server přijal hlášení. Další termín za{"\n"}
              <Text className="font-semibold text-charcoal font-lora-semibold">{formatInterval(intervalHours)}</Text>
            </Text>
          </Animated.View>
          <Pressable
            testID="checkin-success-continue"
            onPress={handleDismiss}
            accessibilityRole="button"
            accessibilityLabel="Pokračovat po potvrzeném check-inu"
            className="min-h-[56px] min-w-[200px] mt-9 px-8 rounded-[20px] bg-charcoal items-center justify-center active:opacity-80"
          >
            <Text className="font-body-semibold text-lg text-white">Pokračovat</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
    ...StyleSheet.absoluteFill,
    backgroundColor: COLORS.cream.default,
  },
});
