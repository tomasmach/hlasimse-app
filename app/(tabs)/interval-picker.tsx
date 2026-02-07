import { useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { supabase } from "@/lib/supabase";
import { COLORS } from "@/constants/design";
import { scheduleReminders } from "@/lib/reminderNotifications";

const INTERVAL_OPTIONS = [
  { hours: 12, label: "12 hodin" },
  { hours: 24, label: "24 hodin" },
  { hours: 48, label: "48 hodin" },
  { hours: 168, label: "7 dní" },
];

export default function IntervalPickerScreen() {
  const { user } = useAuth();
  const { profile, fetchProfile, pendingCount } = useCheckInStore();
  const [selectedHours, setSelectedHours] = useState(
    profile?.interval_hours || 24
  );
  const [loadingHours, setLoadingHours] = useState<number | null>(null);
  const [error, setError] = useState('');

  const handleSelect = async (hours: number) => {
    if (hours === selectedHours || !profile?.id || !user?.id) return;

    setError('');
    setLoadingHours(hours);
    try {
      // Validate pending check-ins before calculating deadline
      if (pendingCount > 0) {
        setError('Počkejte prosím na synchronizaci offline hlášení pro přesný výpočet termínu.');
        setLoadingHours(null);
        return;
      }

      // Calculate new deadline based on last check-in or current time
      const now = new Date();
      const baseTime = profile.last_check_in_at
        ? new Date(profile.last_check_in_at)
        : now;
      let newDeadline = new Date(baseTime.getTime() + hours * 60 * 60 * 1000);

      // If new deadline would be in the past, calculate from now instead
      if (newDeadline <= now) {
        newDeadline = new Date(now.getTime() + hours * 60 * 60 * 1000);
      }

      const { error: supabaseError } = await supabase
        .from("check_in_profiles")
        .update({
          interval_hours: hours,
          next_deadline: newDeadline.toISOString(),
        })
        .eq("id", profile.id);

      if (supabaseError) throw supabaseError;

      await fetchProfile(user.id);

      // Reschedule reminder notifications for new deadline
      await scheduleReminders(newDeadline.toISOString());

      setSelectedHours(hours);
    } catch (err) {
      console.error("Failed to update interval:", err);
      setError("Nepodařilo se uložit. Zkuste to znovu.");
    } finally {
      setLoadingHours(null);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
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
        <Text className="text-xl font-lora-bold text-charcoal mb-6">
          Jak často se chcete hlásit?
        </Text>

        {/* Warning for pending offline check-ins */}
        {pendingCount > 0 && (
          <View className="bg-orange-50 border-2 border-orange-300 rounded-2xl p-4 mb-4 flex-row items-start">
            <Ionicons name="warning" size={20} color={COLORS.brand[500]} className="mr-2" />
            <Text className="text-orange-900 flex-1 ml-2 font-lora">
              Máte {pendingCount} nesynchronizované{pendingCount === 1 ? ' hlášení' : pendingCount < 5 ? ' hlášení' : ' hlášení'}. Pro přesný výpočet termínu počkejte na synchronizaci.
            </Text>
          </View>
        )}

        <View className="gap-3">
          {INTERVAL_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.hours}
              onPress={() => handleSelect(option.hours)}
              disabled={loadingHours !== null}
              activeOpacity={0.7}
              className={`bg-white rounded-2xl p-4 flex-row items-center border-2 ${
                selectedHours === option.hours
                  ? "border-coral"
                  : "border-transparent"
              }`}
            >
              <View
                className={`w-6 h-6 rounded-full border-2 items-center justify-center mr-4 ${
                  selectedHours === option.hours
                    ? "border-coral bg-coral"
                    : "border-gray-300"
                }`}
              >
                {selectedHours === option.hours && (
                  <Ionicons name="checkmark" size={16} color="white" />
                )}
              </View>
              <Text className="text-charcoal text-lg font-lora">{option.label}</Text>
              {loadingHours === option.hours && (
                <ActivityIndicator className="ml-auto" color={COLORS.coral.default} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {error && (
          <Text className="text-accent mt-4 font-lora">{error}</Text>
        )}
      </View>
    </SafeAreaView>
  );
}
