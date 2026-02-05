import { View, ViewProps } from "react-native";
import { SHADOWS } from "@/constants/design";

interface CardProps extends ViewProps {
  variant?: "elevated" | "floating" | "flat";
  padding?: "none" | "sm" | "md" | "lg";
}

const PADDING_CLASSES = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5",
} as const;

export function Card({
  variant = "elevated",
  padding = "md",
  style,
  children,
  className,
  ...props
}: CardProps) {
  const shadowStyle = variant !== "flat" ? SHADOWS[variant] : {};

  return (
    <View
      className={`bg-white rounded-[32px] ${PADDING_CLASSES[padding]} ${className || ""}`}
      style={[shadowStyle, style]}
      {...props}
    >
      {children}
    </View>
  );
}
