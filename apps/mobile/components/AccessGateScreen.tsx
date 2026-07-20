import { useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowSquareOut, ShieldWarning } from "phosphor-react-native";
import { ActionButton, Notice } from "@/components/product/ProductUI";
import { COLORS } from "@/constants/design";
import type { ClientGate } from "@/lib/clientRelease";

interface AccessGateScreenProps {
  gate: ClientGate;
  retrying: boolean;
  onRetry: () => void;
}

export function AccessGateScreen({ gate, retrying, onRetry }: AccessGateScreenProps) {
  const [linkError, setLinkError] = useState(false);
  const update = gate.kind === "update";

  const openStore = async () => {
    if (!update || !gate.storeUrl) return;
    setLinkError(false);
    try {
      await Linking.openURL(gate.storeUrl);
    } catch {
      setLinkError(true);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" accessibilityViewIsModal>
      <ScrollView
        contentContainerClassName="flex-grow px-6 py-8 justify-between"
        keyboardShouldPersistTaps="handled"
      >
        <View className="pt-10">
          <View
            className="w-16 h-16 rounded-[22px] bg-[#FFE7E3] items-center justify-center mb-8"
            accessible={false}
          >
            <ShieldWarning size={34} weight="fill" color={COLORS.error} />
          </View>
          <Text
            className="font-display text-[38px] leading-[42px] tracking-[-1px] text-charcoal"
            accessibilityRole="header"
          >
            {update ? "Nejdřív aplikaci aktualizujte" : "Probíhá bezpečnostní údržba"}
          </Text>
          <Text className="font-body text-[17px] leading-7 text-charcoal-light mt-5">
            {gate.detail}
          </Text>
          {update && (gate.minVersion || gate.minBuild) ? (
            <Text className="font-body-semibold text-[15px] leading-6 text-muted mt-4">
              Požadováno: verze {gate.minVersion || "aktuální"}
              {gate.minBuild ? `, build ${gate.minBuild}` : ""}
            </Text>
          ) : null}
          <View className="mt-8">
            <Notice title="Ohlášení není potvrzené" tone="warning">
              <Text className="font-body text-[14px] leading-5 text-[#7B4A08]">
                Dokud server ohlášení nepřijme, termín se neposune. V naléhavé situaci volejte 112 nebo 155.
              </Text>
            </Notice>
          </View>
          {linkError ? (
            <View className="mt-4">
              <Notice title="Obchod se nepodařilo otevřít" tone="danger">
                <Text className="font-body text-[14px] leading-5 text-[#9E2E2A]">
                  Otevřete App Store nebo Google Play ručně a vyhledejte Hlásím se.
                </Text>
              </Notice>
            </View>
          ) : null}
        </View>

        <View className="pt-10 pb-2">
          {update && gate.storeUrl ? (
            <ActionButton
              testID="release-gate-open-store"
              label="Otevřít obchod a aktualizovat"
              onPress={openStore}
              icon={<ArrowSquareOut size={21} weight="bold" color="#251D18" />}
              accessibilityHint="Otevře oficiální stránku aplikace v obchodě"
            />
          ) : null}
          {!update ? (
            <ActionButton
              testID="release-gate-retry"
              label="Zkusit znovu"
              onPress={onRetry}
              loading={retrying}
              accessibilityHint="Znovu ověří dostupnost serveru"
            />
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
