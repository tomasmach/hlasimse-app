import { ActivityIndicator, Pressable, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { COLORS } from "@/constants/design";

type AuthButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  testID: string;
  accessibilityHint?: string;
};

export function AuthButton({
  label,
  onPress,
  loading = false,
  disabled = false,
  testID,
  accessibilityHint,
}: AuthButtonProps) {
  const unavailable = loading || disabled;

  const press = () => {
    if (unavailable) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      testID={testID}
      onPress={press}
      disabled={unavailable}
      accessibilityRole="button"
      accessibilityLabel={loading ? `${label}, probíhá` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      style={unavailable ? { opacity: 0.55 } : undefined}
      className="min-h-[58px] rounded-[20px]"
    >
      <View
        pointerEvents="none"
        className="min-h-[58px] flex-row items-center justify-center overflow-hidden rounded-[20px] bg-charcoal px-6 py-4"
      >
        {loading ? (
          <ActivityIndicator color={COLORS.cream.default} />
        ) : (
          <Text className="font-body-semibold text-[17px] text-cream">{label}</Text>
        )}
      </View>
    </Pressable>
  );
}
