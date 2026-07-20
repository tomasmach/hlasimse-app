import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DownloadSimple } from "phosphor-react-native";
import { ActionButton, BackHeader, Notice } from "@/components/product/ProductUI";
import { useProductStore } from "@/stores/product";
import { COLORS } from "@/constants/design";
import { deliverAccountExport } from "@/lib/accountExport";

export default function DataExportScreen() {
  const exportAccountData = useProductStore((state) => state.exportAccountData);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const run = async () => {
    setBusy(true); setMessage(null);
    try {
      const data = await exportAccountData();
      await deliverAccountExport(data);
      setMessage({ tone: "success", text: "Export server připravil a otevřel systémovou nabídku sdílení." });
    } catch (error) { setMessage({ tone: "danger", text: error instanceof Error ? error.message : "Export se nepodařilo připravit." }); }
    finally { setBusy(false); }
  };
  return <SafeAreaView className="flex-1 bg-cream"><ScrollView contentContainerClassName="px-5 pb-12"><BackHeader title="Export dat" /><View className="pt-6"><DownloadSimple size={40} color={COLORS.brand[500]} /><Text className="font-display text-[38px] leading-[42px] text-charcoal mt-5">Vaše data bez černé skříňky</Text><Text className="font-body text-base leading-6 text-muted mt-4">Export se načte přímo ze serveru a aplikace ho neukládá do produktového store. Dočasný JSON soubor po zavření systémové nabídky smažeme z cache aplikace; cílovou aplikaci nebo úložiště už řídí systém.</Text></View>{message ? <View className="mt-6"><Notice title={message.text} tone={message.tone} /></View> : null}<View className="mt-8"><ActionButton testID="account-export-submit" label="Připravit a sdílet JSON" loading={busy} onPress={() => void run()} /></View><Text className="font-body text-sm leading-5 text-muted mt-5">Export zahrnuje účet, profily, check-iny, vztahy strážců, pozvánky, incidenty a registrovaná zařízení podle serverového retenčního kontraktu.</Text></ScrollView></SafeAreaView>;
}
