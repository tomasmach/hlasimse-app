import { View, Text, Pressable, Alert } from "react-native";
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
      className="mb-3"
      style={animatedStyle}
    >
      <Card style={SHADOWS.elevated}>
        <View className="flex-row items-center">
          <GradientAvatar
            name={guardian.user.name ?? undefined}
            email={guardian.user.email}
            size="lg"
          />
          <View className="flex-1 ml-4">
            <Text className="text-[17px] font-semibold text-charcoal mb-0.5" numberOfLines={1}>
              {guardian.user.name || "Bez jména"}
            </Text>
            <Text className="text-sm text-muted" numberOfLines={1}>
              {guardian.user.email}
            </Text>
          </View>
          <Pressable
            onPress={handleRemove}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={isRemoving}
            className="p-2 ml-2"
            hitSlop={12}
          >
            <X size={20} color={COLORS.muted} weight="bold" />
          </Pressable>
        </View>
      </Card>
    </Animated.View>
  );
}
