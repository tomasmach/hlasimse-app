import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Link, router } from "expo-router";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { register } from "@/lib/auth";
import { AuthButton, AuthInput, AuthScreen, LegalConsent } from "@/components/auth";

type Field = "name" | "email" | "password" | "confirmation";

export default function RegisterScreen() {
  const refs = {
    name: useRef<TextInput>(null),
    email: useRef<TextInput>(null),
    password: useRef<TextInput>(null),
    confirmation: useRef<TextInput>(null),
  };
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ field?: Field; message: string } | null>(null);

  const validationError = (): { field: Field; message: string } | null => {
    if (!name.trim()) return { field: "name", message: "Vyplňte své jméno." };
    if (!email.trim()) return { field: "email", message: "Vyplňte e-mail." };
    if (!password) return { field: "password", message: "Vyplňte heslo." };
    if (password.length < 10) {
      return { field: "password", message: "Heslo musí mít alespoň 10 znaků." };
    }
    if (password !== confirmation) {
      return { field: "confirmation", message: "Zadaná hesla se neshodují." };
    }
    return null;
  };

  const handleRegister = async () => {
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      refs[invalid.field].current?.focus();
      return;
    }
    if (!termsAccepted) {
      setTermsError("Před vytvořením účtu potvrďte podmínky a ochranu soukromí.");
      return;
    }

    setLoading(true);
    setError(null);
    setTermsError("");
    try {
      await register({ email, password, firstName: name, termsAccepted: true });
      router.replace({ pathname: "/(auth)/verify-email", params: { email: email.trim() } });
    } catch (cause) {
      setError({
        message:
          cause instanceof Error
            ? cause.message
            : "Registraci se nepodařilo dokončit. Zkuste to znovu.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthScreen
      testID="register-screen"
      eyebrow="Účet zdarma"
      title="Účet chrání ověřený e-mail."
      intro="Po registraci pošleme jednorázový odkaz. Bez ověření se nelze přihlásit ani přijmout pozvání strážce."
    >
      {error && !error.field ? (
        <Animated.View
          entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}
          className="mb-6 rounded-[18px] border border-[#C33D2F] bg-white p-4"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          testID="register-error"
        >
          <Text className="font-body text-[15px] leading-5 text-[#9E382E]">
            {error.message}
          </Text>
        </Animated.View>
      ) : null}

      <AuthInput
        ref={refs.name}
        label="Jméno"
        value={name}
        onChangeText={(value) => {
          setName(value);
          if (error) setError(null);
        }}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => refs.email.current?.focus()}
        editable={!loading}
        error={error?.field === "name" ? error.message : undefined}
        testID="register-name-input"
      />
      <AuthInput
        ref={refs.email}
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
        onSubmitEditing={() => refs.password.current?.focus()}
        editable={!loading}
        error={error?.field === "email" ? error.message : undefined}
        testID="register-email-input"
      />
      <AuthInput
        ref={refs.password}
        label="Heslo, alespoň 10 znaků"
        value={password}
        onChangeText={(value) => {
          setPassword(value);
          if (error) setError(null);
        }}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => refs.confirmation.current?.focus()}
        editable={!loading}
        error={error?.field === "password" ? error.message : undefined}
        testID="register-password-input"
      />
      <AuthInput
        ref={refs.confirmation}
        label="Heslo znovu"
        value={confirmation}
        onChangeText={(value) => {
          setConfirmation(value);
          if (error) setError(null);
        }}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={() => void handleRegister()}
        editable={!loading}
        error={error?.field === "confirmation" ? error.message : undefined}
        testID="register-confirm-password-input"
      />

      <Text className="mb-6 font-body text-sm leading-5 text-muted">
        Všechny funkce jsou zdarma. Hlásím se není tísňová služba a nekontaktuje 112 ani 155.
      </Text>
      <LegalConsent
        checked={termsAccepted}
        disabled={loading}
        error={termsError}
        onChange={(accepted) => {
          setTermsAccepted(accepted);
          setTermsError("");
        }}
        testIDPrefix="register"
      />
      <AuthButton
        label="Vytvořit účet zdarma"
        onPress={() => void handleRegister()}
        loading={loading}
        testID="register-submit-button"
      />

      <View className="mt-7 flex-row flex-wrap items-center justify-center">
        <Text className="font-body text-[15px] text-muted">Už máte účet? </Text>
        <Link href="/(auth)/login" asChild>
          <Pressable
            disabled={loading}
            className="min-h-[48px] justify-center"
            accessibilityRole="link"
            testID="register-login-link"
          >
            <Text className="font-body-semibold text-[15px] text-[#9E382E]">Přihlásit se</Text>
          </Pressable>
        </Link>
      </View>
    </AuthScreen>
  );
}
