import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { COLORS } from "@/constants/design";

interface AddGuardianModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (email: string) => Promise<{ success: boolean; error?: string }>;
}

export function AddGuardianModal({ visible, onClose, onSubmit }: AddGuardianModalProps) {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!email.trim()) {
      setError("Zadej email strážce");
      return;
    }

    // Základní validace emailu
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setError("Zadej platný email");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await onSubmit(email.trim().toLowerCase());

      if (result.success) {
        setEmail("");
        onClose();
      } else {
        setError(result.error || "Nepodařilo se odeslat pozvánku");
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Došlo k neočekávané chybě");
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setEmail("");
    setError(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <Pressable
          onPress={handleClose}
          className="flex-1 bg-black/50 justify-center items-center px-6"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            className="bg-cream w-full rounded-3xl p-6"
          >
            <Text className="text-charcoal text-xl font-semibold mb-2 font-lora-semibold">
              Přidat strážce
            </Text>
            <Text className="text-muted mb-4 font-lora">
              Zadej email osoby, která tě bude hlídat. Musí mít účet v aplikaci.
            </Text>

            <TextInput
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                setError(null);
              }}
              placeholder="email@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              className="bg-white rounded-xl px-4 py-3 text-charcoal mb-3"
              placeholderTextColor={COLORS.muted}
            />

            {error && (
              <Text className="text-coral text-sm mb-3 font-lora">{error}</Text>
            )}

            <View className="flex-row gap-3">
              <Pressable
                onPress={handleClose}
                disabled={isLoading}
                className="flex-1 py-3 rounded-xl border border-muted/30"
              >
                <Text className="text-muted text-center font-medium font-lora-medium">Zrušit</Text>
              </Pressable>
              <Pressable
                onPress={handleSubmit}
                disabled={isLoading}
                className="flex-1 py-3 rounded-xl bg-coral"
              >
                {isLoading ? (
                  <ActivityIndicator color={COLORS.white} />
                ) : (
                  <Text className="text-white text-center font-medium font-lora-medium">Pozvat</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
