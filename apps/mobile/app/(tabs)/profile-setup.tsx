import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Clock, UserCircle } from "phosphor-react-native";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { ActionButton, BackHeader, Notice } from "@/components/product/ProductUI";
import { COLORS } from "@/constants/design";

export default function ProfileSetupScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const adding = mode === "add";
  const { user } = useAuth();
  const { createProfile, chooseGuardianOnlyMode, profiles, isLoading, lastFetchSucceeded, isUsingCachedProfiles } = useCheckInStore();
  const [name, setName] = useState("");
  const [minutes, setMinutes] = useState("1440");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adding && user?.first_name) setName(user.first_name);
  }, [adding, user?.first_name]);

  if (!user) return <View className="flex-1 bg-cream items-center justify-center"><ActivityIndicator color={COLORS.brand[500]} /></View>;

  const submit = async () => {
    const parsedMinutes = Number(minutes);
    if (!name.trim()) return setError("Zadejte název profilu.");
    if (!Number.isInteger(parsedMinutes) || parsedMinutes < 60 || parsedMinutes > 10080) return setError("Interval musí být celé číslo od 60 do 10 080 minut.");
    if (profiles.length >= 5) return setError("Účet může mít nejvýše 5 profilů.");
    setError(null);
    const created = await createProfile(user.id, name.trim(), parsedMinutes * 60);
    if (created) router.replace("/(tabs)");
    else setError(useCheckInStore.getState().error || "Profil se nepodařilo vytvořit.");
  };

  const blocked = !lastFetchSucceeded || isUsingCachedProfiles;
  return (
    <SafeAreaView className="flex-1 bg-cream">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} className="flex-1">
        <ScrollView contentContainerClassName="px-5 pb-36" keyboardShouldPersistTaps="handled">
          {adding ? <BackHeader title="Nový profil" /> : <View className="h-5" />}
          <View className="pt-8 mb-10">
            <UserCircle size={40} color={COLORS.brand[500]} weight="duotone" />
            <Text className="font-display text-[40px] leading-[44px] tracking-[-1.5px] text-charcoal mt-5 max-w-[330px]">{adding ? "Další člověk, jeden společný klid" : "Komu má profil patřit?"}</Text>
            <Text className="font-body text-base leading-6 text-muted mt-4">Každý účet má zdarma až 5 profilů. Jméno uvidí pozvaní strážci.</Text>
          </View>

          {blocked ? <Notice title="Bez ověření serverem profil nevytvoříme" tone="warning"><Text className="font-body text-[#7B4A08]">Připojte se a nejdřív načtěte aktuální seznam profilů. Uložený offline náhled může být zastaralý.</Text></Notice> : null}
          {error ? <View className="mt-4"><Notice title={error} tone="danger" /></View> : null}

          <View className="mt-7">
            <Text className="font-body-semibold text-sm text-charcoal mb-2">Název profilu</Text>
            <TextInput
              testID="profile-create-name-input"
              value={name}
              onChangeText={setName}
              placeholder="Například Jana nebo Cesta na Island"
              placeholderTextColor={COLORS.muted}
              className="min-h-[56px] bg-white rounded-[18px] px-4 font-body text-[17px] text-charcoal border border-sand"
              autoCapitalize="words"
              editable={!isLoading && !blocked}
              accessibilityLabel="Název profilu"
            />
          </View>

          <View className="mt-6">
            <Text className="font-body-semibold text-sm text-charcoal mb-2">Interval v celých minutách</Text>
            <View className="flex-row items-center bg-white rounded-[18px] border border-sand px-4">
              <Clock size={22} color={COLORS.muted} />
              <TextInput
                testID="profile-create-interval-input"
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
                className="min-h-[56px] flex-1 px-3 font-body text-[17px] text-charcoal"
                editable={!isLoading && !blocked}
                accessibilityLabel="Interval v minutách, od 60 do 10080"
              />
              <Text className="font-body text-muted">minut</Text>
            </View>
            <View className="flex-row flex-wrap gap-2 mt-3">{[{ label: "1 hodina", value: "60" }, { label: "6 hodin", value: "360" }, { label: "12 hodin", value: "720" }, { label: "1 den", value: "1440" }, { label: "3 dny", value: "4320" }, { label: "7 dní", value: "10080" }].map((item) => <Text key={item.value} onPress={() => setMinutes(item.value)} accessibilityRole="button" className="font-body-semibold text-sm text-charcoal bg-sand rounded-full px-3 py-3">{item.label}</Text>)}</View>
            <Text className="font-body text-sm leading-5 text-muted mt-3">Od 1 hodiny do 7 dní, s přesností na celou minutu. Server po vytvoření nastaví první termín.</Text>
          </View>

          <View className="mt-9"><ActionButton testID="profile-create-submit" label="Vytvořit profil" loading={isLoading} disabled={blocked} onPress={() => void submit()} /></View>
          {!adding ? <View className="mt-3"><ActionButton testID="guardian-only-continue" label="Chci pouze hlídat jiné profily" variant="quiet" disabled={blocked} onPress={async () => { await chooseGuardianOnlyMode(user.id, true); router.replace("/(tabs)/guardians"); }} /></View> : null}
          <Text className="font-body text-sm leading-5 text-muted text-center mt-5">Všechny funkce jsou zdarma, bez trialu, předplatného nebo omezení platbou.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
