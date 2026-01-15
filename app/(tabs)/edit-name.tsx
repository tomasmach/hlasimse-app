import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { supabase } from "@/lib/supabase";

export default function EditNameScreen() {
  const { user } = useAuth();
  const { profile, fetchProfile } = useCheckInStore();
  const [name, setName] = useState(profile?.name || "");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Jmeno je povinne");
      return;
    }

    if (!profile?.id || !user?.id) {
      setError("Nepodarilo se nacist profil");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const { error: updateError } = await supabase
        .from("check_in_profiles")
        .update({ name: name.trim() })
        .eq("id", profile.id);

      if (updateError) throw updateError;

      await fetchProfile(user.id);
      router.back();
    } catch (err: any) {
      setError(err.message || "Nepodarilo se ulozit");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-2">
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2"
            activeOpacity={0.7}
          >
            <Text className="text-coral text-lg font-medium">Zpet</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSave}
            disabled={isLoading}
            className="p-2"
            activeOpacity={0.7}
          >
            {isLoading ? (
              <ActivityIndicator color="#FF6B5B" />
            ) : (
              <Text className="text-coral text-lg font-semibold">Ulozit</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Form */}
        <View className="px-6 pt-6">
          <Text className="text-lg font-semibold text-charcoal mb-2">
            Vase jmeno
          </Text>
          <TextInput
            value={name}
            onChangeText={(text) => {
              setName(text);
              if (error) setError("");
            }}
            placeholder="Zadejte jmeno"
            placeholderTextColor="#8B7F7A"
            className="bg-white rounded-2xl px-4 py-4 text-charcoal text-lg border border-sand"
            autoFocus
            autoCapitalize="words"
            autoComplete="name"
            editable={!isLoading}
          />
          {error && <Text className="text-coral mt-2">{error}</Text>}
          <Text className="text-muted mt-4">Toto jmeno uvidi vasi strazci.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
