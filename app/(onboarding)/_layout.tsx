import { Stack } from "expo-router";
import { COLORS } from "@/constants/design";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: COLORS.cream.default },
        animation: "slide_from_right",
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
