import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { router } from "expo-router";
import Animated, { FadeInDown } from "react-native-reanimated";
import { register } from "@/lib/auth";
import { useAuthStore } from "@/stores/auth";
import { useOnboardingStore } from "@/stores/onboarding";
import { AnimatedInput } from "@/components/ui/AnimatedInput";
import { GradientButton } from "@/components/ui";
import { ProgressDots } from "@/components/onboarding/ProgressDots";

export default function SignUpScreen() {
  const setUser = useAuthStore((state) => state.setUser);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { completeOnboarding } = useOnboardingStore();

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const handleSignUp = async () => {
    // Validation
    if (!name.trim()) {
      setError("Vyplňte prosím své jméno.");
      return;
    }
    if (!email.trim()) {
      setError("Vyplňte prosím e-mail.");
      return;
    }
    if (password.length < 10) {
      setError("Heslo musí mít alespoň 10 znaků.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = await register({ email, password, firstName: name });
      await completeOnboarding();
      setUser(user);
      router.replace("/(tabs)");
    } catch (err) {
      console.error("Registration error:", err);
      setError(err instanceof Error ? err.message : "Registrace se nezdařila.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cream"
    >
      <ProgressDots currentStep={4} />

      <ScrollView
        contentContainerClassName="flex-grow justify-center px-8 pb-12"
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View entering={FadeInDown.duration(500)}>
          <Text className="text-4xl font-semibold text-charcoal text-center mb-3 font-lora-semibold">
            Pojďme na to
          </Text>
          <Text className="text-lg text-muted text-center mb-10 font-lora">
            Vytvoření účtu zabere minutu
          </Text>
        </Animated.View>

        {error && (
          <Animated.View
            entering={FadeInDown.duration(300)}
            className="bg-coral/10 border border-coral rounded-2xl p-3 mb-6"
          >
            <Text className="text-coral text-center text-sm font-lora">{error}</Text>
          </Animated.View>
        )}

        <View className="mb-8">
          <AnimatedInput
            label="Jméno"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            editable={!loading}
          />

          <AnimatedInput
            ref={emailRef}
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            editable={!loading}
          />

          <AnimatedInput
            ref={passwordRef}
            label="Heslo (min. 10 znaků)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="done"
            onSubmitEditing={handleSignUp}
            editable={!loading}
          />
        </View>

        <GradientButton
          label="Vytvořit účet"
          onPress={handleSignUp}
          loading={loading}
          size="lg"
        />

        <View className="flex-row justify-center mt-6">
          <Text className="text-base text-muted font-lora">Už máte účet? </Text>
          <TouchableOpacity
            onPress={async () => {
              await completeOnboarding();
              router.replace("/(auth)/login");
            }}
            disabled={loading}
          >
            <Text className="text-base text-coral font-semibold font-lora-semibold">Přihlásit se</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
