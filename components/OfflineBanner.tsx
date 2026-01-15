import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface OfflineBannerProps {
  pendingCount: number;
}

export function OfflineBanner({ pendingCount }: OfflineBannerProps) {
  if (pendingCount === 0) return null;

  return (
    <View className="bg-sand rounded-2xl p-4 mx-4 mb-4">
      <View className="flex-row items-center">
        <Ionicons name="cellular-outline" size={20} color="#8B7F7A" />
        <View className="ml-3 flex-1">
          <Text className="text-charcoal font-medium">
            Čekáme na připojení...
          </Text>
          <Text className="text-muted text-sm">
            Vaše hlášení je v bezpečí.
          </Text>
        </View>
      </View>
    </View>
  );
}
