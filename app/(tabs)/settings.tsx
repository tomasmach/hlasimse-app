import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettingsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-xl font-semibold mb-4">
          Nastavení
        </Text>
        <Text className="text-muted text-center">
          Tady si nastavíš svůj profil a předplatné
        </Text>
      </View>
    </SafeAreaView>
  );
}
