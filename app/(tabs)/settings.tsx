import { View, Text, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export default function SettingsScreen() {
  const { user } = useAuth();

  const handleLogout = () => {
    Alert.alert("Odhlásit se", "Opravdu se chcete odhlásit?", [
      { text: "Zrušit", style: "cancel" },
      {
        text: "Odhlásit",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
        },
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 px-4 pt-4">
        <Text className="text-charcoal text-2xl font-bold mb-6">Nastavení</Text>

        <View className="bg-white rounded-2xl p-4 mb-4">
          <Text className="text-muted text-sm mb-1">Přihlášen jako</Text>
          <Text className="text-charcoal font-medium">{user?.email}</Text>
        </View>

        <View className="flex-1" />

        <TouchableOpacity
          className="bg-white rounded-2xl p-4 border border-coral mb-8"
          onPress={handleLogout}
        >
          <Text className="text-coral text-center font-medium">
            Odhlásit se
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
