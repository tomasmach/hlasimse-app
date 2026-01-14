import { View, Text, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingStore } from "@/stores/onboarding";
import { useCheckInStore } from "@/stores/checkin";

export default function SettingsScreen() {
  const { user } = useAuth();
  const { checkOnboardingStatus } = useOnboardingStore();
  const { clearProfile } = useCheckInStore();

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

  const handleResetOnboarding = () => {
    Alert.alert(
      "Reset Onboarding",
      "Vymaže lokální onboarding status. Aplikace se restartuje na onboarding obrazovku.",
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            await AsyncStorage.removeItem("@hlasimse/has_seen_onboarding");
            await checkOnboardingStatus();
            Alert.alert("Hotovo", "Restart aplikaci pro fresh start.");
          },
        },
      ]
    );
  };

  const handleDevReset = () => {
    Alert.alert(
      "DEV Reset (úplný fresh start)",
      "Vymaže onboarding status + odhlásí tě. Aplikace půjde do onboarding screenu jako při prvním spuštění.",
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Reset All",
          style: "destructive",
          onPress: async () => {
            await AsyncStorage.removeItem("@hlasimse/has_seen_onboarding");
            clearProfile();
            await supabase.auth.signOut();
          },
        },
      ]
    );
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

        {/* DEV Tools */}
        <View className="mb-4">
          <Text className="text-muted text-xs font-semibold mb-2 px-1">
            🔧 DEV TOOLS
          </Text>
          <TouchableOpacity
            className="bg-white rounded-2xl p-4 border border-sand mb-2"
            onPress={handleResetOnboarding}
          >
            <Text className="text-charcoal text-center font-medium">
              🔄 Reset Onboarding
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="bg-white rounded-2xl p-4 border border-coral"
            onPress={handleDevReset}
          >
            <Text className="text-coral text-center font-medium">
              🚨 Úplný Fresh Start
            </Text>
          </TouchableOpacity>
        </View>

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
