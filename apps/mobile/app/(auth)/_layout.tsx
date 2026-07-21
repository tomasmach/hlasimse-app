import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { COLORS } from "@/constants/design";

export default function AuthLayout() {
  const reduceMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? "none" : "fade",
        contentStyle: {
          backgroundColor: COLORS.cream.default,
        },
      }}
    />
  );
}
