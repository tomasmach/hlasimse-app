import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowRight, ClockCounterClockwise, WarningCircle } from "phosphor-react-native";
import { PageTitle, Metric, Notice, StatusLabel } from "@/components/product/ProductUI";
import { useCheckInStore } from "@/stores/checkin";
import { useProductStore } from "@/stores/product";
import { COLORS } from "@/constants/design";
import type { AlertDeliveryState } from "@/types/product";
import type { ProfileTimelineEvent } from "@/types/product";
import { visibleAccessibleIncidents } from "@/lib/incidentVisibility";

const formatDateTime = (value: string) => new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const deliveryLabel: Record<AlertDeliveryState, string> = {
  no_delivery_record: "Bez záznamu o odeslání",
  pending: "Čeká na pokus o odeslání",
  sent_to_provider: "Odesláno poskytovateli — doručení nepotvrzeno",
  delivered: "Doručeno alespoň na jedno zařízení",
  failed: "Pokus o doručení selhal",
};

const timelineCopy = (event: ProfileTimelineEvent): { title: string; detail: string; tone: "success" | "warning" | "info" | "danger" } => {
  switch (event.event_type) {
    case "checkin.confirmed": return { title: "Check-in potvrzen serverem", detail: event.details.submitted_from_queue ? "Synchronizováno později z offline fronty. Rozhodující je čas přijetí serverem." : "Server požadavek přijal a vrátil nový termín.", tone: event.details.resolved_incident_count ? "warning" : "success" };
    case "incident.opened": return { title: "Server otevřel incident", detail: `Prošel termín ${event.details.deadline_at ? formatDateTime(event.details.deadline_at) : "profilu"}.`, tone: "danger" };
    case "incident.resolved": return { title: "Incident vyřešen potvrzeným check-inem", detail: "Incident zůstává v auditní historii.", tone: "success" };
    case "profile.paused": return { title: event.details.automatic ? "Profil automaticky přešel do pauzy" : "Pauza potvrzena serverem", detail: event.details.has_scheduled_resume ? "Pauza měla naplánované automatické obnovení." : "Pauza byla bez nastaveného konce.", tone: "info" };
    case "profile.resumed": return { title: event.details.automatic ? "Profil automaticky obnoven" : "Obnovení potvrzeno serverem", detail: "Server nastavil nový termín bez zpětného incidentu za dobu pauzy.", tone: "info" };
    case "profile.archived": return { title: "Profil archivován", detail: "Termín byl zrušen a vztahy strážců odvolány.", tone: "warning" };
    default: return { title: "Profil vytvořen", detail: "Server vytvořil první termín podle nastaveného intervalu.", tone: "info" };
  }
};

export default function ActivityScreen() {
  const { profile, pendingItems } = useCheckInStore();
  const product = useProductStore();
  const [refreshing, setRefreshing] = useState(false);
  const [periodDays, setPeriodDays] = useState<30 | 90 | 0>(30);
  const [showDefinitions, setShowDefinitions] = useState(false);

  const filter = useMemo(() => ({
    ...(profile ? { profile: profile.id } : {}),
    ...(periodDays ? { from: new Date(Date.now() - periodDays * 86400000).toISOString() } : {}),
  }), [profile?.id, periodDays]);

  const load = useCallback(async () => {
    await Promise.allSettled([profile ? product.loadTimeline(profile.id) : Promise.resolve(), product.loadStatistics(filter), product.loadAlerts()]);
  }, [filter, profile?.id, product.loadTimeline, product.loadStatistics, product.loadAlerts]);

  useEffect(() => { void load(); }, [load]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const profileAlerts = visibleAccessibleIncidents(product.alerts);
  const error = product.resources.timeline.error || product.resources.statistics.error || product.resources.alerts.error;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 pt-5 pb-36" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.brand[500]} />}>
        <PageTitle title="Časová stopa" subtitle={profile ? `${profile.name} · pouze serverem potvrzená data` : "Vyberte profil na domovské obrazovce"} />
        <View className="flex-row gap-2 mb-7" accessibilityRole="radiogroup">
          {([{ value: 30, label: "30 dní" }, { value: 90, label: "90 dní" }, { value: 0, label: "Vše" }] as const).map((item) => (
            <Pressable key={item.value} onPress={() => setPeriodDays(item.value)} className={`min-h-[44px] px-4 rounded-full items-center justify-center ${periodDays === item.value ? "bg-charcoal" : "bg-white border border-sand"}`} accessibilityRole="radio" accessibilityState={{ checked: periodDays === item.value }}>
              <Text className={`font-body-semibold ${periodDays === item.value ? "text-white" : "text-charcoal"}`}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {error ? <Notice title="Některá data se nepodařilo obnovit" tone="warning"><Text className="font-body text-[#7B4A08]">{error.message} Starší zobrazená data mohou být zastaralá.</Text></Notice> : null}

        <View testID="statistics-section" className="py-8 border-b border-sand">
          <Text className="font-display text-[28px] text-charcoal mb-4">Co potvrzuje server</Text>
          {product.statistics ? (
            <View className="flex-row flex-wrap gap-x-5">
              <Metric value={product.statistics.total_check_ins} label="potvrzených check-inů" />
              <Metric value={product.statistics.on_time_check_ins} label="včasných check-inů" />
              <Metric value={product.statistics.incident_count} label="vzniklých incidentů v období" />
            </View>
          ) : <ActivityIndicator color={COLORS.brand[500]} />}
          <Pressable onPress={() => setShowDefinitions((value) => !value)} className="min-h-[44px] justify-center mt-2" accessibilityRole="button" accessibilityState={{ expanded: showDefinitions }}>
            <Text className="font-body-semibold text-brand-500">{showDefinitions ? "Skrýt definice metrik" : "Jak se metriky počítají"}</Text>
          </Pressable>
          {showDefinitions && product.statistics ? (
            <View className="gap-3 mt-2">
              {Object.values(product.statistics.definitions).map((definition) => <Text key={definition} className="font-body text-sm leading-5 text-muted">{definition}</Text>)}
              <Text className="font-body text-sm leading-5 text-muted">Čekající nebo odmítnutý offline požadavek se do statistik nepočítá.</Text>
            </View>
          ) : null}
        </View>

        {pendingItems.length ? (
          <View className="py-7 border-b border-sand">
            <Text className="font-display text-[26px] text-charcoal mb-4">Mimo serverovou historii</Text>
            {pendingItems.map((item) => (
              <View key={item.id} className="py-3 flex-row gap-3">
                <WarningCircle size={22} color={item.status === "failed" ? COLORS.error : COLORS.warning} weight="fill" />
                <View className="flex-1"><Text className="font-body-semibold text-charcoal">{item.status === "failed" ? "Server odmítl požadavek" : "Čeká na připojení"}</Text><Text className="font-body text-sm text-muted mt-1">{formatDateTime(item.clientRecordedAt)} · původní termín zůstal beze změny</Text></View>
              </View>
            ))}
          </View>
        ) : null}

        <View className="py-8 border-b border-sand">
          <Text className="font-display text-[28px] text-charcoal mb-2">Incidenty, ke kterým máte přístup</Text>
          <Text className="font-body text-sm leading-5 text-muted mb-4">Zahrnuje vaše profily i profily, které hlídáte. Kompletní check-in historii hlídaných lidí zde neuvidíte.</Text>
          {profileAlerts.length ? profileAlerts.map((alert) => (
            <Pressable testID={`incident-open-${alert.id}`} key={alert.id} onPress={() => router.push({ pathname: "/(tabs)/incident/[id]", params: { id: alert.id } })} className="py-5 border-b border-sand flex-row gap-4" accessibilityRole="button" accessibilityLabel={`${alert.status === "open" ? "Aktivní" : "Vyřešený"} incident profilu ${alert.profile_name}`}>
              <WarningCircle size={25} weight="fill" color={alert.status === "open" ? COLORS.error : "#315C5D"} />
              <View className="flex-1">
                <View className="flex-row justify-between gap-3"><Text className="font-body-semibold text-base text-charcoal flex-1">{alert.status === "open" ? "Aktivní incident" : "Vyřešený incident"}</Text><ArrowRight size={20} color={COLORS.muted} /></View>
                <Text className="font-body text-sm text-muted mt-1">Otevřen {formatDateTime(alert.opened_at)}</Text>
                <Text className="font-body text-sm leading-5 text-muted mt-2">{deliveryLabel[alert.delivery_status.state]}</Text>
              </View>
            </Pressable>
          )) : <Text className="font-body text-muted py-2">V tomto období nejsou zobrazené žádné incidenty.</Text>}
        </View>

        <View testID="history-section" className="py-8">
          <Text className="font-display text-[28px] text-charcoal mb-2">Úplná časová osa profilu</Text>
          <Text className="font-body text-sm leading-5 text-muted mb-4">Serverem potvrzené check-iny, pauzy, obnovení a incidenty v jedné chronologii. Neobsahuje polohu.</Text>
          {product.timeline?.results.length ? product.timeline.results.map((event) => {
            const copy = timelineCopy(event);
            const incidentId = event.details.incident_id;
            const content = <><View className="flex-1"><Text className="font-body-semibold text-base text-charcoal">{copy.title}</Text><Text className="font-body text-sm text-muted mt-1">{formatDateTime(event.occurred_at)}</Text><Text className="font-body text-sm leading-5 text-muted mt-2">{copy.detail}</Text><View className="mt-3"><StatusLabel label={event.event_type.replace(".", " · ")} tone={copy.tone} /></View></View>{incidentId ? <ArrowRight size={20} color={COLORS.muted} /> : null}</>;
            return incidentId ? <Pressable key={event.id} onPress={() => router.push({ pathname: "/(tabs)/incident/[id]", params: { id: incidentId } })} className="py-5 border-b border-sand flex-row gap-4" accessibilityRole="button" accessibilityLabel={`${copy.title}, ${formatDateTime(event.occurred_at)}`}>{content}</Pressable> : <View key={event.id} className="py-5 border-b border-sand flex-row gap-4">{content}</View>;
          }) : <View className="py-6 items-center"><ClockCounterClockwise size={32} color={COLORS.muted} /><Text className="font-body text-muted mt-3 text-center">Časová osa profilu je zatím prázdná.</Text></View>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
