import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { Link, router } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "@/lib/supabase";
import { AnimatedInput, GradientButton } from "@/components/ui";
import { GRADIENTS, SPACING } from "@/constants/design";

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
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: SPACING.page,
          paddingVertical: 48,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={FadeIn.delay(100)}
          className="items-center mb-12"
        >
          <Text className="text-[40px] font-extrabold text-charcoal font-lora">
            Hlásím se
          </Text>
          <LinearGradient
            colors={GRADIENTS.coral}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            className="w-20 h-1 rounded-sm mt-2 mb-4"
          />
          <Text className="text-[17px] text-muted font-lora">
            Přihlaste se ke svému účtu
          </Text>
        </Animated.View>

        {/* Error */}
        {error && (
          <Animated.View
            entering={FadeInDown}
            className="bg-error/[0.15] border border-error rounded-2xl p-4 mb-6"
          >
            <Text className="text-error text-center text-[15px] font-lora">
              {error}
            </Text>
          </Animated.View>
        )}

        {/* Form */}
        <Animated.View
          entering={FadeIn.delay(200)}
          className="mb-8"
        >
          <AnimatedInput
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!loading}
          />

          <AnimatedInput
            label="Heslo"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            editable={!loading}
          />

          <Link href="/(auth)/forgot-password" asChild>
            <TouchableOpacity className="self-end mt-2" disabled={loading}>
              <Text className="text-coral text-[15px] font-lora-medium">
                Zapomenuté heslo?
              </Text>
            </TouchableOpacity>
          </Link>
        </Animated.View>

        {/* CTA */}
        <Animated.View
          entering={FadeIn.delay(300)}
          className="gap-6"
        >
          <GradientButton
            label="Přihlásit"
            onPress={handleLogin}
            loading={loading}
            disabled={loading}
          />

          <View className="flex-row justify-center">
            <Text className="text-muted text-[15px] font-lora">Nemáte účet? </Text>
            <Link href="/(auth)/register" asChild>
              <TouchableOpacity disabled={loading}>
                <Text className="text-coral text-[15px] font-lora-semibold">
                  Registrovat se
                </Text>
              </TouchableOpacity>
            </Link>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
