import { View, Text, TouchableOpacity, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingStore } from "@/stores/onboarding";
import { useCheckInStore } from "@/stores/checkin";

export default function SettingsScreen() {
  const { user } = useAuth();
  const { resetOnboarding } = useOnboardingStore();
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
      "Vymaže onboarding status a odhlásí tě. Uvidíš onboarding jako při prvním spuštění.",
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            await resetOnboarding();
            await supabase.auth.signOut();
          },
        },
      ]
    );
  };

  const handleDevReset = () => {
    Alert.alert(
      "DEV Reset (úplný fresh start)",
      "Vymaže všechna data + účet + odhlásí tě. Aplikace půjde do onboarding screenu jako při prvním spuštění.",
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Reset All",
          style: "destructive",
          onPress: async () => {
            if (!user?.id) return;

            try {
              // Delete all user data
              // 1. Check-ins (must delete first due to FK)
              const { data: profiles } = await supabase
                .from("check_in_profiles")
                .select("id")
                .eq("user_id", user.id);

              if (profiles && profiles.length > 0) {
                const profileIds = profiles.map((p) => p.id);
                await supabase
                  .from("check_ins")
                  .delete()
                  .in("profile_id", profileIds);
              }

              // 2. Alerts (via guardians FK)
              const { data: guardians } = await supabase
                .from("guardians")
                .select("id")
                .eq("user_id", user.id);

              if (guardians && guardians.length > 0) {
                const guardianIds = guardians.map((g) => g.id);
                await supabase
                  .from("alerts")
                  .delete()
                  .in("guardian_id", guardianIds);
              }

              // 3. Guardians (both as user and as guardian)
              await supabase.from("guardians").delete().eq("user_id", user.id);
              await supabase
                .from("guardians")
                .delete()
                .eq("guardian_user_id", user.id);

              // 4. Push tokens
              await supabase
                .from("push_tokens")
                .delete()
                .eq("user_id", user.id);

              // 5. Check-in profiles
              await supabase
                .from("check_in_profiles")
                .delete()
                .eq("user_id", user.id);

              // Clear local state
              clearProfile();
              await resetOnboarding();

              // Delete auth account (if function exists)
              try {
                await supabase.rpc("delete_current_user");
              } catch {
                // Function may not exist yet, continue anyway
              }

              // Sign out (this will trigger navigation to onboarding)
              await supabase.auth.signOut();
            } catch (error) {
              console.error("Error during dev reset:", error);
              Alert.alert(
                "Chyba",
                "Nepodařilo se smazat data. Zkuste to prosím znovu."
              );
            }
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
