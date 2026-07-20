import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { ArrowRight, BellRinging, Check, Eye, Plus, ShieldCheck, UserMinus, WarningCircle, X } from "phosphor-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { useGuardiansStore } from "@/stores/guardians";
import { useProductStore } from "@/stores/product";
import { AddGuardianModal } from "@/components/AddGuardianModal";
import { ActionButton, Notice, PageTitle, StatusLabel } from "@/components/product/ProductUI";
import { COLORS } from "@/constants/design";

const formatDateTime = (value: string | null) => value ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "bez termínu";

export default function GuardiansScreen() {
  const { user } = useAuth();
  const { profile, profiles, selectProfile, isUsingCachedProfiles } = useCheckInStore();
  const guardians = useGuardiansStore();
  const product = useProductStore();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    await Promise.allSettled([profile ? guardians.fetchMyGuardians(profile.id) : Promise.resolve(), profile ? guardians.fetchSentInvites(profile.id) : Promise.resolve(), guardians.fetchPendingInvites(), guardians.fetchWatchedProfiles(), product.loadAlerts()]);
  }, [user?.id, profile?.id, product.loadAlerts]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!user) return; guardians.subscribeToInvites(); return guardians.unsubscribeFromInvites; }, [user?.id]);
  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const removeGuardian = (id: string, label: string) => Alert.alert(
    "Odebrat strážce?",
    `${label} okamžitě ztratí přístup k profilu, aktivnímu incidentu i poslední známé poloze.`,
    [{ text: "Zrušit", style: "cancel" }, { text: "Odebrat", style: "destructive", onPress: () => void guardians.removeGuardian(id) }],
  );

  const stopWatching = (id: string, label: string) => Alert.alert(
    "Přestat hlídat?",
    `Okamžitě ztratíte přístup k profilu ${label}, jeho incidentu i poloze a další push se pro vás nebudou vytvářet.`,
    [{ text: "Zrušit", style: "cancel" }, { text: "Přestat hlídat", style: "destructive", onPress: () => void guardians.stopWatching(id) }],
  );

  if (!user) return null;
  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 pt-5 pb-36" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={COLORS.brand[500]} />}>
        <PageTitle title="Lidé kolem vás" subtitle="Vztah strážce vznikne až přijetím pozvánky. Push je best-effort a nenahrazuje tísňové služby." />
        {guardians.error ? <Notice title={guardians.error} tone="warning" /> : null}
        {isUsingCachedProfiles ? <View className="mt-4"><Notice title="Uložený offline náhled" tone="warning"><Text className="font-body text-[#7B4A08]">Vazby strážců nelze bez serveru bezpečně měnit.</Text></Notice></View> : null}

        <View className="py-6 border-b border-sand">
          <Text className="font-body-semibold text-sm text-muted mb-3">Strážci profilu</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 pr-5">
            {profiles.map((item) => <Pressable key={item.id} onPress={() => void selectProfile(item.id)} className={`min-h-[44px] rounded-full px-4 flex-row items-center gap-2 justify-center ${item.id === profile?.id ? "bg-charcoal" : "bg-white border border-sand"}`} accessibilityRole="radio" accessibilityState={{ checked: item.id === profile?.id }}><Text className={`font-body-semibold ${item.id === profile?.id ? "text-white" : "text-charcoal"}`}>{item.name}</Text>{item.id === profile?.id ? <Check size={16} color="#fff" /> : null}</Pressable>)}
          </ScrollView>
        </View>

        <View className="py-8 border-b border-sand">
          <View className="flex-row items-center justify-between gap-4 mb-4"><Text className="font-display text-[28px] text-charcoal">Moji strážci</Text><Text className="font-body text-sm text-muted">{guardians.myGuardians.length}/5 aktivních</Text></View>
          {guardians.isLoading && !guardians.myGuardians.length ? <ActivityIndicator color={COLORS.brand[500]} /> : guardians.myGuardians.length ? guardians.myGuardians.map((item) => {
            const name = item.display_name || item.email;
            return <View key={item.id} className="min-h-[72px] py-4 border-b border-sand flex-row items-center gap-4"><View className="w-11 h-11 rounded-full bg-[#E5F3EA] items-center justify-center"><ShieldCheck size={23} color="#245E3C" weight="fill" /></View><View className="flex-1"><Text className="font-body-semibold text-base text-charcoal">{name}</Text><Text className="font-body text-sm text-muted mt-1">Přijal/a pozvánku · aktivní přístup</Text></View><Pressable testID={`guardian-revoke-${item.id}`} onPress={() => removeGuardian(item.id, name)} className="w-11 h-11 items-center justify-center" accessibilityRole="button" accessibilityLabel={`Odebrat strážce ${name}`} hitSlop={8}><UserMinus size={21} color={COLORS.error} /></Pressable></View>;
          }) : <View className="py-5"><Eye size={30} color={COLORS.muted} /><Text className="font-body-semibold text-lg text-charcoal mt-4">Zatím bez strážce</Text><Text className="font-body text-sm leading-5 text-muted mt-2">Pozvěte člověka, který výslovně přijme vztah k tomuto profilu.</Text></View>}
          {guardians.sentInvites.filter((invite) => invite.status === "pending").length ? <View className="mt-5 pt-5 border-t border-sand"><Text className="font-body-semibold text-sm text-muted mb-2">Čeká na přijetí</Text>{guardians.sentInvites.filter((invite) => invite.status === "pending").map((invite) => <View key={invite.id} className="py-3"><Text className="font-body-semibold text-charcoal">{invite.email}</Text><Text className="font-body text-sm text-muted mt-1">Pozvánka platí do {formatDateTime(invite.expires_at)}. Vztah zatím nevznikl.</Text></View>)}</View> : null}
          <View className="mt-5"><ActionButton testID="guardian-invite-open" label="Pozvat strážce" icon={<Plus size={20} color="#251D18" />} disabled={!profile || guardians.myGuardians.length >= 5 || isUsingCachedProfiles} onPress={() => setInviteOpen(true)} /></View>
        </View>

        {guardians.pendingInvites.length ? <View className="py-8 border-b border-sand"><Text className="font-display text-[28px] text-charcoal mb-4">Pozvánky pro mě</Text>{guardians.pendingInvites.map((invite) => <View key={invite.id} className="py-5 border-b border-sand"><View className="flex-row gap-3"><BellRinging size={24} color={COLORS.brand[500]} /><View className="flex-1"><Text className="font-body-semibold text-base text-charcoal">{invite.profile_name}</Text><Text className="font-body text-sm leading-5 text-muted mt-1">{invite.owner_display_name} vás zve jako strážce. Po přijetí uvidíte aktivní incident a při něm případnou poslední známou polohu.</Text><Text className="font-body text-xs text-muted mt-2">Platí do {formatDateTime(invite.expires_at)}</Text></View></View><View className="flex-row gap-3 mt-4"><View className="flex-1"><ActionButton testID={`guardian-invite-decline-${invite.id}`} label="Odmítnout" variant="quiet" onPress={() => void guardians.declineInvite(invite.id)} /></View><View className="flex-1"><ActionButton testID={`guardian-invite-accept-${invite.id}`} label="Přijmout" onPress={() => void guardians.acceptInvite(invite.id)} /></View></View></View>)}</View> : null}

        <View className="py-8">
          <Text className="font-display text-[28px] text-charcoal mb-4">Profily, které hlídám</Text>
          {guardians.watchedProfiles.length ? guardians.watchedProfiles.map((item) => {
            const openIncident = product.alerts.find((alert) => alert.profile_id === item.id && alert.status === "open");
            return (
            <View key={item.id} className="py-5 border-b border-sand">
              <Pressable testID={openIncident ? `incident-open-${openIncident.id}` : undefined} disabled={!openIncident} onPress={() => openIncident && router.push({ pathname: "/(tabs)/incident/[id]", params: { id: openIncident.id } })} className="flex-row gap-4" accessibilityRole={openIncident ? "button" : undefined} accessibilityLabel={openIncident ? `Otevřít aktivní incident profilu ${item.name}` : undefined}>
                {item.has_active_alert ? <WarningCircle size={25} color={COLORS.error} weight="fill" /> : <ShieldCheck size={25} color="#315C5D" weight="fill" />}
                <View className="flex-1"><View className="flex-row gap-3 justify-between"><Text className="font-body-semibold text-lg text-charcoal flex-1">{item.name}</Text>{openIncident ? <ArrowRight size={21} color={COLORS.muted} /> : null}</View><Text className="font-body text-sm text-muted mt-1">Vlastník: {item.owner_display_name}</Text><View className="mt-3"><StatusLabel label={item.has_active_alert ? "Aktivní incident" : item.is_paused ? "Profil je v pauze" : "Bez aktivního incidentu"} tone={item.has_active_alert ? "danger" : "info"} /></View><Text className="font-body text-sm leading-5 text-muted mt-3">Serverový termín: {formatDateTime(item.next_deadline_at)}. „Bez aktivního incidentu“ není potvrzení zdraví ani bezpečí.</Text></View>
              </Pressable>
              {item.membership_id ? <Pressable testID={`guardian-self-revoke-${item.membership_id}`} onPress={() => stopWatching(item.membership_id!, item.name)} className="min-h-[44px] justify-center mt-3" accessibilityRole="button"><Text className="font-body-semibold text-error">Přestat hlídat</Text></Pressable> : null}
            </View>
          );}) : <Text className="font-body text-muted py-4">Aktuálně nehlídáte žádný profil.</Text>}
        </View>

        <Notice title="Push není potvrzení pomoci" tone="info"><Text className="font-body text-[#315C5D] leading-5">Vypnuté notifikace, úsporný režim, odinstalace nebo omezení systému mohou upozornění zablokovat. Hlásím se samo nekontaktuje 112 ani 155.</Text></Notice>
      </ScrollView>
      {profile ? <AddGuardianModal visible={inviteOpen} onClose={() => setInviteOpen(false)} onSubmit={(email) => guardians.sendInvite(profile.id, email)} /> : null}
    </SafeAreaView>
  );
}
