import { useEffect, useCallback, useRef } from "react";
import { Text, StyleSheet, Pressable, PanResponder } from "react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from "react-native-reanimated";
import {
  CheckCircle,
  Info,
  Warning,
  XCircle,
} from "phosphor-react-native";
import { COLORS, ANIMATION, BORDER_RADIUS, SHADOWS } from "@/constants/design";

const TOAST_HEIGHT = 60;
const SWIPE_THRESHOLD = 50;

type ToastType = "success" | "info" | "warning" | "error";

interface ToastProps {
  message: string;
  type?: ToastType;
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
}

const TOAST_CONFIG: Record<
  ToastType,
  {
    backgroundColor: string;
    borderColor: string;
    iconColor: string;
    Icon: typeof CheckCircle;
    haptic: () => Promise<void>;
  }
> = {
  success: {
    backgroundColor: "rgba(74, 222, 128, 0.15)",
    borderColor: COLORS.success,
    iconColor: COLORS.success,
    Icon: CheckCircle,
    haptic: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  },
  info: {
    backgroundColor: "rgba(255, 107, 91, 0.15)",
    borderColor: COLORS.coral.default,
    iconColor: COLORS.coral.default,
    Icon: Info,
    haptic: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  },
  warning: {
    backgroundColor: "rgba(251, 146, 60, 0.15)",
    borderColor: COLORS.warning,
    iconColor: COLORS.warning,
    Icon: Warning,
    haptic: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  },
  error: {
    backgroundColor: "rgba(244, 63, 94, 0.15)",
    borderColor: COLORS.error,
    iconColor: COLORS.error,
    Icon: XCircle,
    haptic: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  },
};

export function Toast({
  message,
  type = "info",
  visible,
  onDismiss,
  duration = 3000,
}: ToastProps) {
  const translateY = useSharedValue(TOAST_HEIGHT + 100);
  const opacity = useSharedValue(0);
  const panOffset = useRef(0);

  const config = TOAST_CONFIG[type];
  const IconComponent = config.Icon;

  const dismiss = useCallback(() => {
    translateY.value = withTiming(TOAST_HEIGHT + 100, { duration: ANIMATION.timing.normal });
    opacity.value = withTiming(0, { duration: ANIMATION.timing.normal }, (finished) => {
      if (finished) {
        runOnJS(onDismiss)();
      }
    });
  }, [onDismiss, translateY, opacity]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to vertical gestures
        return Math.abs(gestureState.dy) > Math.abs(gestureState.dx);
      },
      onPanResponderGrant: () => {
        panOffset.current = 0;
      },
      onPanResponderMove: (_, gestureState) => {
        // Only allow dragging down (positive dy)
        if (gestureState.dy > 0) {
          panOffset.current = gestureState.dy;
          translateY.value = gestureState.dy;
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dy > SWIPE_THRESHOLD) {
          // Swipe down to dismiss
          dismiss();
        } else {
          // Spring back to original position
          translateY.value = withSpring(0, ANIMATION.spring.default);
        }
        panOffset.current = 0;
      },
    })
  ).current;

  useEffect(() => {
    if (visible) {
      // Trigger haptic feedback
      config.haptic();

      // Animate in
      translateY.value = withSpring(0, ANIMATION.spring.bouncy);
      opacity.value = withTiming(1, { duration: ANIMATION.timing.normal });

      // Auto-dismiss after duration
      const timer = setTimeout(() => {
        dismiss();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [visible, duration, config, translateY, opacity, dismiss]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          backgroundColor: config.backgroundColor,
          borderColor: config.borderColor,
        },
        animatedStyle,
      ]}
      {...panResponder.panHandlers}
    >
      <Pressable onPress={dismiss} className="flex-row items-center px-4 py-4 gap-3">
        <IconComponent
          size={24}
          color={config.iconColor}
          weight="fill"
        />
        <Text className="flex-1 text-[15px] font-lora-medium text-charcoal" numberOfLines={2}>
          {message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

// Keep only styles that must remain (position, animated values, shadows)
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 100,
    left: 16,
    right: 16,
    minHeight: TOAST_HEIGHT,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    ...SHADOWS.elevated,
  },
});
