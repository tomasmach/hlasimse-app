import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Link } from "expo-router";
import { supabase } from "@/lib/supabase";
import { COLORS } from "@/constants/design";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError("Vyplňte prosím e-mail.");
      return;
    }

    setLoading(true);
    setError(null);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim()
    );

    setLoading(false);

    if (resetError) {
      setError("Odeslání odkazu se nezdařilo. Zkuste to prosím znovu.");
      return;
    }

    setSuccess(true);
  };

  if (success) {
    return (
      <View className="flex-1 bg-cream justify-center px-6">
        <View className="bg-success/10 border border-success rounded-xl p-6 items-center">
          <Text className="text-charcoal text-xl font-bold mb-3 font-lora">
            E-mail odeslán!
          </Text>
          <Text className="text-muted text-center mb-4 font-lora">
            Zkontrolujte svou e-mailovou schránku. Odkaz pro obnovu hesla vám
            byl odeslán na {email}.
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity className="bg-coral rounded-xl py-3 px-6">
              <Text className="text-white font-lora-semibold">
                Zpět na přihlášení
              </Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cream"
    >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-12"
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center mb-12">
          <Text className="text-4xl font-bold text-charcoal font-lora">
            Obnova hesla
          </Text>
          <Text className="text-muted mt-2 text-center font-lora">
            Zadejte svůj e-mail a my vám pošleme odkaz pro obnovu hesla
          </Text>
        </View>

        {error && (
          <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-6">
            <Text className="text-coral text-center font-lora">{error}</Text>
          </View>
        )}

        <View className="gap-4 mb-6">
          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="E-mail"
            placeholderTextColor={COLORS.muted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!loading}
          />
        </View>

        <TouchableOpacity
          className="bg-coral rounded-xl py-4 items-center mb-8"
          onPress={handleResetPassword}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text className="text-white font-lora-semibold text-lg">
              Odeslat odkaz
            </Text>
          )}
        </TouchableOpacity>

        <View className="flex-row justify-center">
          <Text className="text-muted font-lora">Vzpomněli jste si? </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity disabled={loading}>
              <Text className="text-coral font-lora-semibold">Přihlásit se</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
