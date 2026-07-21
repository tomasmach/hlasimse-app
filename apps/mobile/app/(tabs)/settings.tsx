import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ArrowRight,
  Bell,
  DownloadSimple,
  FileText,
  GearSix,
  Lifebuoy,
  LockKey,
  ShieldWarning,
  SignOut,
  Trash,
  UserCircle,
  type IconProps,
} from "phosphor-react-native";
import { PageTitle, Notice } from "@/components/product/ProductUI";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { COLORS } from "@/constants/design";
import { openPublicDocument, PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_URL } from "@/lib/legal";

type RowProps = {
  label: string;
  detail?: string;
  icon: React.ComponentType<IconProps>;
  onPress: () => void;
  testID?: string;
  danger?: boolean;
  accessibilityRole?: "button" | "link";
};

function Row({
  label,
  detail,
  icon: Icon,
  onPress,
  testID,
  danger = false,
  accessibilityRole = "button",
}: RowProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className="min-h-[72px] flex-row items-center gap-4 border-b border-sand py-4"
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityHint={detail}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Icon size={23} color={danger ? COLORS.error : COLORS.charcoal.default} />
      </View>
      <View className="flex-1">
        <Text
          className={`font-body-semibold text-base ${danger ? "text-[#9E382E]" : "text-charcoal"}`}
        >
          {label}
        </Text>
        {detail ? (
          <Text className="mt-1 font-body text-sm leading-5 text-muted">{detail}</Text>
        ) : null}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ArrowRight size={20} color={COLORS.muted} />
      </View>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { profile, pendingCount, failedPendingCount } = useCheckInStore();
  const [logoutError, setLogoutError] = useState("");
  const logout = () => {
    const queued = pendingCount + failedPendingCount;
    Alert.alert("Odhlásit se?", queued ? `V zařízení je ${queued} nepotvrzených požadavků. Odhlášení je z bezpečnostních důvodů trvale odstraní; serverový termín se nezmění.` : "Lokální session a připomínky tohoto zařízení budou odstraněny.", [
      { text: "Zrušit", style: "cancel" },
      { text: queued ? "Odhlásit a smazat frontu" : "Odhlásit", style: "destructive", onPress: async () => {
        setLogoutError("");
        try { await signOut(); }
        catch (error) { setLogoutError(error instanceof Error ? error.message : "Bezpečné odhlášení se nepodařilo."); }
      } },
    ]);
  };
  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 pt-5 pb-36">
        <PageTitle title="Nastavení důvěry" subtitle="Oprávnění a zařízení jsou součástí bezpečnostního stavu, ne jednorázový dialog." />
        <View className="bg-charcoal rounded-[28px] p-5 mb-7 overflow-hidden"><View className="absolute w-40 h-40 rounded-full bg-coral/20 -right-16 -top-20" /><Text className="font-body text-white/60 text-sm">Přihlášený účet</Text><Text className="font-display text-[25px] text-white mt-2">{user?.first_name || "Uživatel"} {user?.last_name || ""}</Text><Text className="font-body text-white/70 mt-1">{user?.email}</Text><Text className="font-body text-white/60 text-sm mt-4">Vybraný profil: {profile?.name || "bez profilu"}</Text></View>
        <Row label={profile ? "Spravovat vybraný profil" : "Vytvořit vlastní profil"} detail={profile ? "Název, interval a bezpečná archivace" : "Účet může pouze hlídat, vlastní profil není povinný"} icon={UserCircle} onPress={() => router.push(profile ? "/(tabs)/profile-detail" : "/(tabs)/profile-setup?mode=add")} />
        <Row testID="notification-diagnostics-open" label="Diagnostika upozornění a polohy" detail="OS oprávnění, lokální připomínky a registrace zařízení" icon={Bell} onPress={() => router.push("/(tabs)/diagnostics")} />
        <Row testID="account-export-open" label="Exportovat moje data" detail="Server připraví aktuální JSON export; obsah může zahrnovat citlivé údaje" icon={DownloadSimple} onPress={() => router.push("/(tabs)/data-export")} />
        <Row label="Jak služba funguje" detail="Význam check-inu, incidentu a best-effort push" icon={GearSix} onPress={() => router.push("/(tabs)/safety-info")} />
        <Text
          accessibilityRole="header"
          className="mt-7 font-body-semibold text-sm uppercase tracking-[1.2px] text-muted"
        >
          Dokumenty a podpora
        </Text>
        <Row accessibilityRole="link" testID="settings-privacy-link" label="Ochrana soukromí" detail="Jaká data služba používá a jak je můžete spravovat" icon={LockKey} onPress={() => void openPublicDocument(PRIVACY_POLICY_URL)} />
        <Row accessibilityRole="link" testID="settings-terms-link" label="Podmínky používání" detail="Pravidla služby a její bezpečnostní omezení" icon={FileText} onPress={() => void openPublicDocument(TERMS_URL)} />
        <Row accessibilityRole="link" testID="settings-support-link" label="Podpora" detail="Kontakt pro technické a účtové problémy; nejde o tísňovou linku" icon={Lifebuoy} onPress={() => void openPublicDocument(SUPPORT_URL)} />
        <View className="my-7"><Notice title="Hlásím se je kompletně zdarma" tone="success"><Text className="font-body text-[#245E3C]">Až 5 profilů a 5 strážců na profil, bez trialu, předplatného nebo placeného odemknutí.</Text></Notice></View>
        {logoutError ? <View className="mb-4"><Notice title={logoutError} tone="danger" /></View> : null}
        <Row testID="settings-sign-out" label="Odhlásit se" detail={pendingCount + failedPendingCount ? "Vyžaduje síť; nepotvrzená offline fronta bude po potvrzení serverem smazána" : "Vyžaduje síť kvůli odregistrování zařízení a odstraní lokální session i připomínky"} icon={SignOut} onPress={logout} danger={pendingCount + failedPendingCount > 0} />
        <Row testID="account-delete-open" label="Smazat účet" detail="Vyžaduje heslo; otevřený incident vašeho profilu musí být nejdřív vyřešen" icon={Trash} onPress={() => router.push("/(tabs)/delete-account")} danger />
        <View className="flex-row gap-3 items-start py-7"><ShieldWarning size={22} color={COLORS.error} /><Text className="font-body text-sm leading-5 text-muted flex-1">Hlásím se nekontaktuje tísňové služby. V bezprostředním ohrožení volejte 112 nebo 155.</Text></View>
      </ScrollView>
    </SafeAreaView>
  );
}
