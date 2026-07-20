import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import * as Location from "expo-location";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { ArrowClockwise, Bell, DeviceMobile, MapPin, WarningCircle } from "phosphor-react-native";
import { ActionButton, BackHeader, Notice, StatusLabel } from "@/components/product/ProductUI";
import { registerPushDevice } from "@/lib/pushDevices";
import { useProductStore } from "@/stores/product";
import { COLORS } from "@/constants/design";

type Permission = "granted" | "denied" | "undetermined";
const permissionLabel = (value: Permission) => value === "granted" ? "Povoleno v systému" : value === "denied" ? "Zakázáno v systému" : "Zatím nevybráno";

export default function DiagnosticsScreen() {
  const product = useProductStore();
  const [notificationPermission, setNotificationPermission] = useState<Permission>("undetermined");
  const [locationPermission, setLocationPermission] = useState<Permission>("undetermined");
  const [reminders, setReminders] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [notification, location, scheduled] = await Promise.all([
        Notifications.getPermissionsAsync(),
        Location.getForegroundPermissionsAsync(),
        Notifications.getAllScheduledNotificationsAsync(),
      ]);
      setNotificationPermission(notification.status as Permission);
      setLocationPermission(location.status as Permission);
      setReminders(scheduled.filter((item) => item.identifier.startsWith("checkin-reminder-")).length);
      await product.loadPushDevices();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Diagnostiku se nepodařilo dokončit."); }
    finally { setBusy(false); }
  }, [product.loadPushDevices]);
  useEffect(() => { void refresh(); }, [refresh]);

  const enablePush = async () => {
    setBusy(true); setError("");
    try {
      if (!Device.isDevice) throw new Error("Push token nelze ověřit v simulátoru. Použijte fyzický iPhone nebo Android.");
      const permission = await Notifications.requestPermissionsAsync();
      setNotificationPermission(permission.status as Permission);
      if (permission.status !== "granted") throw new Error("Systém oprávnění neudělil. Otevřete nastavení zařízení.");
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;
      if (!projectId) throw new Error("Build nemá nastavené EAS project ID.");
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      await registerPushDevice(token.data);
      await product.loadPushDevices();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Registrace zařízení selhala."); }
    finally { setBusy(false); }
  };

  const requestLocation = async () => {
    const result = await Location.requestForegroundPermissionsAsync();
    setLocationPermission(result.status as Permission);
  };

  const push = product.pushDiagnostics;
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView contentContainerClassName="px-5 pb-12">
        <BackHeader title="Diagnostika" />
        <Text className="font-display text-[38px] leading-[42px] text-charcoal mt-5">Co zařízení dovolí a co neumí slíbit</Text>
        <Text className="font-body text-base leading-6 text-muted mt-4">Tato kontrola ověří místní oprávnění a registraci tokenu. Neumí potvrdit budoucí end-to-end doručení push.</Text>
        {error ? <View className="mt-6"><Notice title={error} tone="warning" /></View> : null}
        {busy ? <ActivityIndicator className="mt-6" color={COLORS.brand[500]} /> : null}

        <View className="py-8 border-b border-sand">
          <View className="flex-row gap-4"><Bell size={26} color={COLORS.charcoal.default} /><View className="flex-1"><Text className="font-display text-[25px] text-charcoal">Push upozornění</Text><View className="mt-3"><StatusLabel label={permissionLabel(notificationPermission)} tone={notificationPermission === "granted" ? "success" : "warning"} /></View><Text className="font-body text-sm leading-5 text-muted mt-3">Registrace této instalace: {push?.registration_state === "active" ? "aktivní na serveru" : push?.registration_state === "inactive" ? "server ji eviduje jako neaktivní" : "server ji neeviduje"}. Aktivních zařízení účtu: {push?.active_device_count ?? "—"}.</Text></View></View>
          {notificationPermission !== "granted" ? <View className="mt-5"><ActionButton testID="notification-permission-request" label="Vysvětlili jste mi to — požádat systém" onPress={() => void enablePush()} /></View> : <View className="mt-5"><ActionButton testID="notification-registration-refresh" label="Obnovit registraci tokenu" variant="quiet" onPress={() => void enablePush()} /></View>}
          {notificationPermission === "denied" ? <Pressable onPress={() => void Linking.openSettings()} className="min-h-[44px] justify-center mt-3" accessibilityRole="button"><Text className="font-body-semibold text-brand-500">Otevřít nastavení zařízení</Text></Pressable> : null}
        </View>

        <View className="py-8 border-b border-sand">
          <View className="flex-row gap-4"><MapPin size={26} color={COLORS.charcoal.default} /><View className="flex-1"><Text className="font-display text-[25px] text-charcoal">Poloha v popředí</Text><View className="mt-3"><StatusLabel label={permissionLabel(locationPermission)} tone={locationPermission === "granted" ? "success" : "info"} /></View><Text className="font-body text-sm leading-5 text-muted mt-3">Poloha je vždy volitelná a získá se pouze při check-inu, pokud ji zapnete. Odmítnutí check-in neblokuje.</Text></View></View>
          {locationPermission === "undetermined" ? <View className="mt-5"><ActionButton testID="location-permission-request" label="Požádat o polohu v popředí" variant="quiet" onPress={() => void requestLocation()} /></View> : null}
        </View>

        <View className="py-8 border-b border-sand">
          <View className="flex-row gap-4"><DeviceMobile size={26} color={COLORS.charcoal.default} /><View className="flex-1"><Text className="font-display text-[25px] text-charcoal">Lokální připomínky</Text><Text className="font-display text-[34px] text-charcoal mt-3">{reminders}</Text><Text className="font-body text-sm leading-5 text-muted mt-2">naplánovaných připomínek pro všechny serverem potvrzené aktivní profily. OS je může odložit nebo potlačit.</Text></View></View>
        </View>

        <View className="py-8"><ActionButton testID="diagnostics-refresh" label="Spustit kontrolu znovu" variant="dark" icon={<ArrowClockwise size={20} color="#fff" />} onPress={() => void refresh()} /></View>
        <Notice title="Fyzické zařízení je povinný release test" tone="danger"><View className="flex-row gap-2"><WarningCircle size={18} color="#9E2E2A" /><Text className="font-body text-[#9E2E2A] flex-1">Simulátor neověří skutečné APNs/FCM doručení, ukončenou aplikaci, Focus, Doze ani OEM omezení. Je nutný reálný iPhone i Android v obou směrech.</Text></View></Notice>
      </ScrollView>
    </SafeAreaView>
  );
}
