# Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementovat kompletní autentizační flow - registrace, přihlášení, zapomenuté heslo.

**Architecture:** Expo Router group `(auth)` pro auth obrazovky, protected routing v root layoutu, Supabase Auth pro backend.

**Tech Stack:** Expo Router, Supabase Auth, Zustand (auth store již existuje), NativeWind

---

## Task 1: Create Auth Screen Components

**Files:**
- Create: `app/(auth)/_layout.tsx`
- Create: `app/(auth)/login.tsx`
- Create: `app/(auth)/register.tsx`
- Create: `app/(auth)/forgot-password.tsx`

**Step 1: Create auth group layout**

```typescript
// app/(auth)/_layout.tsx
import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#FFF8F5" },
      }}
    />
  );
}
```

**Step 2: Create login screen**

```typescript
// app/(auth)/login.tsx
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Link, router } from "expo-router";
import { supabase } from "@/lib/supabase";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Vyplňte email a heslo");
      return;
    }

    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setLoading(false);

    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Nesprávný email nebo heslo"
          : "Přihlášení se nezdařilo"
      );
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cream"
    >
      <View className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-charcoal text-center mb-2">
          Vítejte zpět
        </Text>
        <Text className="text-muted text-center mb-8">
          Přihlaste se do Hlásím se
        </Text>

        {error && (
          <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-4">
            <Text className="text-coral text-center">{error}</Text>
          </View>
        )}

        <View className="mb-4">
          <Text className="text-charcoal mb-2 font-medium">Email</Text>
          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="vas@email.cz"
            placeholderTextColor="#8B7F7A"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
        </View>

        <View className="mb-6">
          <Text className="text-charcoal mb-2 font-medium">Heslo</Text>
          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="••••••••"
            placeholderTextColor="#8B7F7A"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 mb-4 ${loading ? "bg-coral/50" : "bg-coral"}`}
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-center font-bold text-lg">
              Přihlásit se
            </Text>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/forgot-password" asChild>
          <TouchableOpacity className="mb-6">
            <Text className="text-coral text-center">Zapomněli jste heslo?</Text>
          </TouchableOpacity>
        </Link>

        <View className="flex-row justify-center">
          <Text className="text-muted">Nemáte účet? </Text>
          <Link href="/(auth)/register" asChild>
            <TouchableOpacity>
              <Text className="text-coral font-medium">Registrovat se</Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
```

**Step 3: Create register screen**

```typescript
// app/(auth)/register.tsx
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Link } from "expo-router";
import { supabase } from "@/lib/supabase";

export default function RegisterScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleRegister = async () => {
    setError(null);

    if (!name || !email || !password || !confirmPassword) {
      setError("Vyplňte všechna pole");
      return;
    }

    if (password !== confirmPassword) {
      setError("Hesla se neshodují");
      return;
    }

    if (password.length < 6) {
      setError("Heslo musí mít alespoň 6 znaků");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          name: name.trim(),
        },
      },
    });

    setLoading(false);

    if (error) {
      if (error.message.includes("already registered")) {
        setError("Tento email je již registrován");
      } else {
        setError("Registrace se nezdařila");
      }
    } else {
      setSuccess(true);
    }
  };

  if (success) {
    return (
      <View className="flex-1 bg-cream justify-center px-6">
        <View className="bg-success/10 border border-success rounded-xl p-6">
          <Text className="text-charcoal text-xl font-bold text-center mb-2">
            Registrace úspěšná!
          </Text>
          <Text className="text-muted text-center mb-4">
            Na váš email jsme poslali potvrzovací odkaz. Klikněte na něj pro dokončení registrace.
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity className="bg-coral rounded-xl py-3">
              <Text className="text-white text-center font-bold">
                Zpět na přihlášení
              </Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cream"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-6 py-8">
          <Text className="text-3xl font-bold text-charcoal text-center mb-2">
            Vytvořit účet
          </Text>
          <Text className="text-muted text-center mb-8">
            Začněte se hlásit svým blízkým
          </Text>

          {error && (
            <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-4">
              <Text className="text-coral text-center">{error}</Text>
            </View>
          )}

          <View className="mb-4">
            <Text className="text-charcoal mb-2 font-medium">Jméno</Text>
            <TextInput
              className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
              placeholder="Jan Novák"
              placeholderTextColor="#8B7F7A"
              value={name}
              onChangeText={setName}
              autoComplete="name"
            />
          </View>

          <View className="mb-4">
            <Text className="text-charcoal mb-2 font-medium">Email</Text>
            <TextInput
              className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
              placeholder="vas@email.cz"
              placeholderTextColor="#8B7F7A"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          <View className="mb-4">
            <Text className="text-charcoal mb-2 font-medium">Heslo</Text>
            <TextInput
              className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
              placeholder="Minimálně 6 znaků"
              placeholderTextColor="#8B7F7A"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
            />
          </View>

          <View className="mb-6">
            <Text className="text-charcoal mb-2 font-medium">Potvrzení hesla</Text>
            <TextInput
              className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
              placeholder="Zopakujte heslo"
              placeholderTextColor="#8B7F7A"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="new-password"
            />
          </View>

          <TouchableOpacity
            className={`rounded-xl py-4 mb-6 ${loading ? "bg-coral/50" : "bg-coral"}`}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white text-center font-bold text-lg">
                Registrovat se
              </Text>
            )}
          </TouchableOpacity>

          <View className="flex-row justify-center">
            <Text className="text-muted">Již máte účet? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text className="text-coral font-medium">Přihlásit se</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

**Step 4: Create forgot password screen**

```typescript
// app/(auth)/forgot-password.tsx
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Link } from "expo-router";
import { supabase } from "@/lib/supabase";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleResetPassword = async () => {
    if (!email) {
      setError("Zadejte email");
      return;
    }

    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      {
        redirectTo: "hlasimse://reset-password",
      }
    );

    setLoading(false);

    if (error) {
      setError("Nepodařilo se odeslat email");
    } else {
      setSuccess(true);
    }
  };

  if (success) {
    return (
      <View className="flex-1 bg-cream justify-center px-6">
        <View className="bg-success/10 border border-success rounded-xl p-6">
          <Text className="text-charcoal text-xl font-bold text-center mb-2">
            Email odeslán!
          </Text>
          <Text className="text-muted text-center mb-4">
            Zkontrolujte svou emailovou schránku a klikněte na odkaz pro obnovení hesla.
          </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity className="bg-coral rounded-xl py-3">
              <Text className="text-white text-center font-bold">
                Zpět na přihlášení
              </Text>
            </TouchableOpacity>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      className="flex-1 bg-cream"
    >
      <View className="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-charcoal text-center mb-2">
          Zapomenuté heslo
        </Text>
        <Text className="text-muted text-center mb-8">
          Zadejte email a pošleme vám odkaz pro obnovení
        </Text>

        {error && (
          <View className="bg-coral/10 border border-coral rounded-xl p-3 mb-4">
            <Text className="text-coral text-center">{error}</Text>
          </View>
        )}

        <View className="mb-6">
          <Text className="text-charcoal mb-2 font-medium">Email</Text>
          <TextInput
            className="bg-white border border-sand rounded-xl px-4 py-3 text-charcoal"
            placeholder="vas@email.cz"
            placeholderTextColor="#8B7F7A"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />
        </View>

        <TouchableOpacity
          className={`rounded-xl py-4 mb-6 ${loading ? "bg-coral/50" : "bg-coral"}`}
          onPress={handleResetPassword}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-center font-bold text-lg">
              Odeslat odkaz
            </Text>
          )}
        </TouchableOpacity>

        <Link href="/(auth)/login" asChild>
          <TouchableOpacity>
            <Text className="text-coral text-center">Zpět na přihlášení</Text>
          </TouchableOpacity>
        </Link>
      </View>
    </KeyboardAvoidingView>
  );
}
```

**Step 5: Commit**

```bash
git add app/\(auth\)/
git commit -m "feat: add auth screens (login, register, forgot-password)"
```

---

## Task 2: Update Root Layout with Auth Routing

**Files:**
- Modify: `app/_layout.tsx`

**Step 1: Update root layout with auth state handling**

```typescript
// app/_layout.tsx
import "../global.css";
import { useEffect } from "react";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/hooks/useAuth";

function useProtectedRoute(user: any, isLoading: boolean) {
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (user && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [user, segments, isLoading]);
}

export default function RootLayout() {
  const { user, isLoading } = useAuth();

  useProtectedRoute(user, isLoading);

  if (isLoading) {
    return (
      <View className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="+not-found" />
      </Stack>
    </>
  );
}
```

**Step 2: Commit**

```bash
git add app/_layout.tsx
git commit -m "feat: add protected routing based on auth state"
```

---

## Task 3: Add Logout to Settings Screen

**Files:**
- Modify: `app/(tabs)/settings.tsx`

**Step 1: Update settings with logout button**

```typescript
// app/(tabs)/settings.tsx
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";

export default function SettingsScreen() {
  const { user } = useAuth();

  const handleLogout = () => {
    Alert.alert(
      "Odhlásit se",
      "Opravdu se chcete odhlásit?",
      [
        { text: "Zrušit", style: "cancel" },
        {
          text: "Odhlásit",
          style: "destructive",
          onPress: async () => {
            await supabase.auth.signOut();
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-cream p-4">
      <View className="bg-white rounded-2xl p-4 mb-4">
        <Text className="text-muted text-sm mb-1">Přihlášen jako</Text>
        <Text className="text-charcoal font-medium">{user?.email}</Text>
      </View>

      <TouchableOpacity
        className="bg-white rounded-2xl p-4 border border-coral"
        onPress={handleLogout}
      >
        <Text className="text-coral text-center font-medium">Odhlásit se</Text>
      </TouchableOpacity>
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add app/\(tabs\)/settings.tsx
git commit -m "feat: add logout functionality to settings"
```

---

## Task 4: Configure Supabase Auth Settings

**Files:**
- Update Supabase dashboard settings

**Step 1: Configure redirect URL in Supabase**

In Supabase Dashboard > Authentication > URL Configuration:
- Site URL: `hlasimse://`
- Redirect URLs: Add `hlasimse://reset-password`

**Step 2: Update app.json with scheme**

```json
// app.json - add/verify scheme
{
  "expo": {
    "scheme": "hlasimse"
  }
}
```

**Step 3: Commit if app.json changed**

```bash
git add app.json
git commit -m "chore: configure deep link scheme for auth"
```

---

## Task 5: Test Auth Flow

**Steps:**
1. Run `npx expo start`
2. Test registration flow
3. Test login flow
4. Test logout flow
5. Test forgot password flow
6. Verify protected routing works

**Expected Results:**
- Unauthenticated users see login screen
- After login, users see tabs
- Logout returns to login screen
- Registration shows success message
- Forgot password shows success message

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create auth screens (login, register, forgot-password) |
| 2 | Update root layout with protected routing |
| 3 | Add logout to settings |
| 4 | Configure Supabase auth settings |
| 5 | Test complete auth flow |
