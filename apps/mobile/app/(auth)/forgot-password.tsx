import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Link } from "expo-router";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { EnvelopeSimple } from "phosphor-react-native";
import { apiRequest } from "@/lib/api";
import { AuthButton, AuthInput, AuthScreen } from "@/components/auth";
import { COLORS } from "@/constants/design";

export default function ForgotPasswordScreen() {
  const emailRef = useRef<TextInput>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);

  const handleResetPassword = async () => {
    if (!email.trim()) {
      setError("Vyplňte e-mail.");
      emailRef.current?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiRequest("/api/v1/auth/password-reset/", {
        method: "POST",
        auth: false,
        body: { email: email.trim().toLowerCase() },
      });
      setRequested(true);
    } catch {
      setError("Požadavek se nepodařilo odeslat. Zkontrolujte připojení a zkuste to znovu.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen
      testID="forgot-password-screen"
      eyebrow="Obnova přístupu"
      title={requested ? "Teď zkontrolujte e-mail." : "Nastavte si nové heslo."}
      intro={
        requested
          ? "Pokud účet pro zadanou adresu existuje, poslali jsme pokyny k bezpečné změně hesla."
          : "Zadejte adresu účtu. Kvůli ochraně soukromí neprozradíme, jestli je u nás registrovaná."
      }
    >
      {requested ? (
        <Animated.View
          entering={FadeInDown.duration(260).reduceMotion(ReduceMotion.System)}
          className="rounded-[28px] border border-sand bg-white p-6"
          accessibilityLiveRegion="polite"
          testID="forgot-password-success"
        >
          <View className="mb-5 h-14 w-14 items-center justify-center rounded-full bg-cream-dark">
            <EnvelopeSimple size={28} color={COLORS.charcoal.default} weight="regular" />
          </View>
          <Text className="font-display text-[25px] leading-8 text-charcoal">Další krok je v e-mailu</Text>
          <Text className="mt-3 font-body text-[16px] leading-6 text-muted">
            Odkaz použijte pouze na zařízení, kterému důvěřujete. Když zpráva nepřijde, zkontrolujte spam nebo požadavek zopakujte později.
          </Text>
          <Link href="/(auth)/login" asChild>
            <Pressable
              className="mt-6 min-h-[52px] items-center justify-center rounded-[18px] bg-charcoal px-5"
              accessibilityRole="link"
              testID="forgot-password-login-link"
            >
              <Text className="font-body-semibold text-[16px] text-cream">Zpět na přihlášení</Text>
            </Pressable>
          </Link>
        </Animated.View>
      ) : (
        <>
          {error && error !== "Vyplňte e-mail." ? (
            <View
              className="mb-6 rounded-[18px] border border-[#C33D2F] bg-white p-4"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              testID="forgot-password-error"
            >
              <Text className="font-body text-[15px] leading-5 text-[#9E382E]">{error}</Text>
            </View>
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
            returnKeyType="send"
            onSubmitEditing={() => void handleResetPassword()}
            editable={!loading}
            error={!email.trim() && error === "Vyplňte e-mail." ? error : undefined}
            testID="forgot-password-email-input"
          />
          <AuthButton
            label="Poslat pokyny"
            onPress={() => void handleResetPassword()}
            loading={loading}
            testID="forgot-password-submit-button"
          />
          <Link href="/(auth)/login" asChild>
            <Pressable
              disabled={loading}
              className="mt-6 min-h-[48px] items-center justify-center"
              accessibilityRole="link"
              testID="forgot-password-back-link"
            >
              <Text className="font-body-semibold text-[15px] text-[#9E382E]">Zpět na přihlášení</Text>
            </Pressable>
          </Link>
        </>
      )}
    </AuthScreen>
  );
}
