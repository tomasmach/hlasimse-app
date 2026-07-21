import { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { MapPin, Phone, ShieldWarning } from "phosphor-react-native";
import { ActionButton, BackHeader, Notice, StatusLabel } from "@/components/product/ProductUI";
import { useAuth } from "@/hooks/useAuth";
import { useProductStore } from "@/stores/product";
import type { DeliveryAttemptStatus } from "@/types/product";
import { COLORS } from "@/constants/design";
import { deliveryAttemptLabel, deliveryStatePresentation } from "@/lib/deliveryPresentation";

const formatDateTime = (value: string | null) => value ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const product = useProductStore();
  const incident = id ? product.alertDetails[id] ?? null : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setError("");
    if (id) void product.loadAlert(id).catch((reason) => setError(reason instanceof Error ? reason.message : "Incident se nepodařilo načíst."));
  }, [id, product.loadAlert]);
  if (!incident) return <SafeAreaView className="flex-1 bg-cream px-5"><BackHeader title="Incident" />{error ? <Notice title={error} tone="danger" /> : <Text className="font-body text-muted">Načítáme serverový stav…</Text>}</SafeAreaView>;
  const state = deliveryStatePresentation[incident.delivery_status.state];
  const acknowledged = incident.acknowledgements.some((item) => item.user_id === user?.id);
  const acknowledge = async () => { setBusy(true); setError(""); try { await product.acknowledgeAlert(incident.id); } catch (reason) { setError(reason instanceof Error ? reason.message : "Potvrzení se nepodařilo uložit."); } finally { setBusy(false); } };
  const location = incident.last_known_location;
  const attempts = Object.entries(incident.delivery_status.attempt_counts) as [DeliveryAttemptStatus, number][];
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView contentContainerClassName="px-5 pb-36">
        <BackHeader title="Detail incidentu" />
        <View className="pt-5 pb-8 border-b border-sand">
          <StatusLabel label={incident.status === "open" ? "Aktivní incident" : "Incident vyřešen"} tone={incident.status === "open" ? "danger" : "success"} />
          <Text className="font-display text-[38px] leading-[42px] text-charcoal mt-5">{incident.profile_name}</Text>
          <Text className="font-body text-base text-muted mt-3">Termín: {formatDateTime(incident.deadline_at)}{"\n"}Otevřen: {formatDateTime(incident.opened_at)}{"\n"}{incident.resolved_at ? `Vyřešen: ${formatDateTime(incident.resolved_at)}` : "Dosud nevyřešen"}</Text>
        </View>
        {error ? <View className="mt-5"><Notice title={error} tone="danger" /></View> : null}
        <View className="py-8 border-b border-sand">
          <Text className="font-display text-[26px] text-charcoal mb-4">Stav push upozornění</Text>
          <Notice title={state.label} tone={state.tone}><Text className="font-body leading-5" style={{ color: state.tone === "danger" ? "#9E2E2A" : state.tone === "warning" ? "#7B4A08" : state.tone === "success" ? "#245E3C" : "#315C5D" }}>{state.detail}</Text></Notice>
          {attempts.length ? <View className="mt-5 pt-4 border-t border-sand">
            <Text className="font-body-semibold text-xs text-muted uppercase tracking-wider mb-2">Technický průběh</Text>
            {attempts.map(([key, count]) => <View key={key} className="min-h-[36px] py-2 flex-row gap-4 border-b border-sand"><Text className="font-body text-sm text-charcoal flex-1">{deliveryAttemptLabel[key]}</Text><Text className="font-body-semibold text-sm text-muted">{count}×</Text></View>)}
          </View> : null}
        </View>
        <View className="py-8 border-b border-sand">
          <Text className="font-display text-[26px] text-charcoal mb-3">Poslední známá poloha</Text>
          {location && incident.status === "open" ? (
            <View>
              <View className="flex-row gap-3"><MapPin size={23} color={COLORS.brand[500]} /><Text className="font-body text-base text-charcoal flex-1">{location.latitude}, {location.longitude}{location.accuracy_meters ? ` · přesnost přibližně ${location.accuracy_meters} m` : ""}</Text></View>
              <Text className="font-body text-sm leading-5 text-muted mt-3">Zaznamenána {formatDateTime(location.recorded_at)}. Nejde o živé sledování.</Text>
              <View className="mt-4"><ActionButton label="Otevřít v mapě" variant="quiet" onPress={() => void Linking.openURL(Platform.OS === "ios" ? `https://maps.apple.com/?q=${location.latitude},${location.longitude}` : `geo:${location.latitude},${location.longitude}?q=${location.latitude},${location.longitude}`)} /></View>
            </View>
          ) : <Text className="font-body text-muted">Poloha je v detailu dostupná pouze po dobu aktivního incidentu a jen oprávněným účtům.</Text>}
        </View>
        <View className="py-8">
          <Text className="font-display text-[26px] text-charcoal mb-3">Koordinace strážců</Text>
          <Text className="font-body text-sm leading-5 text-muted mb-4">Potvrzení znamená jen to, že strážce otevřel incident v aplikaci. Nepotvrzuje telefonát, zásah, doručení push ani bezpečí člověka.</Text>
          {incident.acknowledgements.length ? <View className="border-t border-sand mb-5">
            {incident.acknowledgements.map((item) => <View testID={`incident-acknowledgement-${item.user_id}`} key={item.user_id} className="min-h-[58px] py-3 border-b border-sand justify-center"><Text className="font-body-semibold text-base text-charcoal">{item.display_name}{item.user_id === user?.id ? " · vy" : ""}</Text><Text className="font-body text-sm text-muted mt-1">Incident zobrazen {formatDateTime(item.acknowledged_at)}</Text></View>)}
          </View> : <Text className="font-body text-sm leading-5 text-muted mb-5">Zatím žádný strážce nepotvrdil, že incident viděl.</Text>}
          {incident.can_acknowledge ? <ActionButton testID="incident-acknowledge" label={acknowledged ? "Potvrzení uloženo serverem" : "Viděl/a jsem incident"} variant={acknowledged ? "quiet" : "primary"} disabled={acknowledged} loading={busy} onPress={() => void acknowledge()} /> : null}
        </View>
        <View className="bg-charcoal rounded-[26px] p-5">
          <View className="flex-row gap-3"><ShieldWarning size={24} color="#FF8A7A" /><Text className="font-body-semibold text-white flex-1">Aplikace nezajišťuje fyzickou pomoc</Text></View>
          <Text className="font-body text-sm leading-5 text-white/70 mt-3">Pokud může být člověk v bezprostředním ohrožení, jednejte podle situace a volejte 112 nebo 155.</Text>
          <View className="mt-4"><ActionButton label="Volat 112" variant="primary" icon={<Phone size={20} color="#251D18" />} onPress={() => void Linking.openURL("tel:112")} /></View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
