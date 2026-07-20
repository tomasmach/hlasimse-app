import { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { AuthButton, AuthInput } from "@/components/auth";
import { ProgressDots } from "@/components/onboarding/ProgressDots";
import { register } from "@/lib/auth";
import { useOnboardingStore } from "@/stores/onboarding";

type Field = "name" | "email" | "password" | "confirmation";

export default function SignUpScreen() {
  const completeOnboarding = useOnboardingStore((state) => state.completeOnboarding);
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ field?: Field; message: string } | null>(null);

  const validate = (): { field: Field; message: string } | null => {
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

  const handleSignUp = async () => {
    const invalid = validate();
    if (invalid) {
      setError(invalid);
      refs[invalid.field].current?.focus();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await register({ email, password, firstName: name });
      await completeOnboarding();
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

  const openLogin = async () => {
    if (loading) return;
    setLoading(true);
    await completeOnboarding();
    router.replace("/(auth)/login");
    setLoading(false);
  };

  return (
    <SafeAreaView className="flex-1 bg-cream" testID="onboarding-register-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1"
      >
        <ProgressDots currentStep={4} />
        <ScrollView
          contentContainerClassName="flex-grow px-6 pb-12 pt-4"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          automaticallyAdjustKeyboardInsets
          showsVerticalScrollIndicator={false}
        >
          <Animated.View
            entering={FadeInDown.duration(420).reduceMotion(ReduceMotion.System)}
            className="mb-9"
          >
            <Text className="font-body-semibold text-sm tracking-[1.4px] text-[#9E382E]">
              Poslední krok
            </Text>
            <Text
              className="mt-3 font-display text-[39px] leading-[43px] tracking-[-1.2px] text-charcoal"
              accessibilityRole="header"
            >
              Vytvořte si ověřený účet zdarma.
            </Text>
            <Text className="mt-4 font-body text-[17px] leading-6 text-muted">
              Po registraci otevřete jednorázový odkaz z e-mailu. Automaticky vás nepřihlásíme.
            </Text>
          </Animated.View>

          {error && !error.field ? (
            <View
              className="mb-6 rounded-[18px] border border-[#C33D2F] bg-white p-4"
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              testID="onboarding-register-error"
            >
              <Text className="font-body text-[15px] leading-5 text-[#9E382E]">{error.message}</Text>
            </View>
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
            testID="onboarding-register-name-input"
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
            testID="onboarding-register-email-input"
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
            testID="onboarding-register-password-input"
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
            onSubmitEditing={() => void handleSignUp()}
            editable={!loading}
            error={error?.field === "confirmation" ? error.message : undefined}
            testID="onboarding-register-confirm-password-input"
          />

          <Text className="mb-6 font-body text-sm leading-5 text-muted">
            Všechny funkce jsou zdarma. Hlásím se není tísňová služba a doručení push nelze garantovat.
          </Text>
          <AuthButton
            label="Vytvořit účet zdarma"
            onPress={() => void handleSignUp()}
            loading={loading}
            testID="onboarding-register-submit-button"
          />
          <View className="mt-6 flex-row flex-wrap items-center justify-center">
            <Text className="font-body text-[15px] text-muted">Už máte účet? </Text>
            <Pressable
              onPress={() => void openLogin()}
              disabled={loading}
              className="min-h-[48px] justify-center"
              accessibilityRole="button"
              testID="onboarding-register-login-button"
            >
              <Text className="font-body-semibold text-[15px] text-[#9E382E]">Přihlásit se</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
