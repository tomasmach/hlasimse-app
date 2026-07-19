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

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
    if (password.length < 6) {
      return "Heslo musí mít alespoň 6 znaků.";
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
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            name: name.trim(),
          },
        },
      });

      if (signUpError) {
        if (signUpError.message.includes("invalid email")) {
          setError("Neplatný formát e-mailu.");
        } else {
          setError("Registrace se nezdařila. Zkuste to prosím znovu.");
        }
        return;
      }

      // When email confirmations are enabled, Supabase returns an obfuscated user
      // with empty identities array instead of an error for existing emails
      if (data.user?.identities?.length === 0) {
        setError("Tento e-mail je již zaregistrován.");
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error("Registration error:", err);
      setError("Nastala neočekávaná chyba. Zkuste to prosím znovu.");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <View className="flex-1 bg-cream justify-center px-6">
        <View className="bg-success/10 border border-success rounded-xl p-6 items-center">
          <Text className="text-charcoal text-xl font-bold mb-3 font-lora">
            Registrace úspěšná!
          </Text>
          <Text className="text-muted text-center mb-4 font-lora">
            Na váš e-mail jsme odeslali potvrzovací odkaz. Klikněte na něj pro
            aktivaci účtu.
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
            placeholder="Heslo (min. 6 znaků)"
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
