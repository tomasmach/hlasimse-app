// useState removed - was only used for paywallVisible (RevenueCat disabled)
import { View, Text, TouchableOpacity, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, Href } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingStore } from "@/stores/onboarding";
import { useCheckInStore } from "@/stores/checkin";
// RevenueCat temporarily disabled
// import { usePremiumStore } from "@/stores/premium";
// import { Paywall } from "@/components/Paywall";

const colors = {
  charcoal: "#2D2926",
  muted: "#8B7F7A",
  coral: "#FF6B5B",
} as const;

// Helper components
function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-muted text-xs font-semibold mb-2 px-1 tracking-wide">
      {title}
    </Text>
  );
}

function SettingsRow({
  label,
  value,
  onPress,
  showChevron = true,
  rightIcon,
  labelColor = "text-charcoal",
  isFirst = false,
  isLast = false,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  showChevron?: boolean;
  rightIcon?: React.ReactNode;
  labelColor?: string;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  return (
    <TouchableOpacity
      className={`flex-row items-center justify-between px-4 py-3.5 bg-white ${
        isFirst ? "rounded-t-2xl" : ""
      } ${isLast ? "rounded-b-2xl" : ""}`}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text className={`${labelColor} font-medium`}>{label}</Text>
      <View className="flex-row items-center">
        {value && <Text className="text-muted mr-2">{value}</Text>}
        {rightIcon}
        {showChevron && onPress && (
          <Ionicons name="chevron-forward" size={20} color={colors.muted} />
        )}
      </View>
    </TouchableOpacity>
  );
}

function Divider() {
  return <View className="h-px bg-sand mx-4" />;
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { resetOnboarding } = useOnboardingStore();
  const { profile, clearProfile } = useCheckInStore();
  // RevenueCat temporarily disabled - all features are free
  // const { isPremium } = usePremiumStore();
  // const [paywallVisible, setPaywallVisible] = useState(false);

  const handleLogout = () => {
    Alert.alert("Odhlasit se", "Opravdu se chcete odhlasit?", [
      { text: "Zrusit", style: "cancel" },
      {
        text: "Odhlasit",
        style: "destructive",
        onPress: async () => {
          await signOut();
        },
      },
    ]);
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      "Smazat ucet",
      "Opravdu chcete smazat svuj ucet? Tato akce je nevratna a vsechna vase data budou trvale smazana.",
      [
        { text: "Zrusit", style: "cancel" },
        {
          text: "Smazat ucet",
          style: "destructive",
          onPress: () => {
            router.push("/delete-account" as Href);
          },
        },
      ]
    );
  };

  const handleIntervalPress = () => {
    // All features are free - go directly to interval picker
    router.push("/interval-picker" as Href);
  };

  const handleManageSubscription = () => {
    // TODO: Navigate to subscription management or app store
    Alert.alert(
      "Sprava predplatneho",
      "Predplatne muzete spravovat v nastaveni vaseho App Store nebo Google Play."
    );
  };

  const handleResetOnboarding = () => {
    Alert.alert(
      "Reset Onboarding",
      "Vymaze onboarding status a odhlasi te. Uvidis onboarding jako pri prvnim spusteni.",
      [
        { text: "Zrusit", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: async () => {
            await resetOnboarding();
            await signOut();
          },
        },
      ]
    );
  };

  const handleDevReset = () => {
    Alert.alert(
      "DEV Reset (uplny fresh start)",
      "Vymaze vsechna data + ucet + odhlasi te. Aplikace pujde do onboarding screenu jako pri prvnim spusteni.",
      [
        { text: "Zrusit", style: "cancel" },
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
                .eq("owner_id", user.id);

              if (profiles && profiles.length > 0) {
                const profileIds = profiles.map((p) => p.id);
                await supabase
                  .from("check_ins")
                  .delete()
                  .in("check_in_profile_id", profileIds);
              }

              // 2. Alerts (via check_in_profile FK)
              const { data: guardians } = await supabase
                .from("guardians")
                .select("check_in_profile_id")
                .eq("user_id", user.id);

              if (guardians && guardians.length > 0) {
                const profileIds = guardians.map((g) => g.check_in_profile_id);
                await supabase
                  .from("alerts")
                  .delete()
                  .in("check_in_profile_id", profileIds);
              }

              // 3. Guardians (both as user and as guardian)
              await supabase.from("guardians").delete().eq("user_id", user.id);
              await supabase
                .from("guardians")
                .delete()
                .eq("guardian_user_id", user.id);

              // 4. Check-in profiles
              await supabase
                .from("check_in_profiles")
                .delete()
                .eq("owner_id", user.id);

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
              await signOut();
            } catch (error) {
              console.error("Error during dev reset:", error);
              Alert.alert(
                "Chyba",
                "Nepodarilo se smazat data. Zkuste to prosim znovu."
              );
            }
          },
        },
      ]
    );
  };

  // Format interval display
  const formatInterval = (hours: number) => {
    if (hours < 24) {
      return `${hours} hodin`;
    } else if (hours === 24) {
      return "24 hodin";
    } else {
      const days = Math.floor(hours / 24);
      return `${days} ${days === 1 ? "den" : days < 5 ? "dny" : "dnu"}`;
    }
  };

  const intervalDisplay = profile?.interval_hours
    ? formatInterval(profile.interval_hours)
    : "24 hodin";

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-8">
        <Text className="text-charcoal text-2xl font-bold mb-6">Nastaveni</Text>

        {/* PROFIL Section */}
        <View className="mb-6">
          <SectionHeader title="PROFIL" />
          <View className="rounded-2xl overflow-hidden">
            <SettingsRow
              label="Jmeno"
              value={profile?.name || "Nenastaveno"}
              onPress={() => router.push("/edit-name" as Href)}
              isFirst
            />
            <Divider />
            <SettingsRow
              label="Interval"
              value={intervalDisplay}
              onPress={handleIntervalPress}
              isLast
            />
          </View>
        </View>

        {/* PREDPLATNE Section - temporarily disabled, all features free */}

        {/* UCET Section */}
        <View className="mb-6">
          <SectionHeader title="UCET" />
          <View className="rounded-2xl overflow-hidden">
            <View className="flex-row items-center justify-between px-4 py-3.5 bg-white rounded-t-2xl">
              <Text className="text-charcoal font-medium">E-mail</Text>
              <Text className="text-muted">{user?.email}</Text>
            </View>
            <Divider />
            <SettingsRow
              label="Odhlasit se"
              onPress={handleLogout}
              showChevron={false}
            />
            <Divider />
            <SettingsRow
              label="Smazat ucet"
              onPress={handleDeleteAccount}
              showChevron={false}
              labelColor="text-coral"
              isLast
            />
          </View>
        </View>

        {/* DEV Tools - keep for development */}
        {__DEV__ && (
          <View className="mb-4">
            <SectionHeader title="DEV TOOLS" />
            <View className="rounded-2xl overflow-hidden">
              <TouchableOpacity
                className="bg-white px-4 py-3.5 rounded-t-2xl"
                onPress={handleResetOnboarding}
              >
                <Text className="text-charcoal font-medium">
                  Reset Onboarding
                </Text>
              </TouchableOpacity>
              <Divider />
              <TouchableOpacity
                className="bg-white px-4 py-3.5 rounded-b-2xl"
                onPress={handleDevReset}
              >
                <Text className="text-coral font-medium">
                  Uplny Fresh Start
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Paywall Modal - temporarily disabled */}
    </SafeAreaView>
  );
}
