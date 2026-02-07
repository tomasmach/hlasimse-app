import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { useEffect } from "react";
import { BlurView } from "expo-blur";
import { COLORS, SHADOWS } from "@/constants/design";

interface MockNotificationProps {
  message: string;
  visible: boolean;
  onHidden?: () => void;
}

const SHOW_DURATION = 2500;

export function MockNotification({
  message,
  visible,
  onHidden,
}: MockNotificationProps) {
  const translateY = useSharedValue(-120);

  useEffect(() => {
    if (visible) {
      translateY.value = withSequence(
        withTiming(0, { duration: 500, easing: Easing.out(Easing.cubic) }),
        withDelay(
          SHOW_DURATION,
          withTiming(-120, {
            duration: 400,
            easing: Easing.in(Easing.cubic),
          })
        )
      );
      // Call onHidden after full animation
      if (onHidden) {
        const timeout = setTimeout(onHidden, 500 + SHOW_DURATION + 400);
        return () => clearTimeout(timeout);
      }
    }
  }, [visible, translateY, onHidden]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, animatedStyle]}>
      <BlurView intensity={95} tint="light" style={styles.blur}>
        <View style={styles.innerContainer}>
          <View className="flex-row items-center px-4 py-3">
            <View style={styles.appIcon}>
              <Text className="text-white text-xs font-bold font-lora-bold">H</Text>
            </View>
            <View className="flex-1 ml-3">
              <Text className="text-xs text-muted font-medium uppercase tracking-wider font-lora-medium">
                Hlásím se
              </Text>
              <Text className="text-sm text-charcoal mt-0.5 font-lora">{message}</Text>
            </View>
            <Text className="text-xs text-muted font-lora">teď</Text>
          </View>
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 50,
    left: 16,
    right: 16,
    zIndex: 100,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#FFFFFF",
    ...SHADOWS.glowLarge,
  },
  blur: {
    borderRadius: 16,
    overflow: "hidden",
  },
  innerContainer: {
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  appIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.coral.default,
    alignItems: "center",
    justifyContent: "center",
  },
});
