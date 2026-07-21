import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { CheckCircle, EnvelopeSimple, WarningCircle } from "phosphor-react-native";
import { confirmEmailVerification, resendEmailVerification } from "@/lib/auth";
import { AuthButton, AuthScreen } from "@/components/auth";
import { COLORS } from "@/constants/design";

type ScreenState = "sent" | "confirming" | "verified" | "expired" | "invalid";

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string; token?: string }>();
  const email = typeof params.email === "string" ? params.email.trim() : "";
  const token = typeof params.token === "string" ? params.token : "";
  const [state, setState] = useState<ScreenState>(token ? "confirming" : "sent");
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setState("sent");
      return;
    }
    let active = true;
    setState("confirming");
    setMessage(null);
    confirmEmailVerification(token)
      .then((result) => {
        if (!active) return;
        setState(
          result.status === "verified" || result.status === "already_verified"
            ? "verified"
            : result.status,
        );
      })
      .catch((cause) => {
        if (!active) return;
        const copy = cause instanceof Error ? cause.message.toLowerCase() : "";
        setState(copy.includes("expired") || copy.includes("vypršel") ? "expired" : "invalid");
      });
    return () => {
      active = false;
    };
  }, [token]);

  const resend = async () => {
    if (!email) {
      setMessage({
        tone: "error",
        text: "Pro nový odkaz nejdřív vyplňte e-mail na přihlašovací obrazovce.",
      });
      return;
    }
    setResending(true);
    setMessage(null);
    try {
      const result = await resendEmailVerification(email);
      setMessage({ tone: "info", text: result.detail });
      setState("sent");
    } catch {
      setMessage({
        tone: "error",
        text: "Požadavek se nepodařilo odeslat. Zkontrolujte připojení a zkuste to znovu.",
      });
    } finally {
      setResending(false);
    }
  };

  const verified = state === "verified";
  const failed = state === "expired" || state === "invalid";
  const title = verified
    ? "E-mail je ověřený."
    : state === "expired"
      ? "Platnost odkazu skončila."
      : state === "invalid"
        ? "Odkaz nelze použít."
        : state === "confirming"
          ? "Ověřujeme jednorázový odkaz."
          : "Teď zkontrolujte e-mail.";
  const intro = verified
    ? "Účet je připravený. Přihlášení provedete samostatně; heslo se z odkazu nepřenáší."
    : failed
      ? "Odkaz mohl vypršet nebo už být použitý. Můžete si vyžádat nový."
      : state === "confirming"
        ? "Počkejte, než server ověří platnost odkazu."
        : "Otevřete jednorázový odkaz z e-mailu. Platí 24 hodin; samotná registrace vás nepřihlásí.";

  return (
    <AuthScreen
      testID="email-verification-screen"
      eyebrow="Ověření účtu"
      title={title}
      intro={intro}
    >
      <Animated.View
        entering={FadeInDown.duration(320).reduceMotion(ReduceMotion.System)}
        className="rounded-[28px] border border-sand bg-white p-6"
      >
        <View className="mb-6 h-14 w-14 items-center justify-center rounded-full bg-cream-dark">
          {verified ? (
            <CheckCircle size={30} color="#245E3C" weight="fill" />
          ) : failed ? (
            <WarningCircle size={30} color="#9E382E" weight="fill" />
          ) : state === "confirming" ? (
            <ActivityIndicator color={COLORS.charcoal.default} />
          ) : (
            <EnvelopeSimple size={30} color={COLORS.charcoal.default} weight="regular" />
          )}
        </View>
        <Text
          className="font-display text-[24px] leading-8 text-charcoal"
          accessibilityRole="header"
          testID="email-verification-title"
        >
          {verified ? "Ověření je hotové" : failed ? "Potřebujete nový odkaz" : "Odkaz je jednorázový"}
        </Text>
        <Text className="mt-3 font-body text-[16px] leading-6 text-muted">
          {verified
            ? "Pokračujte na přihlášení a zadejte své údaje."
            : "Nový požadavek má stejnou odpověď pro existující i neznámou adresu, aby neprozrazoval účty."}
        </Text>

        {message ? (
          <View
            className={`mt-6 rounded-[18px] border p-4 ${
              message.tone === "error"
                ? "border-[#C33D2F] bg-white"
                : "border-sand bg-cream"
            }`}
            accessibilityRole={message.tone === "error" ? "alert" : undefined}
            accessibilityLiveRegion={message.tone === "error" ? "assertive" : "polite"}
            testID="email-verification-message"
          >
            <Text
              className={`font-body text-[15px] leading-5 ${
                message.tone === "error" ? "text-[#9E382E]" : "text-charcoal"
              }`}
            >
              {message.text}
            </Text>
          </View>
        ) : null}

        <View className="mt-7 gap-3">
          {verified ? (
            <AuthButton
              label="Přihlásit se"
              onPress={() =>
                router.replace({ pathname: "/(auth)/login", params: email ? { email } : {} })
              }
              testID="email-verification-login-button"
            />
          ) : (
            <AuthButton
              label={failed ? "Vyžádat nový odkaz" : "Poslat odkaz znovu"}
              onPress={() => void resend()}
              loading={resending || state === "confirming"}
              disabled={state === "confirming"}
              testID="email-verification-resend-button"
            />
          )}
          {!verified && state !== "confirming" ? (
            <Pressable
              onPress={() =>
                router.replace({ pathname: "/(auth)/login", params: email ? { email } : {} })
              }
              className="min-h-[48px] items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel="Přejít na přihlášení"
              testID="email-verification-confirmed-button"
            >
              <Text className="font-body-semibold text-[15px] text-[#9E382E]">
                Přejít na přihlášení
              </Text>
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </AuthScreen>
  );
}
