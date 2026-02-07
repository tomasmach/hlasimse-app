import { View, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { GRADIENTS } from "@/constants/design";

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
  const config = SIZE_CONFIG[size];
  const displayText = name?.trim() || email?.trim() || "";
  const initial = displayText ? displayText.charAt(0).toUpperCase() : "?";

  return (
    <View
      className="overflow-hidden"
      style={{
        width: config.size,
        height: config.size,
        borderRadius: config.size / 2,
      }}
    >
      <LinearGradient
        colors={GRADIENTS.coral}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="justify-center items-center"
        style={{
          width: config.size,
          height: config.size,
          borderRadius: config.size / 2,
        }}
      >
        {/* Inner shadow overlay for depth */}
        <View
          className="justify-center items-center bg-black/5"
          style={{
            width: config.size,
            height: config.size,
            borderRadius: config.size / 2,
          }}
        >
          <Text
            className="text-white font-lora-semibold"
            style={{ fontSize: config.fontSize }}
          >
            {initial}
          </Text>
        </View>
      </LinearGradient>
    </View>
  );
}
