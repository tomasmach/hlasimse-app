import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Link, router } from "expo-router";
import Animated, { FadeInDown, ReduceMotion } from "react-native-reanimated";
import { EnvelopeSimple } from "phosphor-react-native";
import { register } from "@/lib/auth";
import { AnimatedInput, GradientButton } from "@/components/ui";
import { COLORS, SPACING } from "@/constants/design";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateForm = (): string | null => {
    if (!name.trim()) return "Vyplňte prosím své jméno.";
    if (!email.trim()) return "Vyplňte prosím e-mail.";
    if (!password) return "Vyplňte prosím heslo.";
    if (password.length < 10) return "Heslo musí mít alespoň 10 znaků.";
    if (password !== confirmPassword) return "Hesla se neshodují.";
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
      await register({ email, password, firstName: name });
      router.replace({ pathname: "/(auth)/verify-email", params: { email: email.trim() } });
    } catch (err) {
      console.error("Registration error:", err);
      setError(err instanceof Error ? err.message : "Registrace se nezdařila.");
    } finally {
      setLoading(false);
    }
  };

  const entrance = FadeInDown.duration(420).reduceMotion(ReduceMotion.System);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cream"
      testID="register-screen"
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
        <Animated.View entering={entrance} className="mb-10">
          <View className="mb-6 h-14 w-14 items-center justify-center rounded-full bg-coral/10">
            <EnvelopeSimple size={28} color={COLORS.coral.default} weight="bold" />
          </View>
          <Text className="font-display text-[40px] leading-[44px] tracking-[-1.2px] text-charcoal">
            Váš účet začíná ověřeným e-mailem.
          </Text>
          <Text className="mt-4 font-body text-[17px] leading-6 text-muted">
            Po registraci vám pošleme jednorázový odkaz. Bez ověření se nikdo nemůže vydávat za strážce.
          </Text>
        </Animated.View>

        {error && (
          <Animated.View
            entering={FadeInDown.duration(240).reduceMotion(ReduceMotion.System)}
            className="mb-6 rounded-2xl border border-error bg-error/[0.1] p-4"
            accessibilityRole="alert"
            testID="register-error"
          >
            <Text className="text-center font-body text-[15px] text-error">{error}</Text>
          </Animated.View>
        )}

        <Animated.View entering={entrance.delay(80)} className="mb-8">
          <AnimatedInput
            label="Jméno"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            editable={!loading}
            testID="register-name-input"
            accessibilityLabel="Jméno"
          />
          <AnimatedInput
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            editable={!loading}
            testID="register-email-input"
            accessibilityLabel="E-mail"
          />
          <AnimatedInput
            label="Heslo (min. 10 znaků)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            editable={!loading}
            testID="register-password-input"
            accessibilityLabel="Heslo"
          />
          <AnimatedInput
            label="Heslo znovu"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            autoComplete="new-password"
            editable={!loading}
            testID="register-confirm-password-input"
            accessibilityLabel="Heslo znovu"
          />
        </Animated.View>

        <GradientButton
          label="Vytvořit účet zdarma"
          onPress={handleRegister}
          loading={loading}
          disabled={loading}
          testID="register-submit-button"
          accessibilityLabel="Vytvořit účet zdarma"
        />

        <View className="mt-7 flex-row justify-center">
          <Text className="font-body text-[15px] text-muted">Už máte účet? </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity
              disabled={loading}
              accessibilityRole="link"
              accessibilityLabel="Přihlásit se"
              testID="register-login-link"
            >
              <Text className="font-body-semibold text-[15px] text-coral">Přihlásit se</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
