import { useEffect, useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ActionButton, BackHeader, Notice } from "@/components/product/ProductUI";
import { ProfileArchiveBlockedError, useCheckInStore } from "@/stores/checkin";
import { COLORS } from "@/constants/design";

export default function ProfileDetailScreen() {
  const { profile, profiles, pendingCount, failedPendingCount, isUsingCachedProfiles, updateProfile, deleteProfile } = useCheckInStore();
  const [name, setName] = useState(profile?.name || "");
  const [minutes, setMinutes] = useState(profile ? String(profile.interval_seconds / 60) : "1440");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [blockingIncident, setBlockingIncident] = useState<{
    id: string;
    detail: string;
  } | null>(null);

  useEffect(() => {
    if (profile) { setName(profile.name); setMinutes(String(profile.interval_seconds / 60)); }
  }, [profile?.id]);

  if (!profile) return null;

  const save = async () => {
    const parsed = Number(minutes);
    if (!name.trim()) return setError("Název profilu je povinný.");
    if (!Number.isInteger(parsed) || parsed < 60 || parsed > 10080) return setError("Interval musí být celé číslo od 60 do 10 080 minut.");
    setBusy(true); setError("");
    try {
      await updateProfile({ name: name.trim(), interval_seconds: parsed * 60 });
      router.back();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Změnu se nepodařilo potvrdit serverem."); }
    finally { setBusy(false); }
  };

  const archive = () => Alert.alert(
    "Archivovat profil?",
    "Server nejdřív ověří prošlý termín. Při aktivním incidentu archivaci odmítne. Po potvrzení zruší termín, odvolá strážce a pozvánky, ale zachová bezpečnostní auditní historii.",
    [{ text: "Zrušit", style: "cancel" }, { text: "Archivovat", style: "destructive", onPress: async () => {
      setBusy(true);
      setError("");
      setBlockingIncident(null);
      try {
        await deleteProfile(profile.id);
        router.back();
      } catch (reason) {
        if (reason instanceof ProfileArchiveBlockedError) {
          setBlockingIncident({ id: reason.incidentId, detail: reason.message });
        } else {
          setError(reason instanceof Error ? reason.message : "Server profil nearchivoval.");
        }
      } finally {
        setBusy(false);
      }
    } }],
  );

  const blocked = isUsingCachedProfiles;
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
        <ScrollView contentContainerClassName="px-5 pb-12" keyboardShouldPersistTaps="handled">
          <BackHeader title="Správa profilu" />
          <Text className="font-display text-[38px] leading-[42px] tracking-[-1px] text-charcoal mt-4">{profile.name}</Text>
          <Text className="font-body text-base text-muted mt-3">Profil {profiles.findIndex((item) => item.id === profile.id) + 1} z {profiles.length}. Server je autoritou intervalu i dalšího termínu.</Text>

          {blocked ? <View className="mt-6"><Notice title="Uložený offline náhled nelze měnit" tone="warning" /></View> : null}
          {pendingCount + failedPendingCount > 0 ? <View className="mt-4"><Notice title="Máte nepotvrzené požadavky" tone="warning"><Text className="font-body text-[#7B4A08]">Změna intervalu neposune původní čekající požadavky. Až je server přijme, použije aktuální serverová pravidla.</Text></Notice></View> : null}
          {error ? <View className="mt-4"><Notice title={error} tone="danger" /></View> : null}
          {blockingIncident ? (
            <View className="mt-4">
              <Notice title="Archivaci blokuje aktivní incident" tone="danger">
                <Text className="font-body text-[#9E2E2A] leading-5">{blockingIncident.detail} Incident nelze obejít archivací ani změnou místního času.</Text>
                <View className="mt-4">
                  <ActionButton
                    testID="profile-archive-open-incident"
                    label="Otevřít aktivní incident"
                    variant="dark"
                    onPress={() => router.push({ pathname: "/(tabs)/incident/[id]", params: { id: blockingIncident.id } })}
                  />
                </View>
              </Notice>
            </View>
          ) : null}

          <View className="mt-8">
            <Text className="font-body-semibold text-sm text-charcoal mb-2">Název</Text>
            <TextInput testID="profile-edit-name" value={name} onChangeText={setName} editable={!busy && !blocked} className="min-h-[56px] bg-white rounded-[18px] px-4 font-body text-[17px] text-charcoal border border-sand" placeholderTextColor={COLORS.muted} accessibilityLabel="Název profilu" />
          </View>
          <View className="mt-6">
            <Text className="font-body-semibold text-sm text-charcoal mb-2">Interval v celých minutách</Text>
            <TextInput testID="profile-edit-interval-minutes" value={minutes} onChangeText={setMinutes} keyboardType="number-pad" editable={!busy && !blocked} className="min-h-[56px] bg-white rounded-[18px] px-4 font-body text-[17px] text-charcoal border border-sand" placeholderTextColor={COLORS.muted} accessibilityLabel="Interval v minutách" />
            <View className="flex-row flex-wrap gap-2 mt-3">{[{ label: "1 hodina", value: "60" }, { label: "6 hodin", value: "360" }, { label: "12 hodin", value: "720" }, { label: "1 den", value: "1440" }, { label: "3 dny", value: "4320" }, { label: "7 dní", value: "10080" }].map((item) => <Text key={item.value} onPress={() => setMinutes(item.value)} accessibilityRole="button" className="font-body-semibold text-sm text-charcoal bg-sand rounded-full px-3 py-3">{item.label}</Text>)}</View>
            <Text className="font-body text-sm text-muted mt-3">60 až 10 080 minut. Uložení nastaví nový serverový termín od okamžiku potvrzení.</Text>
          </View>
          <View className="mt-8"><ActionButton testID="profile-edit-submit" label="Uložit na serveru" loading={busy} disabled={blocked} onPress={() => void save()} /></View>
          <View className="mt-12 pt-7 border-t border-sand">
            <Text className="font-body-semibold text-lg text-charcoal">Archivace profilu</Text>
            <Text className="font-body text-sm leading-5 text-muted mt-2">Archivace uvolní místo v limitu 5 aktivních profilů. Nejde o vymazání bezpečnostní historie a aktivní incident jí nelze obejít.</Text>
            <View className="mt-4"><ActionButton testID="profile-archive" label="Archivovat profil" variant="danger" disabled={busy || blocked} onPress={archive} /></View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
