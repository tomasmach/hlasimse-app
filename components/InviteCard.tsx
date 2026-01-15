import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { InviteWithInviter } from "@/types/database";

interface InviteCardProps {
  invite: InviteWithInviter;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
  isLoading?: boolean;
}

export function InviteCard({ invite, onAccept, onDecline, isLoading }: InviteCardProps) {
  const inviterName = invite.inviter?.name || invite.inviter?.email || "Neznámý";
  const safeInitial = inviterName.length > 0 ? inviterName[0].toUpperCase() : "?";

  return (
    <View className="bg-white rounded-2xl p-4 mb-3">
      <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 rounded-full bg-peach/30 items-center justify-center mr-3">
          <Text className="text-coral text-lg">
            {safeInitial}
          </Text>
        </View>
        <View className="flex-1">
          <Text className="text-charcoal font-medium">
            {inviterName}
          </Text>
          <Text className="text-muted text-sm">
            Chce tě jako strážce pro "{invite.check_in_profile?.name || "profil"}"
          </Text>
        </View>
      </View>

      <View className="flex-row gap-3">
        <Pressable
          onPress={() => onDecline(invite.id)}
          disabled={isLoading}
          className="flex-1 py-3 rounded-xl border border-muted/30"
        >
          <Text className="text-muted text-center font-medium">Odmítnout</Text>
        </Pressable>
        <Pressable
          onPress={() => onAccept(invite.id)}
          disabled={isLoading}
          className="flex-1 py-3 rounded-xl bg-coral"
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-white text-center font-medium">Přijmout</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}
