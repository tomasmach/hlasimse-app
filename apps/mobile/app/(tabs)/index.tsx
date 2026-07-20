import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import Animated, { FadeInDown, useReducedMotion } from "react-native-reanimated";
import { CaretDown, Check, MapPin, Pause, Play, Plus, ShieldWarning } from "phosphor-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useCountdown } from "@/hooks/useCountdown";
import { useLocation } from "@/hooks/useLocation";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useCheckInStore } from "@/stores/checkin";
import { OfflineBanner } from "@/components/OfflineBanner";
import { SuccessOverlay } from "@/components/SuccessOverlay";
import { Toast } from "@/components/ui";
import { ActionButton, Notice, StatusLabel } from "@/components/product/ProductUI";
import { COLORS } from "@/constants/design";
import { getCheckInFeedback } from "@/lib/checkInFeedback";

const formatDateTime = (value: string | null) => value
  ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Termín není aktivní";

const formatLastCheckIn = (value: string | null) => value
  ? new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
  : "Zatím žádné serverem potvrzené ohlášení";

function Countdown({ deadline, paused, enabled }: { deadline: string | null; paused: boolean; enabled: boolean }) {
  const countdown = useCountdown(deadline);
  if (!enabled) {
    return <Text className="font-display text-[42px] leading-[46px] tracking-[-1px] text-charcoal">Profil je archivovaný</Text>;
  }
  if (paused) {
    return <Text className="font-display text-[42px] leading-[46px] tracking-[-1px] text-charcoal">Profil je v pauze</Text>;
  }
  if (!deadline) {
    return <Text className="font-display text-[38px] leading-[43px] tracking-[-1px] text-charcoal">Čekáme na serverový termín</Text>;
  }
  if (countdown.isExpired) {
    return <Text className="font-display text-[44px] leading-[48px] tracking-[-1px] text-error">Termín vypršel</Text>;
  }
  return (
    <View>
      <Text className="font-display text-[54px] leading-[58px] tracking-[-2px] text-charcoal" maxFontSizeMultiplier={1.35}>
        {countdown.formatted}
      </Text>
      <Text className="font-body text-sm text-muted mt-1">hodin : minut : sekund</Text>
    </View>
  );
}

export default function CheckInScreen() {
  const { user } = useAuth();
  const store = useCheckInStore();
  const { permissionStatus, getCurrentPosition, requestPermission } = useLocation();
  const { isConnected } = useNetworkStatus();
  const reduceMotion = useReducedMotion();
  const [showProfiles, setShowProfiles] = useState(false);
  const [includeLocation, setIncludeLocation] = useState(false);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isChangingPause, setIsChangingPause] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: "success" | "info" | "warning" | "error" }>({ visible: false, message: "", type: "info" });

  useEffect(() => {
    if (user?.id && !store.hasFetched) void store.fetchProfile(user.id);
  }, [user?.id, store.hasFetched]);

  useEffect(() => {
    if (user && store.hasFetched && store.profile === null) {
      if (store.guardianOnlyMode) router.replace("/(tabs)/guardians");
      else if (store.lastFetchSucceeded) router.replace("/(tabs)/profile-setup");
    }
  }, [user, store.hasFetched, store.lastFetchSucceeded, store.profile, store.guardianOnlyMode]);

  const sync = useCallback(async () => {
    setIsSyncing(true);
    const result = await store.syncPendingCheckIns();
    setIsSyncing(false);
    if (result.synced > 0) setToast({ visible: true, type: "success", message: `${result.synced} čekající hlášení server potvrdil.` });
  }, [store.syncPendingCheckIns]);

  useEffect(() => {
    if (isConnected && store.pendingCount > 0) void sync();
  }, [isConnected, store.pendingCount, sync]);

  useEffect(() => {
    setIncludeLocation(false);
  }, [store.profile?.id]);

  const handleCheckIn = async () => {
    if (isCheckingIn) return;
    setIsCheckingIn(true);
    let coords = null;
    if (includeLocation) {
      let canUseLocation = permissionStatus === "granted";
      if (!canUseLocation) {
        canUseLocation = await requestPermission();
        if (!canUseLocation) {
          setIncludeLocation(false);
          setToast({ visible: true, type: "info", message: "Poloha nebyla přidána. Check-in můžete potvrdit i bez ní." });
        }
      }
      if (canUseLocation) {
        coords = await getCurrentPosition(5000);
        if (!coords) setToast({ visible: true, type: "info", message: "Poloha nebyla včas dostupná. Check-in odešleme bez ní." });
      }
    }
    const result = await store.checkIn(coords);
    setIncludeLocation(false);
    const feedback = getCheckInFeedback(result);
    if (feedback.showServerConfirmation) setShowSuccess(true);
    if (feedback.toast) setToast({ visible: true, ...feedback.toast });
    setIsCheckingIn(false);
  };

  const togglePause = () => {
    if (!store.profile || store.isUsingCachedProfiles) return;
    const pausing = !store.profile.is_paused;
    Alert.alert(
      pausing ? "Pozastavit profil?" : "Obnovit profil?",
      pausing
        ? "Pauza se projeví až po potvrzení serverem. Neuzavře už aktivní incident."
        : "Server nastaví nový termín od okamžiku obnovení. Za dobu pauzy nevznikne zpětný incident.",
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: pausing ? "Potvrdit pauzu" : "Obnovit",
          onPress: async () => {
            setIsChangingPause(true);
            try {
              await store.updateProfile({ is_paused: pausing, paused_until: null });
              setToast({ visible: true, type: "success", message: pausing ? "Pauza potvrzena serverem." : "Profil obnoven. Nový termín potvrdil server." });
            } catch (error) {
              setToast({ visible: true, type: "error", message: error instanceof Error ? error.message : "Změnu se nepodařilo potvrdit." });
            } finally {
              setIsChangingPause(false);
            }
          },
        },
      ],
    );
  };

  const selectedStatus = useMemo(() => {
    if (!store.profile) return { label: "Bez profilu", tone: "warning" as const };
    if (store.isUsingCachedProfiles) return { label: "Uložený náhled", tone: "warning" as const };
    if (!store.profile.enabled) return { label: "Archivovaný profil", tone: "info" as const };
    if (store.profile.is_paused) return { label: "Pauza potvrzena", tone: "info" as const };
    if (store.profile.next_deadline_at && new Date(store.profile.next_deadline_at).getTime() <= Date.now()) return { label: "Termín vypršel", tone: "danger" as const };
    return { label: "Serverový termín aktivní", tone: "success" as const };
  }, [store.profile, store.isUsingCachedProfiles]);

  if (!user || (!store.hasFetched && !store.profile)) {
    return <SafeAreaView className="flex-1 bg-cream items-center justify-center"><ActivityIndicator size="large" color={COLORS.brand[500]} /></SafeAreaView>;
  }

  if (!store.profile) {
    return (
      <SafeAreaView className="flex-1 bg-cream px-6 justify-center">
        <Notice title="Profil nelze ověřit" tone="warning"><Text className="font-body text-[#7B4A08]">Bez spojení se serverem nevytvoříme nový profil ani neodhadneme termín. Zkuste načtení znovu.</Text></Notice>
        <View className="mt-4"><ActionButton label="Zkusit znovu" onPress={() => void store.fetchProfile(user.id)} /></View>
      </SafeAreaView>
    );
  }

  const profile = store.profile;
  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView contentContainerClassName="px-5 pt-4 pb-36" showsVerticalScrollIndicator={false}>
        <View className="flex-row items-center justify-between mb-6">
          <Text className="font-display text-[20px] text-charcoal">Hlásím se</Text>
          <StatusLabel {...selectedStatus} />
        </View>

        <Pressable
          testID="profile-switcher"
          onPress={() => setShowProfiles((value) => !value)}
          className="flex-row items-center justify-between py-3 border-y border-sand"
          accessibilityRole="button"
          accessibilityLabel={`Vybraný profil ${profile.name}`}
          accessibilityHint="Otevře výběr profilů"
          accessibilityState={{ expanded: showProfiles }}
        >
          <View className="flex-1">
            <Text className="font-body text-sm text-muted">Právě se hlásí</Text>
            <Text className="font-display text-[28px] leading-8 text-charcoal mt-1">{profile.name}</Text>
          </View>
          <CaretDown size={24} color={COLORS.charcoal.default} />
        </Pressable>

        {showProfiles ? (
          <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(220)} className="py-3 border-b border-sand">
            {store.profiles.map((item) => (
              <Pressable
                key={item.id}
                testID={`profile-select-${item.id}`}
                onPress={() => { void store.selectProfile(item.id); setShowProfiles(false); }}
                className="min-h-[52px] flex-row items-center justify-between py-3"
                accessibilityRole="radio"
                accessibilityState={{ checked: item.id === profile.id }}
                accessibilityLabel={item.name}
              >
                <Text className="font-body-medium text-base text-charcoal">{item.name}</Text>
                {item.id === profile.id ? <Check size={20} weight="bold" color={COLORS.brand[500]} /> : null}
              </Pressable>
            ))}
            {store.profiles.length < 5 ? (
              <Pressable testID="profile-create-open" onPress={() => router.push("/(tabs)/profile-setup?mode=add")} className="min-h-[52px] flex-row items-center gap-2 py-3" accessibilityRole="button">
                <Plus size={20} color={COLORS.brand[500]} /><Text className="font-body-semibold text-brand-500">Přidat profil ({store.profiles.length}/5)</Text>
              </Pressable>
            ) : <Text className="font-body text-sm text-muted py-3">Využíváte všech 5 profilů.</Text>}
          </Animated.View>
        ) : null}

        {store.isUsingCachedProfiles ? (
          <View className="mt-5">
            <Notice title="Toto je uložený náhled, může být zastaralý" tone="warning">
              <Text className="font-body text-[#7B4A08] leading-5">Naposledy potvrzeno serverem {formatDateTime(store.profilesCachedAt)}. Check-in můžete bezpečně uložit do zařízení; serverový termín se nezmění, dokud požadavek nepřijme. Pauzu ani nastavení bez spojení měnit nelze.</Text>
            </Notice>
          </View>
        ) : null}

        <Animated.View entering={reduceMotion ? undefined : FadeInDown.duration(420)} className="pt-10 pb-8">
          <Text className="font-body-medium text-sm text-muted mb-3">Původní serverový termín</Text>
          <Countdown deadline={profile.next_deadline_at} paused={profile.is_paused} enabled={profile.enabled} />
          <Text className="font-body text-[15px] text-muted mt-3">{formatDateTime(profile.next_deadline_at)}</Text>
          {profile.is_paused ? <Text className="font-body text-[15px] leading-6 text-muted mt-2">{profile.paused_until ? `Automatické obnovení: ${formatDateTime(profile.paused_until)}` : "Pauza nemá nastavený konec. Nezapomeňte profil obnovit."}</Text> : null}
        </Animated.View>

        <View className="py-5 border-y border-sand">
          <Text className="font-body-medium text-sm text-muted">Poslední serverem potvrzené ohlášení</Text>
          <Text className="font-display text-[22px] leading-7 text-charcoal mt-2">{formatLastCheckIn(profile.last_checked_in_at)}</Text>
        </View>

        <OfflineBanner
          pendingCount={store.pendingCount}
          failedItems={store.pendingItems.filter((item) => item.status === "failed")}
          onSync={sync}
          isSyncing={isSyncing}
          onRetry={(id) => void store.retryPendingCheckIn(id)}
          onDelete={(id) => void store.deletePendingCheckIn(id)}
        />

        <View className="bg-charcoal rounded-[30px] p-6 overflow-hidden">
          <View className="absolute w-40 h-40 rounded-full bg-coral/20 -right-14 -top-16" />
          <Text className="font-display text-[28px] leading-[32px] text-white max-w-[280px]">Potvrďte serveru, že jste se ohlásili</Text>
          <Text className="font-body text-[15px] leading-6 text-white/70 mt-3 mb-6">Úspěch zobrazíme až po přijetí serverem. Bez sítě požadavek pouze bezpečně uložíme.</Text>
          <ActionButton
            testID="checkin-submit"
            label={isCheckingIn ? "Čekáme na server" : "Potvrdit check-in"}
            loading={isCheckingIn}
            disabled={profile.is_paused || !profile.enabled}
            onPress={() => void handleCheckIn()}
            icon={<Check size={21} weight="bold" color="#251D18" />}
            accessibilityHint="Odešle check-in serveru. Bez spojení ho uloží do zařízení; úspěch nastane až po potvrzení serverem."
          />
          {profile.is_paused ? <Text className="font-body text-sm text-white/70 mt-3">Během potvrzené pauzy není check-in vyžadován. Obnovení má vlastní serverové potvrzení.</Text> : !profile.enabled ? <Text className="font-body text-sm text-white/70 mt-3">Archivovaný profil nemá aktivní termín. Obnovte ho ve správě profilu.</Text> : null}
        </View>

        <View className="py-6 border-b border-sand">
          <View className="flex-row items-start gap-3">
            <MapPin size={23} color={COLORS.charcoal.default} />
            <View className="flex-1 pr-3">
              <Text className="font-body-semibold text-base text-charcoal">Přidat polohu pouze k tomuto check-inu</Text>
              <Text className="font-body text-sm leading-5 text-muted mt-1">Volitelné. Odmítnutí check-in nezablokuje. Poloha se uloží jen k potvrzenému check-inu; strážce ji uvidí pouze při aktivním incidentu jako poslední známou.</Text>
              <Text className="font-body text-xs text-muted mt-2">Stav oprávnění: {permissionStatus === "granted" ? "povoleno" : permissionStatus === "denied" ? "zamítnuto" : "zatím nevybráno"}</Text>
            </View>
            <Switch
              testID="checkin-location-toggle"
              value={includeLocation}
              onValueChange={setIncludeLocation}
              trackColor={{ false: "#D7CBC4", true: COLORS.brand[500] }}
              thumbColor="#FFFFFF"
              accessibilityLabel="Přidat polohu k tomuto check-inu"
              accessibilityHint="Poloha je volitelná a nepřenese se do offline fronty."
            />
          </View>
        </View>

        <View className="flex-row gap-3 py-6">
          <View className="flex-1"><ActionButton testID={profile.is_paused ? "profile-resume" : "profile-pause"} label={profile.is_paused ? "Obnovit profil" : "Pozastavit profil"} variant="quiet" loading={isChangingPause} disabled={store.isUsingCachedProfiles || !profile.enabled} onPress={togglePause} icon={profile.is_paused ? <Play size={19} color={COLORS.charcoal.default} /> : <Pause size={19} color={COLORS.charcoal.default} />} /></View>
          <View className="flex-1"><ActionButton testID="profile-edit-open" label="Spravovat profil" variant="quiet" onPress={() => router.push("/(tabs)/profile-detail")} /></View>
        </View>

        <View className="flex-row gap-3 items-start py-5 border-t border-sand">
          <ShieldWarning size={23} color={COLORS.error} />
          <Text className="font-body text-sm leading-5 text-muted flex-1">Hlásím se není tísňová služba, nekontaktuje 112 ani 155 a doručení push upozornění nelze garantovat. V ohrožení volejte 112 nebo 155.</Text>
        </View>
      </ScrollView>
      <Toast {...toast} onDismiss={() => setToast((value) => ({ ...value, visible: false }))} duration={4500} />
      <SuccessOverlay visible={showSuccess} onDismiss={() => setShowSuccess(false)} intervalHours={profile.interval_hours} />
    </SafeAreaView>
  );
}
