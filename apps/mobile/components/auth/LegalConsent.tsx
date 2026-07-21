import { useId } from "react";
import { Pressable, Text, View } from "react-native";
import { Check } from "phosphor-react-native";

import { COLORS } from "@/constants/design";
import { openPublicDocument, PRIVACY_POLICY_URL, TERMS_URL } from "@/lib/legal";

type Props = {
  checked: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (checked: boolean) => void;
  testIDPrefix: string;
};

export function LegalConsent({ checked, disabled = false, error, onChange, testIDPrefix }: Props) {
  const fallbackId = useId().replace(/:/g, "");
  const errorId = `${testIDPrefix || fallbackId}-legal-consent-error`;

  return (
    <View className="mb-6">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel="Souhlasím s podmínkami používání a seznámil/a jsem se s ochranou soukromí"
        aria-describedby={error ? errorId : undefined}
        aria-invalid={Boolean(error)}
        disabled={disabled}
        onPress={() => onChange(!checked)}
        style={disabled ? { opacity: 0.55 } : undefined}
        testID={`${testIDPrefix}-legal-consent`}
        className={`min-h-[48px] flex-row items-start gap-3 rounded-[18px] border bg-white p-4 active:opacity-70 ${
          error ? "border-[#C33D2F]" : checked ? "border-[#9E382E]" : "border-sand"
        }`}
      >
        <View
          className={`mt-0.5 h-5 w-5 items-center justify-center rounded-md border ${checked ? "border-[#9E382E] bg-[#9E382E]" : "border-muted bg-white"}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {checked ? <Check size={14} weight="bold" color={COLORS.cream.default} /> : null}
        </View>
        <Text className="flex-1 font-body text-sm leading-5 text-muted">
          Souhlasím s podmínkami používání a seznámil/a jsem se s ochranou soukromí.
        </Text>
      </Pressable>
      <View className="flex-row flex-wrap gap-x-5">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Otevřít podmínky používání"
          onPress={() => void openPublicDocument(TERMS_URL)}
          className="min-h-[48px] justify-center active:opacity-70"
          testID={`${testIDPrefix}-terms-link`}
        >
          <Text className="font-body-semibold text-sm text-[#9E382E] underline">
            Podmínky používání
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Otevřít zásady ochrany soukromí"
          onPress={() => void openPublicDocument(PRIVACY_POLICY_URL)}
          className="min-h-[48px] justify-center active:opacity-70"
          testID={`${testIDPrefix}-privacy-link`}
        >
          <Text className="font-body-semibold text-sm text-[#9E382E] underline">
            Ochrana soukromí
          </Text>
        </Pressable>
      </View>
      {error ? (
        <Text
          nativeID={errorId}
          testID={errorId}
          className="mt-1 font-body text-sm leading-5 text-[#9E382E]"
          accessibilityRole="alert"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}
