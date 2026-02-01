import { View, ViewProps, StyleSheet } from "react-native";
import { COLORS, SHADOWS, BORDER_RADIUS } from "@/constants/design";

interface CardProps extends ViewProps {
  variant?: "elevated" | "floating" | "flat";
  padding?: "none" | "sm" | "md" | "lg";
}

const PADDING_VALUES = {
  none: 0,
  sm: 12,
  md: 16,
  lg: 20,
} as const;

export function Card({
  variant = "elevated",
  padding = "md",
  style,
  children,
  ...props
}: CardProps) {
  const shadowStyle = variant !== "flat" ? SHADOWS[variant] : {};

  return (
    <View
      style={[
        styles.base,
        shadowStyle,
        { padding: PADDING_VALUES[padding] },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: COLORS.white,
    borderRadius: BORDER_RADIUS["2xl"],
  },
});
