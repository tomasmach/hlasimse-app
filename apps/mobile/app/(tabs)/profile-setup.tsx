import { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { COLORS } from "@/constants/design";

export default function ProfileSetupScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { createProfile, isLoading } = useCheckInStore();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Pre-fill name from user metadata if available
  useEffect(() => {
    if (user?.first_name) {
      setName(user.first_name);
    }
  }, [user]);

  // Don't render if user is not logged in (root layout will redirect)
  if (!user) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color={COLORS.coral.default} />
      </View>
    );
  }

  const handleSubmit = async () => {
    setError(null);

    // Validate name
    if (!name.trim()) {
      setError("Vyplňte prosím své jméno.");
      return;
    }

    if (!user) {
      setError("Nepodařilo se načíst uživatele.");
      return;
    }

    const profile = await createProfile(user.id, name.trim());

    if (profile) {
      router.replace("/(tabs)");
    } else {
      setError("Nepodařilo se vytvořit profil. Zkuste to prosím znovu.");
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cream"
    >
      <View className="flex-1 justify-center px-6">
        <View className="items-center mb-12">
          <Text className="text-6xl mb-4">👤</Text>
          <Text className="text-4xl font-lora-bold text-charcoal text-center">
            Nastavte svůj profil
          </Text>
          <Text className="text-muted mt-2 text-center font-lora">
            Jak se máte jmenovat v hlášeních?
          </Text>
        </View>

        {error && (
          <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-6">
            <Text className="text-coral text-center font-lora">{error}</Text>
          </View>
        )}

        <View className="mb-6">
          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="Vaše jméno"
            placeholderTextColor={COLORS.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            editable={!isLoading}
          />
        </View>

        <TouchableOpacity
          className="bg-coral rounded-[2rem] py-4 items-center mb-6"
          onPress={handleSubmit}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text className="text-white font-lora-semibold text-lg">Pokračovat</Text>
          )}
        </TouchableOpacity>

        <Text className="text-muted text-center text-sm font-lora">
          Interval hlášení: 1× za 24 hodin
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
