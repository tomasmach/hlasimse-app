import { useEffect, useState, useCallback } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/hooks/useAuth";
import { useCheckInStore } from "@/stores/checkin";
import { useGuardiansStore } from "@/stores/guardians";
import { GuardianCard } from "@/components/GuardianCard";
import { InviteCard } from "@/components/InviteCard";
import { WatchedProfileCard } from "@/components/WatchedProfileCard";
import { AddGuardianModal } from "@/components/AddGuardianModal";
import { EmptyState } from "@/components/EmptyState";

export default function GuardiansScreen() {
  const { user } = useAuth();
  const { profile } = useCheckInStore();
  const {
    myGuardians,
    pendingInvites,
    watchedProfiles,
    isLoading,
    fetchMyGuardians,
    fetchPendingInvites,
    fetchWatchedProfiles,
    sendInvite,
    acceptInvite,
    declineInvite,
    removeGuardian,
    subscribeToInvites,
    unsubscribeFromInvites,
  } = useGuardiansStore();

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.id) return;

    await Promise.all([
      profile?.id ? fetchMyGuardians(profile.id) : Promise.resolve(),
      fetchPendingInvites(user.id),
      fetchWatchedProfiles(user.id),
    ]);
  }, [user?.id, profile?.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Subscribe to real-time invite updates
  useEffect(() => {
    if (user?.id) {
      subscribeToInvites(user.id);
    }

    return () => {
      unsubscribeFromInvites();
    };
  }, [user?.id]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const handleSendInvite = async (email: string) => {
    if (!profile?.id) {
      return { success: false, error: "Nemáš vytvořený profil" };
    }
    return sendInvite(profile.id, email);
  };

  const handleAcceptInvite = async (inviteId: string) => {
    const success = await acceptInvite(inviteId);
    if (success && user?.id) {
      // Refresh watched profiles
      fetchWatchedProfiles(user.id);
    }
  };

  if (!user) {
    return (
      <SafeAreaView className="flex-1 bg-cream items-center justify-center">
        <ActivityIndicator size="large" color="#FF6B5B" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-cream" edges={["top"]}>
      <ScrollView
        className="flex-1 px-6"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-charcoal text-2xl font-semibold mt-4 mb-6">
          Strážci
        </Text>

        {/* Moji strážci */}
        <View className="mb-6">
          <Text className="text-muted text-sm font-medium mb-3 uppercase tracking-wide">
            Moji strážci
          </Text>

          {isLoading && myGuardians.length === 0 ? (
            <View className="bg-white rounded-2xl p-4">
              <ActivityIndicator color="#FF6B5B" />
            </View>
          ) : myGuardians.length === 0 ? (
            <View className="bg-white rounded-2xl">
              <EmptyState
                emoji="👀"
                title="Zatím nemáte žádné strážce"
                description="Strážce dostane upozornění, když se neohlásíte včas."
                actionLabel="+ Přidat strážce"
                onAction={() => setIsModalVisible(true)}
              />
            </View>
          ) : (
            <>
              {myGuardians.map((guardian) => (
                <GuardianCard
                  key={guardian.id}
                  guardian={guardian}
                  onRemove={removeGuardian}
                  isRemoving={isLoading}
                />
              ))}
              <Pressable
                onPress={() => setIsModalVisible(true)}
                className="bg-coral/10 rounded-2xl p-4 mt-2"
              >
                <Text className="text-coral text-center font-medium">
                  + Přidat strážce
                </Text>
              </Pressable>
            </>
          )}
        </View>

        {/* Čekající pozvánky */}
        {pendingInvites.length > 0 && (
          <View className="mb-6">
            <Text className="text-muted text-sm font-medium mb-3 uppercase tracking-wide">
              Čekající pozvánky
            </Text>
            {pendingInvites.map((invite) => (
              <InviteCard
                key={invite.id}
                invite={invite}
                onAccept={handleAcceptInvite}
                onDecline={declineInvite}
                isLoading={isLoading}
              />
            ))}
          </View>
        )}

        {/* Hlídám */}
        <View className="mb-6">
          <Text className="text-muted text-sm font-medium mb-3 uppercase tracking-wide">
            Hlídám
          </Text>

          {watchedProfiles.length === 0 ? (
            <View className="bg-white rounded-2xl">
              <EmptyState
                emoji="🛡️"
                title="Nikoho nehlídáte"
                description="Až vás někdo pozve jako strážce, uvidíte ho zde."
              />
            </View>
          ) : (
            watchedProfiles.map((watchedProfile) => (
              <WatchedProfileCard key={watchedProfile.id} profile={watchedProfile} />
            ))
          )}
        </View>

        {/* Spacing at bottom */}
        <View className="h-8" />
      </ScrollView>

      <AddGuardianModal
        visible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        onSubmit={handleSendInvite}
      />
    </SafeAreaView>
  );
}
