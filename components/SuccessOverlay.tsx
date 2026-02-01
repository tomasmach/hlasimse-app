import { useEffect, useRef, useCallback } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { Check } from "phosphor-react-native";
import { COLORS, ANIMATION } from "@/constants/design";

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
      };
    }
  }, [visible, handleDismiss]);

  if (!visible) return null;

  const formatInterval = (hours: number): string => {
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      if (days === 1) return "1 den";
      if (days >= 2 && days <= 4) return `${days} dny`;
      return `${days} dnů`;
    }
    if (hours === 1) return "1 hodinu";
    if (hours >= 2 && hours <= 4) return `${hours} hodiny`;
    return `${hours} hodin`;
  };

  return (
    <Pressable onPress={handleDismiss} style={styles.container}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity.current }]}>
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFill} />
        <View style={styles.creamOverlay} />
      </Animated.View>

      <View style={styles.content}>
        {/* Success Circle */}
        <Animated.View
          style={[
            styles.circleContainer,
            { transform: [{ scale: circleScale.current }] },
          ]}
        >
          <View style={styles.successCircle}>
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
          <Text style={styles.title}>Vše v pořádku!</Text>
          <Text style={styles.subtitle}>
            Další hlášení za{"\n"}
            <Text style={styles.intervalText}>{formatInterval(intervalHours)}</Text>
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

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
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  circleContainer: {
    marginBottom: 24,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.success,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: COLORS.charcoal.default,
    marginBottom: 8,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 26,
  },
  intervalText: {
    fontWeight: "600",
    color: COLORS.charcoal.default,
  },
});
