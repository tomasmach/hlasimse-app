import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Warning } from "phosphor-react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

export default function DeleteAccountScreen() {
  const { user, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDelete = async () => {
    if (!password) {
      setError("Zadejte heslo pro potvrzení");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Re-authenticate with password
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user?.email || "",
        password,
      });

      if (authError) {
        setError("Nesprávné heslo");
        setIsLoading(false);
        return;
      }

      // Delete user data via Edge Function with service role
      const { error: deleteError } = await supabase.functions.invoke(
        "delete-user",
        {
          body: { userId: user?.id },
        }
      );

      if (deleteError) throw deleteError;

      // Show alert first, then sign out on OK press
      Alert.alert("Účet smazán", "Váš účet byl úspěšně smazán.", [
        {
          text: "OK",
          onPress: async () => {
            await signOut();
            router.replace("/(auth)/login");
          },
        },
      ]);
    } catch (err: any) {
      setError(err.message || "Nepodařilo se smazat účet");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        {/* Header */}
        <View className="flex-row items-center px-4 py-2">
          <TouchableOpacity
            onPress={() => router.back()}
            className="p-2"
            activeOpacity={0.7}
          >
            <Text className="text-coral text-lg font-lora-medium">← Zpět</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View className="px-6 pt-6">
          <View className="mb-4">
            <Warning size={80} color="#F43F5E" weight="regular" />
          </View>
          <Text className="text-xl font-lora-bold text-charcoal mb-2">
            Smazat účet
          </Text>
          <Text className="text-muted mb-6 font-lora">
            Tato akce je nevratná. Všechna vaše data budou trvale odstraněna.
          </Text>

          <Text className="text-charcoal font-lora-medium mb-2">
            Pro potvrzení zadejte heslo:
          </Text>
          <TextInput
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (error) setError("");
            }}
            placeholder="Heslo"
            placeholderTextColor="#8B7F7A"
            secureTextEntry
            className="bg-white rounded-2xl px-4 py-4 text-charcoal text-lg border border-sand"
            autoCapitalize="none"
            autoComplete="password"
            editable={!isLoading}
          />
          {error && <Text className="text-coral mt-2 font-lora">{error}</Text>}

          <TouchableOpacity
            onPress={handleDelete}
            disabled={isLoading}
            className="bg-accent rounded-full py-4 items-center mt-6"
            activeOpacity={0.7}
          >
            {isLoading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-white font-lora-semibold text-lg">
                Smazat účet trvale
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
