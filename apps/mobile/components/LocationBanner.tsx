// components/LocationBanner.tsx
import { View, Text, Pressable, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS } from "@/constants/design";

interface LocationBannerProps {
  onRequestPermission: () => void;
}

export function LocationBanner({ onRequestPermission }: LocationBannerProps) {
  const openSettings = () => {
    if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    } else {
      Linking.openSettings();
    }
  };

  return (
    <View className="mx-4 mb-4 bg-peach/30 border border-peach rounded-2xl p-4">
      <View className="flex-row items-center mb-2">
        <Ionicons name="location-outline" size={20} color={COLORS.coral.default} />
        <Text className="text-charcoal font-semibold ml-2 font-lora-semibold">
          Poloha není povolena
        </Text>
      </View>
      <Text className="text-muted text-sm mb-3 font-lora">
        Pro větší bezpečí povolte přístup k poloze. Strážci uvidí kde jste byli
        při posledním hlášení.
      </Text>
      <Pressable
        onPress={openSettings}
        className="bg-coral rounded-xl py-2 px-4 self-start"
      >
        <Text className="text-white font-medium font-lora-medium">Otevřít nastavení</Text>
      </Pressable>
    </View>
  );
}
