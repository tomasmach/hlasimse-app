import { useCallback, useMemo, useState, type ComponentType } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import {
  Archive,
  ArrowRight,
  CheckCircle,
  ClockCounterClockwise,
  Pause,
  Play,
  ShieldWarning,
  UserCircle,
  WarningCircle,
  type IconProps,
} from "phosphor-react-native";
import { ActionButton, Metric, Notice, PageTitle } from "@/components/product/ProductUI";
import { useCheckInStore } from "@/stores/checkin";
import { useProductStore } from "@/stores/product";
import { COLORS } from "@/constants/design";
import { visibleAccessibleIncidents } from "@/lib/incidentVisibility";
import type {
  AlertDeliveryState,
  ProfileTimelineEvent,
  ProfileTimelineEventType,
} from "@/types/product";

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );

const deliveryLabel: Record<AlertDeliveryState, string> = {
  no_delivery_record: "Bez záznamu o odeslání",
  pending: "Čeká na pokus o odeslání",
  sent_to_provider: "Odesláno poskytovateli — doručení nepotvrzeno",
  delivered: "Doručeno alespoň na jedno zařízení",
  failed: "Pokus o doručení selhal",
};

type TimelineTone = "success" | "warning" | "info" | "danger";

interface TimelinePresentation {
  title: string;
  detail: string;
  category: string;
  tone: TimelineTone;
  Icon: ComponentType<IconProps>;
  incidentId: string | null;
}

const timelineCategory: Record<ProfileTimelineEventType, string> = {
  "profile.created": "Vznik profilu",
  "profile.paused": "Pauza",
  "profile.resumed": "Obnovení",
  "profile.archived": "Archivace",
  "checkin.confirmed": "Check-in",
  "incident.opened": "Incident otevřen",
  "incident.resolved": "Incident vyřešen",
};

function timelinePresentation(event: ProfileTimelineEvent): TimelinePresentation {
  switch (event.event_type) {
    case "checkin.confirmed": {
      const resolution = event.details.resolved_incident_count
        ? ` Vyřešil ${event.details.resolved_incident_count} aktivní incident.`
        : "";
      return {
        title: "Check-in potvrzen serverem",
        detail: event.details.submitted_from_queue
          ? `Synchronizováno později z offline fronty. Rozhodující je čas přijetí serverem.${resolution}`
          : `Odesláno přímo a potvrzeno serverem.${resolution}`,
        category: timelineCategory[event.event_type],
        tone: event.details.resolved_incident_count ? "warning" : "success",
        Icon: CheckCircle,
        incidentId: null,
      };
    }
    case "incident.opened":
      return {
        title: "Server otevřel incident",
        detail: `Serverový termín uplynul ${formatDateTime(event.details.deadline_at)}.`,
        category: timelineCategory[event.event_type],
        tone: "danger",
        Icon: ShieldWarning,
        incidentId: event.details.incident_id,
      };
    case "incident.resolved":
      return {
        title: "Incident vyřešen potvrzeným check-inem",
        detail: "Vyřešení potvrdil server; incident zůstává v bezpečnostní historii.",
        category: timelineCategory[event.event_type],
        tone: "success",
        Icon: CheckCircle,
        incidentId: event.details.incident_id,
      };
    case "profile.paused":
      return {
        title: event.details.automatic
          ? "Profil automaticky přešel do pauzy"
          : "Pauza potvrzena serverem",
        detail: event.details.has_scheduled_resume
          ? "Server evidoval naplánované automatické obnovení."
          : "Pauza neměla naplánovaný konec.",
        category: timelineCategory[event.event_type],
        tone: "info",
        Icon: Pause,
        incidentId: null,
      };
    case "profile.resumed":
      return {
        title: event.details.automatic
          ? "Profil automaticky obnoven"
          : "Obnovení potvrzeno serverem",
        detail: "Server založil novou generaci termínu bez zpětného incidentu za dobu pauzy.",
        category: timelineCategory[event.event_type],
        tone: "info",
        Icon: Play,
        incidentId: null,
      };
    case "profile.archived":
      return {
        title: "Profil archivován",
        detail: `Server zrušil termín a odvolal ${event.details.revoked_membership_count} vztahů strážců a ${event.details.revoked_invitation_count} čekajících pozvánek.`,
        category: timelineCategory[event.event_type],
        tone: "warning",
        Icon: Archive,
        incidentId: null,
      };
    case "profile.created":
      return {
        title: "Profil vytvořen",
        detail: `Server založil první termín s intervalem ${event.details.interval_seconds / 60} minut.`,
        category: timelineCategory[event.event_type],
        tone: "info",
        Icon: UserCircle,
        incidentId: null,
      };
  }
}

const timelineColors: Record<TimelineTone, string> = {
  success: "#245E3C",
  warning: COLORS.warning,
  info: "#315C5D",
  danger: COLORS.error,
};

export default function ActivityScreen() {
  const { profile, pendingItems } = useCheckInStore();
  const product = useProductStore();
  const [refreshing, setRefreshing] = useState(false);
  const [periodDays, setPeriodDays] = useState<30 | 90 | 0>(30);
  const [showDefinitions, setShowDefinitions] = useState(false);

  const filter = useMemo(
    () => ({
      ...(profile ? { profile: profile.id } : {}),
      ...(periodDays
        ? { from: new Date(Date.now() - periodDays * 86_400_000).toISOString() }
        : {}),
    }),
    [profile?.id, periodDays],
  );

  const load = useCallback(async () => {
    await Promise.allSettled([
      profile ? product.loadTimeline(profile.id) : Promise.resolve(),
      product.loadStatistics(filter),
      product.loadAlerts(),
    ]);
  }, [filter, profile?.id, product.loadTimeline, product.loadStatistics, product.loadAlerts]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };
  const profileAlerts = visibleAccessibleIncidents(product.alerts);
  const timeline = product.timelineProfileId === profile?.id ? product.timeline : null;
  const timelineLoading = product.resources.timeline.status === "loading";
  const error =
    product.resources.timeline.error ||
    product.resources.statistics.error ||
    product.resources.alerts.error;

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView
        contentContainerClassName="px-5 pt-5 pb-36"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={COLORS.brand[500]}
          />
        }
      >
        <PageTitle
          title="Časová stopa"
          subtitle={
            profile
              ? `${profile.name} · časová osa pochází pouze ze serveru`
              : "Pro časovou osu vyberte vlastní profil; incidenty strážce zůstávají níže."
          }
        />
        <View className="flex-row gap-2 mb-7" accessibilityRole="radiogroup">
          {(
            [
              { value: 30, label: "30 dní" },
              { value: 90, label: "90 dní" },
              { value: 0, label: "Vše" },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setPeriodDays(item.value)}
              className={`min-h-[44px] px-4 rounded-full items-center justify-center ${periodDays === item.value ? "bg-charcoal" : "bg-white border border-sand"}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: periodDays === item.value }}
            >
              <Text
                className={`font-body-semibold ${periodDays === item.value ? "text-white" : "text-charcoal"}`}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text className="font-body text-xs leading-5 text-muted -mt-4 mb-5">
          Období mění statistiky. Bezpečnostní časová osa se stránkuje v úplném serverovém pořadí.
        </Text>

        {error ? (
          <Notice title="Některá data se nepodařilo obnovit" tone="warning">
            <Text className="font-body text-[#7B4A08]">
              {error.message} Starší zobrazená data mohou být zastaralá.
            </Text>
          </Notice>
        ) : null}

        <View testID="statistics-section" className="py-8 border-b border-sand">
          <Text className="font-display text-[28px] text-charcoal mb-4">Co potvrzuje server</Text>
          {product.statistics ? (
            <View className="flex-row flex-wrap gap-x-5">
              <Metric
                value={product.statistics.total_check_ins}
                label="potvrzených check-inů"
              />
              <Metric
                value={product.statistics.on_time_check_ins}
                label="včasných check-inů"
              />
              <Metric
                value={product.statistics.incident_count}
                label="vzniklých incidentů v období"
              />
            </View>
          ) : (
            <ActivityIndicator color={COLORS.brand[500]} />
          )}
          <Pressable
            onPress={() => setShowDefinitions((value) => !value)}
            className="min-h-[44px] justify-center mt-2"
            accessibilityRole="button"
            accessibilityState={{ expanded: showDefinitions }}
          >
            <Text className="font-body-semibold text-brand-500">
              {showDefinitions ? "Skrýt definice metrik" : "Jak se metriky počítají"}
            </Text>
          </Pressable>
          {showDefinitions && product.statistics ? (
            <View className="gap-3 mt-2">
              {Object.values(product.statistics.definitions).map((definition) => (
                <Text key={definition} className="font-body text-sm leading-5 text-muted">
                  {definition}
                </Text>
              ))}
              <Text className="font-body text-sm leading-5 text-muted">
                Čekající nebo odmítnutý offline požadavek se do statistik nepočítá.
              </Text>
            </View>
          ) : null}
        </View>

        {pendingItems.length ? (
          <View className="py-7 border-b border-sand">
            <Text className="font-display text-[26px] text-charcoal mb-4">
              Mimo serverovou historii
            </Text>
            {pendingItems.map((item) => (
              <View key={item.id} className="py-3 flex-row gap-3">
                <WarningCircle
                  size={22}
                  color={item.status === "failed" ? COLORS.error : COLORS.warning}
                  weight="fill"
                />
                <View className="flex-1">
                  <Text className="font-body-semibold text-charcoal">
                    {item.status === "failed"
                      ? "Server odmítl požadavek"
                      : "Čeká na připojení"}
                  </Text>
                  <Text className="font-body text-sm text-muted mt-1">
                    {formatDateTime(item.clientRecordedAt)} · původní termín zůstal beze změny
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View className="py-8 border-b border-sand">
          <Text className="font-display text-[28px] text-charcoal mb-2">
            Incidenty, ke kterým máte přístup
          </Text>
          <Text className="font-body text-sm leading-5 text-muted mb-4">
            Zahrnuje vaše profily i profily, které hlídáte. Kompletní check-in historii hlídaných
            lidí zde neuvidíte.
          </Text>
          {profileAlerts.length ? (
            profileAlerts.map((alert) => (
              <Pressable
                testID={`incident-open-${alert.id}`}
                key={alert.id}
                onPress={() =>
                  router.push({
                    pathname: "/(tabs)/incident/[id]",
                    params: { id: alert.id },
                  })
                }
                className="py-5 border-b border-sand flex-row gap-4"
                accessibilityRole="button"
                accessibilityLabel={`${alert.status === "open" ? "Aktivní" : "Vyřešený"} incident profilu ${alert.profile_name}`}
              >
                <WarningCircle
                  size={25}
                  weight="fill"
                  color={alert.status === "open" ? COLORS.error : "#315C5D"}
                />
                <View className="flex-1">
                  <View className="flex-row justify-between gap-3">
                    <Text className="font-body-semibold text-base text-charcoal flex-1">
                      {alert.status === "open" ? "Aktivní incident" : "Vyřešený incident"}
                    </Text>
                    <ArrowRight size={20} color={COLORS.muted} />
                  </View>
                  <Text className="font-body text-sm text-muted mt-1">
                    Otevřen {formatDateTime(alert.opened_at)}
                  </Text>
                  <Text className="font-body text-sm leading-5 text-muted mt-2">
                    {deliveryLabel[alert.delivery_status.state]}
                  </Text>
                </View>
              </Pressable>
            ))
          ) : (
            <Text className="font-body text-muted py-2">
              Nejsou zobrazené žádné přístupné incidenty.
            </Text>
          )}
        </View>

        <View testID="history-section" className="py-8">
          <Text className="font-display text-[28px] text-charcoal mb-2">
            Úplná časová osa profilu
          </Text>
          <Text className="font-body text-sm leading-5 text-muted mb-6">
            Check-iny, pauzy, obnovení, incidenty a archivace v jednom serverovém pořadí. Poloha
            zde nikdy není.
          </Text>

          {!profile ? (
            <Notice title="Časová osa patří vlastníkovi profilu" tone="info">
              <Text className="font-body text-[#315C5D]">
                Jako strážce uvidíte přístupné incidenty výše, ne kompletní soukromou historii
                hlídaného člověka.
              </Text>
            </Notice>
          ) : timelineLoading && !timeline ? (
            <ActivityIndicator color={COLORS.brand[500]} />
          ) : timeline?.results.length ? (
            <View>
              {timeline.results.map((event, index) => {
                const presentation = timelinePresentation(event);
                const color = timelineColors[presentation.tone];
                const isLast = index === timeline.results.length - 1 && !timeline.next;
                const body = (
                  <>
                    <View className="w-11 items-center self-stretch">
                      <View
                        className="w-10 h-10 rounded-full items-center justify-center"
                        style={{ backgroundColor: `${color}18` }}
                      >
                        <presentation.Icon size={21} color={color} weight="fill" />
                      </View>
                      {!isLast ? (
                        <View className="w-px flex-1 bg-sand min-h-[36px] mt-2" />
                      ) : null}
                    </View>
                    <View className="flex-1 pb-8">
                      <Text className="font-body-semibold text-[13px]" style={{ color }}>
                        {presentation.category}
                      </Text>
                      <Text className="font-body-semibold text-base text-charcoal mt-1">
                        {presentation.title}
                      </Text>
                      <Text className="font-body text-sm text-muted mt-1">
                        {formatDateTime(event.occurred_at)}
                      </Text>
                      <Text className="font-body text-sm leading-5 text-muted mt-2">
                        {presentation.detail}
                      </Text>
                    </View>
                    {presentation.incidentId ? (
                      <ArrowRight size={20} color={COLORS.muted} />
                    ) : null}
                  </>
                );
                return presentation.incidentId ? (
                  <Pressable
                    key={event.id}
                    testID={`timeline-incident-${presentation.incidentId}`}
                    onPress={() =>
                      router.push({
                        pathname: "/(tabs)/incident/[id]",
                        params: { id: presentation.incidentId! },
                      })
                    }
                    className="flex-row gap-3"
                    accessibilityRole="button"
                    accessibilityLabel={`${presentation.title}, ${formatDateTime(event.occurred_at)}`}
                  >
                    {body}
                  </Pressable>
                ) : (
                  <View key={event.id} className="flex-row gap-3">
                    {body}
                  </View>
                );
              })}
              {timeline.next ? (
                <View className="mt-2">
                  <ActionButton
                    testID="timeline-load-more"
                    label="Načíst starší události"
                    variant="quiet"
                    loading={timelineLoading}
                    onPress={() => void product.loadMoreTimeline(profile.id)}
                  />
                </View>
              ) : (
                <Text className="font-body text-xs leading-5 text-muted mt-1">
                  Zobrazen začátek serverové historie tohoto profilu.
                </Text>
              )}
            </View>
          ) : (
            <View className="py-6 items-center">
              <ClockCounterClockwise size={32} color={COLORS.muted} />
              <Text className="font-body text-muted mt-3 text-center">
                Časová osa profilu je zatím prázdná.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
