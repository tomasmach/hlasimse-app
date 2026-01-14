import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function CheckInScreen() {
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 items-center justify-center px-6">
        <Text className="text-charcoal text-2xl font-semibold mb-4">
          Ahoj!
        </Text>
        <Text className="text-muted text-center mb-8">
          Zmáčkni tlačítko a dej vědět, že jsi v pořádku
        </Text>

        <Pressable className="bg-coral w-48 h-48 rounded-full items-center justify-center shadow-lg active:bg-coral-dark">
          <Text className="text-white text-xl font-bold">
            Hlásím se!
          </Text>
        </Pressable>

        <Text className="text-muted mt-8">
          Další hlášení za: 23:45:12
        </Text>
      </View>
    </SafeAreaView>
  );
}
