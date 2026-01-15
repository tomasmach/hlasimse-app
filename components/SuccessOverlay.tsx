// components/SuccessOverlay.tsx
import { useEffect, useRef } from "react";
import { View, Text, Pressable, Animated } from "react-native";
import { Ionicons } from "@expo/vector-icons";

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
  const scale = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset values before animating in
      scale.setValue(0);
      opacity.setValue(0);

      // Animate in
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss after 3 seconds
      const timer = setTimeout(() => {
        handleDismiss();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleDismiss = () => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onDismiss();
    });
  };

  if (!visible) return null;

  const formatInterval = (hours: number): string => {
    if (hours >= 24) {
      const days = hours / 24;
      if (days === 1) return "1 den";
      if (days >= 2 && days <= 4) return `${days} dny`;
      return `${days} dnů`;
    }
    if (hours === 1) return "1 hodinu";
    if (hours >= 2 && hours <= 4) return `${hours} hodiny`;
    return `${hours} hodin`;
  };

  return (
    <Pressable onPress={handleDismiss} className="absolute inset-0 z-50">
      <Animated.View
        className="flex-1 bg-white items-center justify-center"
        style={{ opacity }}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <View className="w-24 h-24 rounded-full bg-success/20 items-center justify-center mb-6">
            <Ionicons name="checkmark" size={48} color="#4ADE80" />
          </View>
        </Animated.View>

        <Text className="text-3xl font-bold text-charcoal mb-2">
          Vše v pořádku!
        </Text>

        <Text className="text-lg text-muted text-center">
          Další hlášení za{"\n"}
          <Text className="font-semibold text-charcoal">
            {formatInterval(intervalHours)}
          </Text>
        </Text>
      </Animated.View>
    </Pressable>
  );
}
