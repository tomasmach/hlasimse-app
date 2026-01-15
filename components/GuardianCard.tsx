import { View, Text, Pressable, Alert } from "react-native";
import { GuardianWithUser } from "@/types/database";

interface GuardianCardProps {
  guardian: GuardianWithUser;
  onRemove: (id: string) => void;
  isRemoving?: boolean;
}

export function GuardianCard({ guardian, onRemove, isRemoving }: GuardianCardProps) {
  const handleRemove = () => {
    Alert.alert(
      "Odebrat strážce",
      `Opravdu chceš odebrat ${guardian.user.name || guardian.user.email} jako strážce?`,
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Odebrat",
          style: "destructive",
          onPress: () => onRemove(guardian.id),
        },
      ]
    );
  };

  return (
    <View className="flex-row items-center justify-between bg-white rounded-2xl p-4 mb-3">
      <View className="flex-row items-center flex-1">
        <View className="w-10 h-10 rounded-full bg-peach/30 items-center justify-center mr-3">
          <Text className="text-coral text-lg">
            {(guardian.user.name || guardian.user.email || "?")[0].toUpperCase()}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-charcoal font-medium" numberOfLines={1}>
            {guardian.user.name || "Bez jména"}
          </Text>
          <Text className="text-muted text-sm" numberOfLines={1}>
            {guardian.user.email}
          </Text>
        </View>
      </View>
      <Pressable
        onPress={handleRemove}
        disabled={isRemoving}
        className="p-2"
      >
        <Text className="text-muted text-xl">×</Text>
      </Pressable>
    </View>
  );
}
