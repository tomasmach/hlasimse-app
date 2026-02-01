import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Link, router } from "expo-router";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "@/lib/supabase";
import { AnimatedInput, GradientButton } from "@/components/ui";
import { COLORS, GRADIENTS, SPACING } from "@/constants/design";

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
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={FadeIn.delay(100)}
          style={styles.header}
        >
          <Text style={styles.title}>Hlásím se</Text>
          <LinearGradient
            colors={GRADIENTS.coral}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.titleUnderline}
          />
          <Text style={styles.subtitle}>Přihlaste se ke svému účtu</Text>
        </Animated.View>

        {/* Error */}
        {error && (
          <Animated.View
            entering={FadeInDown}
            style={styles.errorContainer}
          >
            <Text style={styles.errorText}>{error}</Text>
          </Animated.View>
        )}

        {/* Form */}
        <Animated.View
          entering={FadeIn.delay(200)}
          style={styles.form}
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
            <TouchableOpacity style={styles.forgotPassword} disabled={loading}>
              <Text style={styles.forgotPasswordText}>Zapomenuté heslo?</Text>
            </TouchableOpacity>
          </Link>
        </Animated.View>

        {/* CTA */}
        <Animated.View
          entering={FadeIn.delay(300)}
          style={styles.cta}
        >
          <GradientButton
            label="Přihlásit"
            onPress={handleLogin}
            loading={loading}
            disabled={loading}
          />

          <View style={styles.registerRow}>
            <Text style={styles.registerText}>Nemáte účet? </Text>
            <Link href="/(auth)/register" asChild>
              <TouchableOpacity disabled={loading}>
                <Text style={styles.registerLink}>Registrovat se</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream.default,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: SPACING.page,
    paddingVertical: 48,
  },
  header: {
    alignItems: "center",
    marginBottom: 48,
  },
  title: {
    fontSize: 40,
    fontWeight: "800",
    color: COLORS.charcoal.default,
  },
  titleUnderline: {
    width: 80,
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 17,
    color: COLORS.muted,
  },
  errorContainer: {
    backgroundColor: `${COLORS.error}15`,
    borderWidth: 1,
    borderColor: COLORS.error,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
  },
  errorText: {
    color: COLORS.error,
    textAlign: "center",
    fontSize: 15,
  },
  form: {
    marginBottom: 32,
  },
  forgotPassword: {
    alignSelf: "flex-end",
    marginTop: 8,
  },
  forgotPasswordText: {
    color: COLORS.coral.default,
    fontSize: 15,
    fontWeight: "500",
  },
  cta: {
    gap: 24,
  },
  registerRow: {
    flexDirection: "row",
    justifyContent: "center",
  },
  registerText: {
    color: COLORS.muted,
    fontSize: 15,
  },
  registerLink: {
    color: COLORS.coral.default,
    fontSize: 15,
    fontWeight: "600",
  },
});
