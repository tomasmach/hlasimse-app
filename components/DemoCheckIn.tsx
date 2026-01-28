// components/DemoCheckIn.tsx
import { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
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
    <View style={styles.container}>
      {showCTA ? (
        // After animation - show CTA
        <Animated.View entering={FadeIn.duration(300)} style={styles.content}>
          <View style={styles.successCircle}>
            <Check size={48} color={COLORS.success} weight="bold" />
          </View>

          <Text style={styles.successTitle}>Právě jste se ohlásili!</Text>
          <Text style={styles.successSubtitle}>
            Takhle jednoduše dáte vědět{"\n"}blízkým, že jste v pořádku.
          </Text>

          <View style={styles.ctaContainer}>
            <GradientButton label="Vytvořit účet" onPress={onComplete} />
            <Text style={styles.loginLink} onPress={onSkip}>
              Už mám účet? Přihlásit
            </Text>
          </View>
        </Animated.View>
      ) : (
        // Before press and during animation - keep same layout structure
        <View style={styles.content}>
          <Animated.Text
            style={[styles.title, hasPressed && styles.hidden]}
          >
            Zkuste si to
          </Animated.Text>
          <Animated.Text
            style={[styles.subtitle, hasPressed && styles.hidden]}
          >
            Stiskněte tlačítko a zažijte,{"\n"}jak snadné je hlásit se.
          </Animated.Text>

          <View style={styles.heroContainer}>
            <HeroButton
              onPress={handlePress}
              showSuccess={showSuccess}
              disabled={hasPressed}
            />
          </View>

          <View style={[styles.hint, hasPressed && styles.hidden]}>
            <Text style={styles.hintText}>Stiskněte tlačítko</Text>
            <ArrowRight size={16} color={COLORS.coral.default} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream.default,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.charcoal.default,
    textAlign: "center",
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 18,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 26,
    marginBottom: 48,
  },
  heroContainer: {
    marginBottom: 32,
  },
  hint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hintText: {
    fontSize: 15,
    color: COLORS.coral.default,
    fontWeight: "500",
  },
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: `${COLORS.success}20`,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 32,
  },
  successTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: COLORS.charcoal.default,
    textAlign: "center",
    marginBottom: 12,
  },
  successSubtitle: {
    fontSize: 17,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 48,
  },
  ctaContainer: {
    width: "100%",
    gap: 16,
  },
  loginLink: {
    fontSize: 15,
    color: COLORS.coral.default,
    textAlign: "center",
    fontWeight: "500",
  },
  hidden: {
    opacity: 0,
  },
});
