import type { ReactNode } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { ProgressDots } from "./ProgressDots";

type OnboardingFrameProps = {
  step: number;
  title: string;
  intro: string;
  testID: string;
  children: ReactNode;
  footer?: ReactNode;
  showBack?: boolean;
};

export function OnboardingFrame({
  step,
  title,
  intro,
  testID,
  children,
  footer,
  showBack = true,
}: OnboardingFrameProps) {
  return (
    <SafeAreaView className="flex-1 bg-cream" testID={testID}>
      <ProgressDots currentStep={step} showBack={showBack} />
      <ScrollView
        contentContainerClassName="flex-grow px-6 pb-7"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
      >
        <Animated.View
          entering={FadeInDown.duration(420).reduceMotion(ReduceMotion.System)}
          className="mb-8 pt-4"
        >
          <Text className="font-body-semibold text-sm tracking-[1.4px] text-[#9E382E]">
            Hlásím se
          </Text>
          <Text
            className="mt-3 font-display text-[39px] leading-[43px] tracking-[-1.2px] text-charcoal"
            accessibilityRole="header"
          >
            {title}
          </Text>
          <Text className="mt-4 font-body text-[17px] leading-6 text-muted">{intro}</Text>
        </Animated.View>
        <View className="flex-1">{children}</View>
      </ScrollView>
      {footer ? <View className="border-t border-sand bg-cream px-6 pb-3 pt-4">{footer}</View> : null}
    </SafeAreaView>
  );
}
