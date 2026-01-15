// components/OfflineBanner.tsx
import { View, Text, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface OfflineBannerProps {
  pendingCount: number;
  onSync: () => void;
  isSyncing: boolean;
}

export function OfflineBanner({
  pendingCount,
  onSync,
  isSyncing,
}: OfflineBannerProps) {
  if (pendingCount === 0) return null;

  return (
    <View className="mx-4 mb-4 bg-sand border border-muted/30 rounded-2xl p-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <Ionicons name="cloud-offline-outline" size={20} color="#8B7F7A" />
          <Text className="text-charcoal ml-2 flex-1">
            {pendingCount} {pendingCount === 1 ? "hlášení čeká" : "hlášení čekají"}{" "}
            na odeslání
          </Text>
        </View>
        <Pressable
          onPress={onSync}
          disabled={isSyncing}
          className={`bg-coral rounded-xl py-2 px-4 ${isSyncing ? "opacity-50" : ""}`}
        >
          <Text className="text-white font-medium">
            {isSyncing ? "Odesílám..." : "Odeslat"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
