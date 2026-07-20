import { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { CheckCircle, EnvelopeSimple, WarningCircle } from "phosphor-react-native";
import { confirmEmailVerification, resendEmailVerification } from "@/lib/auth";
import { GradientButton } from "@/components/ui";
import { COLORS, SPACING } from "@/constants/design";

type ScreenState = "sent" | "confirming" | "verified" | "expired" | "invalid";

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string; token?: string }>();
  const email = typeof params.email === "string" ? params.email : "";
  const token = typeof params.token === "string" ? params.token : "";
  const [state, setState] = useState<ScreenState>(token ? "confirming" : "sent");
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let mounted = true;
    confirmEmailVerification(token)
      .then((result) => {
        if (!mounted) return;
        setState(
          result.status === "verified" || result.status === "already_verified"
            ? "verified"
            : result.status,
        );
      })
      .catch((error) => {
        if (!mounted) return;
        const text = error instanceof Error ? error.message.toLowerCase() : "";
        setState(text.includes("expired") || text.includes("vypršel") ? "expired" : "invalid");
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  const resend = async () => {
    if (!email) {
      router.replace("/(auth)/login");
      return;
    }
    setResending(true);
    setMessage(null);
    try {
      const result = await resendEmailVerification(email);
      setMessage(result.detail);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Odkaz se nepodařilo odeslat.");
    } finally {
      setResending(false);
    }
  };

  const verified = state === "verified";
  const failed = state === "expired" || state === "invalid";
  const title = verified
    ? "E-mail je ověřený."
    : failed
      ? state === "expired"
        ? "Odkaz vypršel."
        : "Odkaz není platný."
      : state === "confirming"
        ? "Ověřujeme odkaz."
        : "Teď zkontrolujte e-mail.";
  const body = verified
    ? "Můžete se přihlásit a dokončit bezpečné nastavení účtu."
    : failed
      ? "Nechte si poslat nový jednorázový odkaz."
      : "Otevřete jednorázový odkaz, který jsme poslali na zadanou adresu. Platí 24 hodin.";

  return (
    <ScrollView
      className="flex-1 bg-cream"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        paddingHorizontal: SPACING.page,
        paddingVertical: 48,
      }}
      testID="email-verification-screen"
    >
      <Animated.View
        entering={FadeInDown.duration(420).reduceMotion(ReduceMotion.System)}
        className="rounded-[32px] border border-sand bg-white p-7"
      >
        <View className="mb-7 h-16 w-16 items-center justify-center rounded-full bg-coral/10">
          {verified ? (
            <CheckCircle size={34} color={COLORS.success} weight="fill" />
          ) : failed ? (
            <WarningCircle size={34} color={COLORS.error} weight="fill" />
          ) : (
            <EnvelopeSimple size={34} color={COLORS.coral.default} weight="bold" />
          )}
        </View>
        <Text
          className="font-display text-[38px] leading-[42px] tracking-[-1.1px] text-charcoal"
          accessibilityRole="header"
          testID="email-verification-title"
        >
          {title}
        </Text>
        <Text className="mt-4 font-body text-[17px] leading-6 text-muted">{body}</Text>
        {message && (
          <View
            className="mt-6 rounded-2xl border border-sand bg-cream p-4"
            accessibilityRole="alert"
            testID="email-verification-message"
          >
            <Text className="font-body text-[15px] leading-5 text-charcoal">{message}</Text>
          </View>
        )}
        <View className="mt-8 gap-4">
          {verified ? (
            <GradientButton
              label="Přihlásit se"
              onPress={() =>
                router.replace({ pathname: "/(auth)/login", params: email ? { email } : {} })
              }
              testID="email-verification-login-button"
            />
          ) : (
            <GradientButton
              label={failed ? "Poslat nový odkaz" : "Poslat odkaz znovu"}
              onPress={resend}
              loading={resending || state === "confirming"}
              disabled={resending || state === "confirming"}
              testID="email-verification-resend-button"
            />
          )}
          {!verified && !failed && state !== "confirming" && (
            <TouchableOpacity
              onPress={() =>
                router.replace({ pathname: "/(auth)/login", params: email ? { email } : {} })
              }
              className="min-h-12 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel="E-mail mám ověřený, přihlásit se"
              testID="email-verification-confirmed-button"
            >
              <Text className="font-body-semibold text-[16px] text-coral">
                E-mail mám ověřený
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>
    </ScrollView>
  );
}
