import { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { MapPin, Phone, ShieldWarning } from "phosphor-react-native";
import { ActionButton, BackHeader, Notice, StatusLabel } from "@/components/product/ProductUI";
import { useAuth } from "@/hooks/useAuth";
import { useProductStore } from "@/stores/product";
import type { AlertDeliveryState, AlertIncident } from "@/types/product";
import { COLORS } from "@/constants/design";

const delivery: Record<AlertDeliveryState, { label: string; detail: string; tone: "info" | "warning" | "danger" | "success" }> = {
  no_delivery_record: { label: "Bez záznamu o odeslání", detail: "Server zatím neeviduje pokus o push.", tone: "warning" },
  pending: { label: "Čeká na pokus o odeslání", detail: "Push je ve frontě nebo se bude opakovat.", tone: "warning" },
  sent_to_provider: { label: "Odesláno poskytovateli", detail: "Poskytovatel přijal požadavek nebo ticket. Doručení ani přečtení tím není potvrzeno.", tone: "info" },
  accepted_by_push_service: { label: "Přijato službou APNs/FCM", detail: "Push služba požadavek převzala. Zobrazení na zařízení ani přečtení tím není potvrzeno.", tone: "info" },
  failed: { label: "Pokus o doručení selhal", detail: "Nespoléhejte na push. Použijte jiný kontakt a podle situace tísňovou linku.", tone: "danger" },
};
const formatDateTime = (value: string | null) => value ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

export default function IncidentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const product = useProductStore();
  const [incident, setIncident] = useState<AlertIncident | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setIncident(null);
    setError("");
    if (id) void product.loadAlert(id).then(setIncident).catch((reason) => setError(reason instanceof Error ? reason.message : "Incident se nepodařilo načíst."));
  }, [id]);
  if (!incident) return <SafeAreaView className="flex-1 bg-cream px-5"><BackHeader title="Incident" />{error ? <Notice title={error} tone="danger" /> : <Text className="font-body text-muted">Načítáme serverový stav…</Text>}</SafeAreaView>;
  const state = delivery[incident.delivery_status.state];
  const acknowledged = incident.acknowledgements.some((item) => item.user_id === user?.id);
  const acknowledge = async () => { setBusy(true); setError(""); try { setIncident(await product.acknowledgeAlert(incident.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Potvrzení se nepodařilo uložit."); } finally { setBusy(false); } };
  const location = incident.last_known_location;
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
          <View className="mt-4 gap-2">{Object.entries(incident.delivery_status.attempt_counts).map(([key, count]) => <Text key={key} className="font-body text-sm text-muted">{key}: {count}</Text>)}</View>
        </View>
        <View className="py-8 border-b border-sand">
          <Text className="font-display text-[26px] text-charcoal mb-3">Poslední známá poloha</Text>
          {location && incident.status === "open" ? (
            <View>
              <View className="flex-row gap-3"><MapPin size={23} color={COLORS.brand[500]} /><Text className="font-body text-base text-charcoal flex-1">{location.latitude}, {location.longitude}{location.accuracy_meters ? ` · přesnost přibližně ${location.accuracy_meters} m` : ""}</Text></View>
              <Text className="font-body text-sm leading-5 text-muted mt-3">Zaznamenána {formatDateTime(location.recorded_at)}. Nejde o živé sledování.</Text>
              <View className="mt-4"><ActionButton label="Otevřít v mapě" variant="quiet" onPress={() => void Linking.openURL(Platform.OS === "ios" ? `https://maps.apple.com/?q=${location.latitude},${location.longitude}` : `geo:${location.latitude},${location.longitude}?q=${location.latitude},${location.longitude}`)} /></View>
            </View>
          ) : <Text className="font-body text-muted">Poloha není dostupná. Po vyřešení incidentu ji strážce nesmí zobrazit.</Text>}
        </View>
        <View className="py-8">
          <Text className="font-display text-[26px] text-charcoal mb-3">Potvrzení strážce</Text>
          {incident.can_acknowledge ? <><Text className="font-body text-sm leading-5 text-muted mb-4">„Viděl/a jsem incident“ pouze uloží potvrzení na serveru. Incident tím nevyřešíte a nikoho dalšího automaticky nekontaktujete.</Text><ActionButton testID="incident-acknowledge" label={acknowledged ? "Potvrzení uloženo serverem" : "Viděl/a jsem incident"} variant={acknowledged ? "quiet" : "primary"} disabled={acknowledged} loading={busy} onPress={() => void acknowledge()} /></> : <Text className="font-body text-sm leading-5 text-muted">Potvrzení mohou ukládat pouze aktivní strážci otevřeného incidentu.</Text>}
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
