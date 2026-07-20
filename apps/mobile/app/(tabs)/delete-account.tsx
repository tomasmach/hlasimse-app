import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Warning } from "phosphor-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { useProductStore } from "@/stores/product";
import { apiRequest } from "@/lib/api";
import { ActionButton, BackHeader, Notice } from "@/components/product/ProductUI";
import { COLORS } from "@/constants/design";

export default function DeleteAccountScreen() {
  const { signOut } = useAuth();
  const { profiles, pendingCount, failedPendingCount } = useCheckInStore();
  const resetProduct = useProductStore((state) => state.reset);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = () => {
    if (!password) return setError("Zadejte heslo pro výslovné potvrzení.");
    Alert.alert("Trvale smazat účet?", "Server operaci odmítne, pokud jste vlastník nebo příjemce aktivního incidentu. Uzavřená bezpečnostní auditní stopa může zůstat anonymizovaná podle retenčních pravidel.", [
      { text: "Zrušit", style: "cancel" },
      { text: "Smazat účet", style: "destructive", onPress: async () => {
        setBusy(true); setError("");
        try {
          await apiRequest<void>("/api/v1/account/", { method: "DELETE", body: { password, confirmed: true } });
          resetProduct();
          await signOut();
          router.replace("/(auth)/login");
        } catch (reason) { setError(reason instanceof Error ? reason.message : "Server účet nesmazal."); }
        finally { setBusy(false); }
      } },
    ]);
  };
  return <SafeAreaView className="flex-1 bg-cream"><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1"><ScrollView contentContainerClassName="px-5 pb-36" keyboardShouldPersistTaps="handled"><BackHeader title="Odstranění účtu" onBack={() => router.replace("/(tabs)/settings")} /><Warning size={42} color={COLORS.error} weight="fill" /><Text className="font-display text-[38px] leading-[42px] text-charcoal mt-5">Nejdřív bezpečně uzavřete vztahy</Text><Text className="font-body text-base leading-6 text-muted mt-4">Odstranění zasáhne {profiles.length} profilů, jejich strážce, čekající pozvánky, registrovaná zařízení a přístup k datům. Aktivní incident musíte nejdřív vyřešit potvrzeným check-inem nebo bezpečným postupem.</Text>{pendingCount + failedPendingCount ? <View className="mt-6"><Notice title="Nepotvrzená offline fronta bude odstraněna" tone="danger"><Text className="font-body text-[#9E2E2A]">{pendingCount + failedPendingCount} požadavků není serverovým check-inem a neposunulo termín.</Text></Notice></View> : null}{error ? <View className="mt-5"><Notice title={error} tone="danger" /></View> : null}<View className="mt-8"><Text className="font-body-semibold text-sm text-charcoal mb-2">Heslo</Text><TextInput testID="account-delete-password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="password" editable={!busy} className="min-h-[56px] bg-white rounded-[18px] px-4 font-body text-[17px] text-charcoal border border-sand" placeholder="Potvrďte heslem" placeholderTextColor={COLORS.muted} accessibilityLabel="Heslo pro smazání účtu" /></View><View className="mt-7"><ActionButton testID="account-delete-submit" label="Trvale smazat účet" variant="danger" loading={busy} onPress={submit} /></View><Text className="font-body text-sm leading-5 text-muted mt-5">Tato akce není způsob řešení incidentu. V bezprostředním ohrožení volejte 112 nebo 155.</Text></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
