import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GRADIENTS, COLORS } from "@/constants/design";

interface GradientAvatarProps {
  name?: string;
  email?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const SIZE_CONFIG = {
  sm: { size: 32, fontSize: 14 },
  md: { size: 40, fontSize: 16 },
  lg: { size: 48, fontSize: 20 },
  xl: { size: 72, fontSize: 28 },
} as const;

export function GradientAvatar({
  name,
  email,
  size = "md",
}: GradientAvatarProps) {
  // Get initial from name or email, fallback to "?"
  const getInitial = (): string => {
    if (name && name.trim().length > 0) {
      return name.trim().charAt(0).toUpperCase();
    }
    if (email && email.trim().length > 0) {
      return email.trim().charAt(0).toUpperCase();
    }
    return "?";
  };

  const config = SIZE_CONFIG[size];
  const initial = getInitial();

  return (
    <View
      style={[
        styles.container,
        {
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
        },
      ]}
    >
      <LinearGradient
        colors={GRADIENTS.coral as unknown as string[]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.gradient,
          {
            width: config.size,
            height: config.size,
            borderRadius: config.size / 2,
          },
        ]}
      >
        {/* Inner shadow overlay for depth */}
        <View
          style={[
            styles.innerShadow,
            {
              width: config.size,
              height: config.size,
              borderRadius: config.size / 2,
            },
          ]}
        >
          <Text
            style={[
              styles.initial,
              {
                fontSize: config.fontSize,
              },
            ]}
          >
            {initial}
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  gradient: {
    justifyContent: "center",
    alignItems: "center",
  },
  innerShadow: {
    backgroundColor: "rgba(0,0,0,0.05)",
    justifyContent: "center",
    alignItems: "center",
  },
  initial: {
    color: COLORS.white,
    fontWeight: "600",
  },
});

export default GradientAvatar;
