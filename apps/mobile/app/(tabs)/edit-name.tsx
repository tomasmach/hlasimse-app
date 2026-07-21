import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { IdentificationCard } from "phosphor-react-native";

import { ActionButton, BackHeader, Notice } from "@/components/product/ProductUI";
import { COLORS } from "@/constants/design";
import { updateAccountName } from "@/lib/auth";
import { useAuthStore } from "@/stores/auth";

export default function EditNameScreen() {
  const user = useAuthStore((state) => state.user);
  const replaceUserIfCurrent = useAuthStore((state) => state.replaceUserIfCurrent);
  const [firstName, setFirstName] = useState(user?.first_name ?? "");
  const [lastName, setLastName] = useState(user?.last_name ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setFirstName(user?.first_name ?? "");
    setLastName(user?.last_name ?? "");
  }, [user?.id, user?.first_name, user?.last_name]);

  if (!user) return null;

  const save = async () => {
    const trimmedFirstName = firstName.trim();
    const trimmedLastName = lastName.trim();
    if (!trimmedFirstName) {
      setError("Jméno je povinné.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const confirmed = await updateAccountName({
        expectedUserId: user.id,
        firstName: trimmedFirstName,
        lastName: trimmedLastName,
      });
      if (!replaceUserIfCurrent(confirmed)) {
        throw new Error("Přihlášený účet se mezitím změnil. Ověřte jméno po novém přihlášení.");
      }
      router.replace("/(tabs)/settings");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Jméno se nepodařilo potvrdit serverem.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="px-5 pb-32"
          keyboardShouldPersistTaps="handled"
        >
          <BackHeader title="Osobní údaje" onBack={() => router.replace("/(tabs)/settings")} />

          <View className="pt-5">
            <IdentificationCard size={42} color={COLORS.brand[500]} weight="light" />
            <Text className="font-display text-[38px] leading-[42px] tracking-[-1px] text-charcoal mt-5">
              Jak se máte zobrazovat
            </Text>
            <Text className="font-body text-base leading-6 text-muted mt-3">
              Jméno uvidí lidé, které zvete jako strážce. V aplikaci se změní až po potvrzení serverem.
            </Text>
          </View>

          {error ? <View className="mt-6"><Notice title={error} tone="danger" /></View> : null}

          <View className="mt-8">
            <Text className="font-body-semibold text-sm text-charcoal mb-2">Jméno</Text>
            <TextInput
              testID="account-first-name"
              value={firstName}
              onChangeText={setFirstName}
              editable={!busy}
              maxLength={150}
              autoCapitalize="words"
              autoComplete="given-name"
              textContentType="givenName"
              returnKeyType="next"
              className="min-h-[56px] rounded-[18px] border border-sand bg-white px-4 font-body text-[17px] text-charcoal"
              placeholder="Jméno"
              placeholderTextColor={COLORS.muted}
              accessibilityLabel="Jméno účtu"
            />
          </View>

          <View className="mt-5">
            <Text className="font-body-semibold text-sm text-charcoal mb-2">Příjmení</Text>
            <TextInput
              testID="account-last-name"
              value={lastName}
              onChangeText={setLastName}
              editable={!busy}
              maxLength={150}
              autoCapitalize="words"
              autoComplete="family-name"
              textContentType="familyName"
              returnKeyType="done"
              onSubmitEditing={() => void save()}
              className="min-h-[56px] rounded-[18px] border border-sand bg-white px-4 font-body text-[17px] text-charcoal"
              placeholder="Příjmení (nepovinné)"
              placeholderTextColor={COLORS.muted}
              accessibilityLabel="Příjmení účtu"
            />
          </View>

          <View className="mt-5">
            <Text className="font-body-semibold text-sm text-charcoal mb-2">E-mail</Text>
            <View
              testID="account-email-readonly"
              className="min-h-[56px] justify-center rounded-[18px] border border-sand bg-sand/40 px-4"
              accessibilityRole="text"
              accessibilityLabel={`E-mail, pouze pro čtení: ${user.email}`}
            >
              <Text selectable className="font-body text-[17px] text-muted">{user.email}</Text>
            </View>
            <Text className="font-body text-sm leading-5 text-muted mt-2">
              E-mail zde nelze měnit, protože slouží k přihlášení a ověření účtu.
            </Text>
          </View>

          <View className="mt-8">
            <ActionButton
              testID="account-name-submit"
              label="Uložit jméno na serveru"
              loading={busy}
              disabled={!firstName.trim()}
              onPress={() => void save()}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
