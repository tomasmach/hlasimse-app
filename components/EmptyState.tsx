import { View, Text, Pressable } from "react-native";
import { type Icon as PhosphorIcon } from "phosphor-react-native";
import { COLORS } from "@/constants/design";

interface EmptyStateProps {
  icon: PhosphorIcon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <View className="items-center py-8 px-4">
      <View className="mb-4">
        <Icon size={80} color={COLORS.coral.default} weight="regular" />
      </View>
      <Text className="text-lg font-semibold text-charcoal mb-2 text-center">
        {title}
      </Text>
      <Text className="text-muted text-center mb-4">{description}</Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          className="bg-brand-500 px-6 py-3 rounded-full"
        >
          <Text className="text-white font-semibold">{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
