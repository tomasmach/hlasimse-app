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
import { Link, router } from "expo-router";
import { register } from "@/lib/auth";
import { useAuthStore } from "@/stores/auth";
import { COLORS } from "@/constants/design";

export default function RegisterScreen() {
  const setUser = useAuthStore((state) => state.setUser);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateForm = (): string | null => {
    if (!name.trim()) {
      return "Vyplňte prosím své jméno.";
    }
    if (!email.trim()) {
      return "Vyplňte prosím e-mail.";
    }
    if (!password) {
      return "Vyplňte prosím heslo.";
    }
    if (password.length < 10) {
      return "Heslo musí mít alespoň 10 znaků.";
    }
    if (password !== confirmPassword) {
      return "Hesla se neshodují.";
    }
    return null;
  };

  const handleRegister = async () => {
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setUser(await register({ email, password, firstName: name }));
      router.replace("/(tabs)");
    } catch (err) {
      console.error("Registration error:", err);
      setError(err instanceof Error ? err.message : "Registrace se nezdařila.");
    } finally {
      setLoading(false);
    }
  };

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
          <Text className="text-4xl font-bold text-charcoal font-lora">Registrace</Text>
          <Text className="text-muted mt-2 font-lora">Vytvořte si nový účet</Text>
        </View>

        {error && (
          <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-6">
            <Text className="text-coral text-center font-lora">{error}</Text>
          </View>
        )}

        <View className="gap-4 mb-6">
          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="Jméno"
            placeholderTextColor={COLORS.muted}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            editable={!loading}
          />

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

          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="Heslo (min. 10 znaků)"
            placeholderTextColor={COLORS.muted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            editable={!loading}
          />

          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="Potvrzení hesla"
            placeholderTextColor={COLORS.muted}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
            editable={!loading}
          />
        </View>

        <TouchableOpacity
          className="bg-coral rounded-xl py-4 items-center mb-8"
          onPress={handleRegister}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.white} />
          ) : (
            <Text className="text-white font-lora-semibold text-lg">
              Registrovat
            </Text>
          )}
        </TouchableOpacity>

        <View className="flex-row justify-center">
          <Text className="text-muted font-lora">Máte již účet? </Text>
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
