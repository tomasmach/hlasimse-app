import { View, Text, Pressable, Linking } from "react-native";
import { WatchedProfile } from "@/types/database";
import { useCountdown } from "@/hooks/useCountdown";

interface WatchedProfileCardProps {
  profile: WatchedProfile;
}

export function WatchedProfileCard({ profile }: WatchedProfileCardProps) {
  const countdown = useCountdown(profile.next_deadline);
  const hasAlert = profile.has_active_alert;

  const openMap = () => {
    if (profile.last_known_lat && profile.last_known_lng) {
      const url = `https://maps.google.com/?q=${profile.last_known_lat},${profile.last_known_lng}`;
      Linking.openURL(url);
    }
  };

  return (
    <View className={`bg-white rounded-2xl p-4 mb-3 ${hasAlert ? "border-2 border-coral" : ""}`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${
            hasAlert ? "bg-coral/20" : "bg-success/20"
          }`}>
            <Text className={hasAlert ? "text-coral text-lg" : "text-success text-lg"}>
              {profile.name[0].toUpperCase()}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-charcoal font-medium">{profile.name}</Text>
            {hasAlert ? (
              <Text className="text-coral text-sm font-medium">Neohlasil/a se!</Text>
            ) : (
              <Text className="text-muted text-sm">
                {countdown.isExpired ? "Cas vypršel" : countdown.formatted}
              </Text>
            )}
          </View>
        </View>

        <View className="items-end">
          {hasAlert ? (
            <Text className="text-2xl">⚠️</Text>
          ) : countdown.isExpired ? (
            <Text className="text-coral text-lg">⏰</Text>
          ) : (
            <Text className="text-success text-lg">✓</Text>
          )}
        </View>
      </View>

      {hasAlert && profile.last_known_lat && profile.last_known_lng && (
        <Pressable
          onPress={openMap}
          className="mt-3 py-2 rounded-xl bg-coral/10"
        >
          <Text className="text-coral text-center font-medium">
            📍 Zobrazit poslední polohu
          </Text>
        </Pressable>
      )}
    </View>
  );
}
