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

export default function ProfileSetupScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { createProfile, isLoading } = useCheckInStore();

  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Pre-fill name from user metadata if available
  useEffect(() => {
    if (user?.user_metadata?.name) {
      setName(user.user_metadata.name);
    }
  }, [user]);

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
          <Text className="text-4xl font-bold text-charcoal text-center">
            Nastavte svůj profil
          </Text>
          <Text className="text-muted mt-2 text-center">
            Jak se máte jmenovat v hlášeních?
          </Text>
        </View>

        {error && (
          <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-6">
            <Text className="text-coral text-center">{error}</Text>
          </View>
        )}

        <View className="mb-6">
          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="Vaše jméno"
            placeholderTextColor="#8B7F7A"
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
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-white font-semibold text-lg">Pokračovat</Text>
          )}
        </TouchableOpacity>

        <Text className="text-muted text-center text-sm">
          Interval hlášení: 1× za 24 hodin
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
