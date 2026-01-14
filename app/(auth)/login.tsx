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
import { supabase } from "@/lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Vyplňte prosím e-mail a heslo.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        if (signInError.message.includes("Invalid login credentials")) {
          setError("Nesprávný e-mail nebo heslo.");
        } else if (signInError.message.includes("Email not confirmed")) {
          setError("E-mail nebyl potvrzen. Zkontrolujte svou schránku.");
        } else {
          setError("Přihlášení se nezdařilo. Zkuste to prosím znovu.");
        }
        return;
      }

      router.replace("/(tabs)");
    } catch (err) {
      console.error("Login error:", err);
      setError("Nastala neočekávaná chyba. Zkuste to prosím znovu.");
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
          <Text className="text-4xl font-bold text-charcoal">Hlásím se</Text>
          <Text className="text-muted mt-2">Přihlaste se ke svému účtu</Text>
        </View>

        {error && (
          <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-6">
            <Text className="text-coral text-center">{error}</Text>
          </View>
        )}

        <View className="gap-4 mb-6">
          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="E-mail"
            placeholderTextColor="#8B7F7A"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!loading}
          />

          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="Heslo"
            placeholderTextColor="#8B7F7A"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            editable={!loading}
          />
        </View>

        <Link href="/(auth)/forgot-password" asChild>
          <TouchableOpacity className="mb-6" disabled={loading}>
            <Text className="text-coral text-right">Zapomenuté heslo?</Text>
          </TouchableOpacity>
        </Link>

        <TouchableOpacity
          className="bg-coral rounded-xl py-4 items-center mb-8"
          onPress={handleLogin}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-white font-semibold text-lg">Přihlásit</Text>
          )}
        </TouchableOpacity>

        <View className="flex-row justify-center">
          <Text className="text-muted">Nemáte účet? </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity disabled={loading}>
              <Text className="text-coral font-semibold">Registrovat se</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
