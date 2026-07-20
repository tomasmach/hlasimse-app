import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Link, router, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { ApiError } from "@/lib/api";
import { login } from "@/lib/auth";
import { useAuthStore } from "@/stores/auth";
import { AuthButton, AuthInput, AuthScreen } from "@/components/auth";

export default function LoginScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const setUser = useAuthStore((state) => state.setUser);
  const passwordRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email.trim()) {
      setError("Vyplňte e-mail.");
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setError("Vyplňte heslo.");
      passwordRef.current?.focus();
      return;
    }

    setLoading(true);
    setError(null);
    try {
      setUser(await login(email, password));
      router.replace("/(tabs)");
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 401
          ? "Přihlášení se nepodařilo. Zkontrolujte údaje a ověření e-mailu."
          : cause instanceof Error
            ? cause.message
            : "Přihlášení se nezdařilo. Zkuste to znovu.",
      );
    } finally {
      setLoading(false);
    }
  };

  const openVerification = () => {
    if (!email.trim()) {
      setError("Nejdřív vyplňte e-mail, který chcete ověřit.");
      emailRef.current?.focus();
      return;
    }
    router.push({ pathname: "/(auth)/verify-email", params: { email: email.trim() } });
  };

  return (
    <AuthScreen
      testID="login-screen"
      title="Vítejte zpátky."
      intro="Přihlaste se k serverem potvrzeným check-inům a nastavení svých profilů."
    >
      {error ? (
        <Animated.View
          entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
          className="mb-6 rounded-[18px] border border-[#C33D2F] bg-white p-4"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          testID="login-error"
        >
          <Text className="font-body text-[15px] leading-5 text-[#9E382E]">{error}</Text>
        </Animated.View>
      ) : null}

      <AuthInput
        ref={emailRef}
        label="E-mail"
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          if (error) setError(null);
        }}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        editable={!loading}
        testID="login-email-input"
      />
      <AuthInput
        ref={passwordRef}
        label="Heslo"
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          if (error) setError(null);
        }}
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={() => void handleLogin()}
        editable={!loading}
        testID="login-password-input"
      />

      <Link href="/(auth)/forgot-password" asChild>
        <Pressable
          disabled={loading}
          className="mb-7 min-h-[48px] self-end justify-center"
          accessibilityRole="link"
          accessibilityLabel="Obnovit zapomenuté heslo"
          testID="login-forgot-password-link"
        >
          <Text className="font-body-semibold text-[15px] text-[#9E382E]">
            Zapomenuté heslo
          </Text>
        </Pressable>
      </Link>

      <AuthButton
        label="Přihlásit se"
        onPress={() => void handleLogin()}
        loading={loading}
        testID="login-submit-button"
      />

      <View className="mt-7 items-center gap-2">
        <View className="flex-row flex-wrap items-center justify-center">
          <Text className="font-body text-[15px] text-muted">Nemáte účet? </Text>
          <Link href="/(auth)/register" asChild>
            <Pressable
              disabled={loading}
              className="min-h-[48px] justify-center"
              accessibilityRole="link"
              testID="login-register-link"
            >
              <Text className="font-body-semibold text-[15px] text-[#9E382E]">
                Zaregistrovat se
              </Text>
            </Pressable>
          </Link>
        </View>
        <Pressable
          className="min-h-[48px] items-center justify-center px-3"
          disabled={loading}
          onPress={openVerification}
          accessibilityRole="button"
          accessibilityLabel="Poslat ověřovací e-mail znovu"
          accessibilityState={{ disabled: loading }}
          testID="login-resend-verification-button"
        >
          <Text className="text-center font-body-semibold text-[15px] text-[#9E382E]">
            Poslat ověřovací odkaz znovu
          </Text>
        </Pressable>
      </View>
    </AuthScreen>
  );
}
