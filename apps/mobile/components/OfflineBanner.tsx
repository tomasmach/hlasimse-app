import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/design';

interface OfflineBannerProps {
  pendingCount: number;
  onSync?: () => void;
  isSyncing?: boolean;
}

export function OfflineBanner({ pendingCount, onSync, isSyncing = false }: OfflineBannerProps) {
  if (pendingCount === 0) return null;

  const pendingLabel =
    pendingCount === 1
      ? "1 hlášení čeká na odeslání."
      : `${pendingCount} hlášení čekají na odeslání.`;

  return (
    <View
      className="bg-sand rounded-2xl p-4 mx-4 mb-4"
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <View className="flex-row items-center">
        <Ionicons name="cellular-outline" size={20} color={COLORS.muted} />
        <View className="ml-3 flex-1">
          <Text className="text-charcoal font-medium font-lora-medium">
            Hlášení není potvrzené serverem
          </Text>
          <Text className="text-muted text-sm font-lora">
            {pendingLabel} Do synchronizace mohou být strážci upozorněni.
          </Text>
        </View>
        {onSync && (
          <TouchableOpacity
            onPress={onSync}
            disabled={isSyncing}
            className="ml-2 px-3 py-2 bg-charcoal rounded-xl"
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Synchronizovat čekající hlášení"
            accessibilityHint="Zkusí čekající hlášení odeslat serveru."
            accessibilityState={{ disabled: isSyncing, busy: isSyncing }}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Ionicons name="refresh" size={18} color={COLORS.white} />
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}
