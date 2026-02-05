import { useState } from "react";
import { View, Text } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Check, ArrowRight } from "phosphor-react-native";
import { HeroButton } from "@/components/HeroButton";
import { GradientButton } from "@/components/ui";
import { COLORS } from "@/constants/design";

interface DemoCheckInProps {
  onComplete: () => void;
  onSkip: () => void;
}

export function DemoCheckIn({ onComplete, onSkip }: DemoCheckInProps) {
  const [hasPressed, setHasPressed] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showCTA, setShowCTA] = useState(false);

  const handlePress = () => {
    if (hasPressed) return;

    setHasPressed(true);
    setShowSuccess(true);

    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // After success animation, show CTA
    setTimeout(() => {
      setShowCTA(true);
    }, 1500);
  };

  return (
    <View className="flex-1 bg-cream">
      {showCTA ? (
        // After animation - show CTA
        <Animated.View entering={FadeIn.duration(300)} className="flex-1 items-center justify-center px-8">
          <View className="w-[100px] h-[100px] rounded-[50px] bg-success/20 items-center justify-center mb-8">
            <Check size={48} color={COLORS.success} weight="bold" />
          </View>

          <Text className="text-[28px] font-extrabold text-charcoal text-center mb-3">
            Právě jste se ohlásili!
          </Text>
          <Text className="text-[17px] text-muted text-center leading-6 mb-12">
            Takhle jednoduše dáte vědět{"\n"}blízkým, že jste v pořádku.
          </Text>

          <View className="w-full gap-4">
            <GradientButton label="Vytvořit účet" onPress={onComplete} />
            <Text className="text-[15px] text-coral text-center font-medium" onPress={onSkip}>
              Už mám účet? Přihlásit
            </Text>
          </View>
        </Animated.View>
      ) : (
        // Before press and during animation - keep same layout structure
        <View className="flex-1 items-center justify-center px-8">
          <Animated.Text
            className={`text-[32px] font-extrabold text-charcoal text-center mb-3 ${hasPressed ? 'opacity-0' : ''}`}
          >
            Zkuste si to
          </Animated.Text>
          <Animated.Text
            className={`text-lg text-muted text-center leading-[26px] mb-12 ${hasPressed ? 'opacity-0' : ''}`}
          >
            Stiskněte tlačítko a zažijte,{"\n"}jak snadné je hlásit se.
          </Animated.Text>

          <View className="mb-8">
            <HeroButton
              onPress={handlePress}
              showSuccess={showSuccess}
              disabled={hasPressed}
            />
          </View>

          <View className={`flex-row items-center gap-2 ${hasPressed ? 'opacity-0' : ''}`}>
            <Text className="text-[15px] text-coral font-medium">Stiskněte tlačítko</Text>
            <ArrowRight size={16} color={COLORS.coral.default} />
          </View>
        </View>
      )}
    </View>
  );
}
