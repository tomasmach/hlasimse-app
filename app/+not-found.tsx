import { Link, Stack } from "expo-router";
import { Text, View } from "react-native";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View className="flex-1 items-center justify-center p-5 bg-cream">
        <Text className="text-xl font-bold text-charcoal mb-4">
          Tato stránka neexistuje.
        </Text>
        <Link href="/">
          <Text className="text-coral">Zpět na hlavní obrazovku</Text>
        </Link>
      </View>
    </>
  );
}
