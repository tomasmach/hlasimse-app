import { Stack } from "expo-router";
import { useReducedMotion } from "react-native-reanimated";
import { COLORS } from "@/constants/design";

export default function OnboardingLayout() {
  const reduceMotion = useReducedMotion();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.cream.default },
        animation: reduceMotion ? "none" : "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="empathy" />
      <Stack.Screen name="solution" />
      <Stack.Screen name="demo" />
      <Stack.Screen name="signup" />
    </Stack>
  );
}
