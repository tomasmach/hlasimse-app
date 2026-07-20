import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";

type AuthScreenProps = {
  title: string;
  intro: string;
  testID: string;
  children: ReactNode;
  eyebrow?: string;
};

export function AuthScreen({
  title,
  intro,
  testID,
  children,
  eyebrow = "Hlásím se",
}: AuthScreenProps) {
  return (
    <SafeAreaView className="flex-1 bg-cream" testID={testID}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="flex-grow px-6 pb-12 pt-6"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-10 flex-1 justify-end" style={{ minHeight: 210 }}>
            <Animated.View
              entering={FadeInDown.duration(420).reduceMotion(ReduceMotion.System)}
            >
              <View className="mb-7 h-1 w-16 rounded-full bg-coral" />
              <Text className="font-body-semibold text-sm tracking-[1.4px] text-[#9E382E]">
                {eyebrow}
              </Text>
              <Text
                className="mt-3 font-display text-[40px] leading-[44px] tracking-[-1.2px] text-charcoal"
                accessibilityRole="header"
              >
                {title}
              </Text>
              <Text className="mt-4 font-body text-[17px] leading-6 text-muted">{intro}</Text>
            </Animated.View>
          </View>
          <View>{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
