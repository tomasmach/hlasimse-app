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

  // Status-based styling and content
  type StatusKey = "overdue" | "approaching" | "ok";
  const statusKey: StatusKey = isOverdue ? "overdue" : isApproaching ? "approaching" : "ok";

  const STATUS_CONFIG: Record<StatusKey, {
    border: string;
    avatarBg: string;
    avatarText: string;
    statusText: string;
    statusTextColor: string;
    iconName: "warning" | "time" | "checkmark-circle";
    iconColor: string;
  }> = {
    overdue: {
      border: "border-accent",
      avatarBg: "bg-accent/20",
      avatarText: "text-accent",
      statusText: "Neohlásil/a se!",
      statusTextColor: "text-accent",
      iconName: "warning",
      iconColor: "#f43f5e",
    },
    approaching: {
      border: "border-brand-500",
      avatarBg: "bg-brand-500/20",
      avatarText: "text-brand-500",
      statusText: "Blíží se termín",
      statusTextColor: "text-brand-500",
      iconName: "time",
      iconColor: "#f97316",
    },
    ok: {
      border: "border-green-400",
      avatarBg: "bg-green-400/20",
      avatarText: "text-green-400",
      statusText: "V pořádku",
      statusTextColor: "text-green-400",
      iconName: "checkmark-circle",
      iconColor: "#4ADE80",
    },
  };

  const status = STATUS_CONFIG[statusKey];

  const getLastCheckInText = (): string => {
    if (!profile.last_check_in_at) return "Zatím bez hlášení";
    const lastCheckIn = new Date(profile.last_check_in_at);
    if (isNaN(lastCheckIn.getTime())) return "Zatím bez hlášení";
    const distance = formatDistanceToNow(lastCheckIn, {
      locale: cs,
      addSuffix: true,
    });
    return `Naposledy: ${distance}`;
  };

  const openMap = () => {
    if (profile.last_known_lat && profile.last_known_lng) {
      const url = `https://maps.google.com/?q=${profile.last_known_lat},${profile.last_known_lng}`;
      Linking.openURL(url);
    }
  };

  return (
    <View className={`bg-white rounded-2xl p-4 mb-3 border-2 ${status.border}`}>
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <View className={`w-10 h-10 rounded-full items-center justify-center mr-3 ${status.avatarBg}`}>
            <Text className={`${status.avatarText} text-lg font-medium`}>
              {safeInitial}
            </Text>
          </View>
          <View className="flex-1">
            <Text className="text-charcoal font-medium">{profile.name}</Text>
            <Text className={`text-sm font-medium ${status.statusTextColor}`}>
              {status.statusText}
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
          <Ionicons name={status.iconName} size={24} color={status.iconColor} />
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
