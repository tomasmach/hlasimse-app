import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeInDown,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { X } from "phosphor-react-native";
import { GuardianWithUser } from "@/types/database";
import { GradientAvatar, Card } from "@/components/ui";
import { COLORS, ANIMATION, SHADOWS } from "@/constants/design";

interface GuardianCardProps {
  guardian: GuardianWithUser;
  onRemove: (id: string) => void;
  isRemoving?: boolean;
  index?: number;
}

export function GuardianCard({
  guardian,
  onRemove,
  isRemoving,
  index = 0,
}: GuardianCardProps) {
  const scale = useSharedValue(1);

  const handleRemove = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      "Odebrat strážce",
      `Opravdu chceš odebrat ${guardian.user.name || guardian.user.email} jako strážce?`,
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Odebrat",
          style: "destructive",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            onRemove(guardian.id);
          },
        },
      ]
    );
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.98, ANIMATION.spring.default);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, ANIMATION.spring.default);
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      style={[styles.container, animatedStyle]}
    >
      <Card style={styles.card}>
        <View style={styles.content}>
          <GradientAvatar
            name={guardian.user.name ?? undefined}
            email={guardian.user.email}
            size="lg"
          />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>
              {guardian.user.name || "Bez jména"}
            </Text>
            <Text style={styles.email} numberOfLines={1}>
              {guardian.user.email}
            </Text>
          </View>
          <Pressable
            onPress={handleRemove}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={isRemoving}
            style={styles.removeButton}
            hitSlop={12}
          >
            <X size={20} color={COLORS.muted} weight="bold" />
          </Pressable>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 12,
  },
  card: {
    ...SHADOWS.elevated,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
  },
  info: {
    flex: 1,
    marginLeft: 16,
  },
  name: {
    fontSize: 17,
    fontWeight: "600",
    color: COLORS.charcoal.default,
    marginBottom: 2,
  },
  email: {
    fontSize: 14,
    color: COLORS.muted,
  },
  removeButton: {
    padding: 8,
    marginLeft: 8,
  },
});
