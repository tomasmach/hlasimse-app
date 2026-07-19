import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '@/constants/design';
import type { PendingCheckIn } from '@/lib/offlineQueue';

interface OfflineBannerProps {
  pendingCount: number;
  onSync?: () => void;
  isSyncing?: boolean;
  failedItems?: PendingCheckIn[];
  onRetry?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function OfflineBanner({ pendingCount, onSync, isSyncing = false, failedItems = [], onRetry, onDelete }: OfflineBannerProps) {
  if (pendingCount === 0 && failedItems.length === 0) return null;

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
            {pendingCount > 0 ? `${pendingLabel} Do synchronizace mohou být strážci upozorněni.` : `${failedItems.length} hlášení server odmítl.`}
          </Text>
        </View>
        {onSync && pendingCount > 0 && (
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
      {failedItems.map((item) => (
        <View key={item.id} className="mt-3 pt-3 border-t border-muted/20">
          <Text className="text-error text-sm font-lora">{item.error || "Server hlášení odmítl."}</Text>
          <View className="flex-row gap-3 mt-2">
            {onRetry && (
              <TouchableOpacity onPress={() => onRetry(item.id)} accessibilityRole="button" className="py-2 px-3 rounded-xl bg-charcoal">
                <Text className="text-white font-lora-medium">Zkusit znovu</Text>
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                onPress={() => Alert.alert("Smazat odmítnuté hlášení?", "Hlášení nebylo potvrzené serverem a jeho smazání nelze vrátit.", [
                  { text: "Zrušit", style: "cancel" },
                  { text: "Smazat", style: "destructive", onPress: () => onDelete(item.id) },
                ])}
                accessibilityRole="button"
                className="py-2 px-3"
              >
                <Text className="text-error font-lora-medium">Smazat</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}
