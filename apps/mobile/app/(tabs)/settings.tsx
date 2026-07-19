import { View, Text, TouchableOpacity, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router, Href } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useOnboardingStore } from "@/stores/onboarding";
import { useCheckInStore } from "@/stores/checkin";
import { COLORS } from "@/constants/design";
import { formatInterval } from "@/utils/formatInterval";

// Helper components
function SectionHeader({ title }: { title: string }) {
  return (
    <Text className="text-muted text-xs font-lora-semibold mb-2 px-1 tracking-wide">
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
      <Text className={`${labelColor} font-lora-medium`}>{label}</Text>
      <View className="flex-row items-center">
        {value && <Text className="text-muted mr-2 font-lora">{value}</Text>}
        {rightIcon}
        {showChevron && onPress && (
          <Ionicons name="chevron-forward" size={20} color={COLORS.muted} />
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
  const { profile } = useCheckInStore();

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
    router.push("/interval-picker" as Href);
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
      "DEV Reset",
      "Vymaže lokální onboarding a bezpečně vás odhlásí. Serverová data zůstanou zachována.",
      [
        { text: "Zrusit", style: "cancel" },
        {
          text: "Reset All",
          style: "destructive",
          onPress: async () => {
            await resetOnboarding();
            await signOut();
          },
        },
      ]
    );
  };

  const intervalDisplay = profile?.interval_hours
    ? formatInterval(profile.interval_hours)
    : "24 hodin";

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView className="flex-1" contentContainerClassName="px-4 pt-4 pb-8">
        <Text className="text-charcoal text-2xl font-lora-bold mb-6">Nastaveni</Text>

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

        {/* UCET Section */}
        <View className="mb-6">
          <SectionHeader title="UCET" />
          <View className="rounded-2xl overflow-hidden">
            <View className="flex-row items-center justify-between px-4 py-3.5 bg-white rounded-t-2xl">
              <Text className="text-charcoal font-lora-medium">E-mail</Text>
              <Text className="text-muted font-lora">{user?.email}</Text>
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
                <Text className="text-charcoal font-lora-medium">
                  Reset Onboarding
                </Text>
              </TouchableOpacity>
              <Divider />
              <TouchableOpacity
                className="bg-white px-4 py-3.5 rounded-b-2xl"
                onPress={handleDevReset}
              >
                <Text className="text-coral font-lora-medium">
                  Uplny Fresh Start
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
