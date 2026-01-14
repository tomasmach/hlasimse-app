import { View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function GuardiansScreen() {
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-xl font-semibold mb-4">
          Strážci
        </Text>
        <Text className="text-muted text-center">
          Tady uvidíš lidi, kteří tě hlídají
        </Text>
      </View>
    </SafeAreaView>
  );
}
