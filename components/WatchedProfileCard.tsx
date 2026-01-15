import { View, Text, Pressable, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { formatDistanceToNow } from "date-fns";
import { cs } from "date-fns/locale";
import { WatchedProfile } from "@/types/database";
import { useCountdown } from "@/hooks/useCountdown";

interface WatchedProfileCardProps {
  profile: WatchedProfile;
}

export function WatchedProfileCard({ profile }: WatchedProfileCardProps) {
  const countdown = useCountdown(profile.next_deadline);
  const hasAlert = profile.has_active_alert;
  const safeInitial = profile.name.length > 0 ? profile.name[0].toUpperCase() : "?";

  // Calculate time remaining for color coding
  const parsedDeadline = profile.next_deadline ? new Date(profile.next_deadline) : null;
  const deadline = parsedDeadline && !isNaN(parsedDeadline.getTime()) ? parsedDeadline : null;
  const now = Date.now();
  const timeRemaining = deadline ? deadline.getTime() - now : 0;
  const hoursRemaining = timeRemaining / (1000 * 60 * 60);

  const isOverdue = hasAlert || (deadline !== null && timeRemaining < 0);
  const isApproaching = !isOverdue && deadline !== null && hoursRemaining < 1 && hoursRemaining >= 0;

  // Border colors based on status
  const borderColor = isOverdue
    ? "border-accent" // Rose for missed (#f43f5e)
    : isApproaching
      ? "border-brand-500" // Orange for approaching (#f97316)
      : "border-green-400"; // Green for OK (#4ADE80)

  // Avatar background colors
  const avatarBgColor = isOverdue
    ? "bg-accent/20"
    : isApproaching
      ? "bg-brand-500/20"
      : "bg-green-400/20";

  // Avatar text colors
  const avatarTextColor = isOverdue
    ? "text-accent"
    : isApproaching
      ? "text-brand-500"
      : "text-green-400";

  // Status icon and color
  const getStatusIcon = () => {
    if (isOverdue) {
      return <Ionicons name="warning" size={24} color="#f43f5e" />;
    }
    if (isApproaching) {
      return <Ionicons name="time" size={24} color="#f97316" />;
    }
    return <Ionicons name="checkmark-circle" size={24} color="#4ADE80" />;
  };

  // Format last check-in time
  const getLastCheckInText = () => {
    if (!profile.last_check_in_at) {
      return "Zatím bez hlášení";
    }
    const lastCheckIn = new Date(profile.last_check_in_at);
    if (isNaN(lastCheckIn.getTime())) {
      return "Zatím bez hlášení";
    }
    const distance = formatDistanceToNow(lastCheckIn, {
      locale: cs,
      addSuffix: true
    });
    return `Naposledy: ${distance}`;
  };

  // Status text
  const getStatusText = () => {
    if (isOverdue) {
      return "Neohlásil/a se!";
    }
    if (isApproaching) {
      return "Blíží se termín";
    }
    return "V pořádku";
  };

  // Status text color
  const statusTextColor = isOverdue
    ? "text-accent"
    : isApproaching
      ? "text-brand-500"
      : "text-green-400";

  const openMap = () => {
    if (profile.last_known_lat && profile.last_known_lng) {
      const url = `https://maps.google.com/?q=${profile.last_known_lat},${profile.last_known_lng}`;
      Linking.openURL(url);
    }
  };

  return (
    <View className={`bg-white rounded-2xl p-4 mb-3 border-2 ${borderColor}`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${avatarBgColor}`}>
            <Text className={`${avatarTextColor} text-lg font-medium`}>
              {safeInitial}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-charcoal font-medium">{profile.name}</Text>
            <Text className={`text-sm font-medium ${statusTextColor}`}>
              {getStatusText()}
            </Text>
            <Text className="text-muted text-xs mt-0.5">
              {getLastCheckInText()}
            </Text>
            {!isOverdue && (
              <Text className="text-muted text-xs">
                {countdown.isExpired ? "Čas vypršel" : `Zbývá: ${countdown.formatted}`}
              </Text>
            )}
          </View>
        </View>

        <View className="items-end">
          {getStatusIcon()}
        </View>
      </View>

      {isOverdue && profile.last_known_lat && profile.last_known_lng && (
        <Pressable
          onPress={openMap}
          className="mt-3 py-2 rounded-xl bg-accent/10"
        >
          <View className="flex-row items-center justify-center">
            <Ionicons name="location" size={18} color="#f43f5e" />
            <Text className="text-accent text-center font-medium ml-1">
              Zobrazit poslední polohu
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
