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
            Čeká na připojení — strážci zatím spoléhají na původní termín
          </Text>
          <Text className="text-muted text-sm font-lora">
            {pendingCount > 0 ? `${pendingLabel} Původní serverový termín se nezměnil.` : `${failedItems.length} hlášení server odmítl. Původní termín se nezměnil.`}
          </Text>
        </View>
        {onSync && pendingCount > 0 && (
          <TouchableOpacity
            testID="offline-queue-sync"
            onPress={onSync}
            disabled={isSyncing}
            className="ml-2 w-11 h-11 bg-charcoal rounded-xl items-center justify-center"
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
          <Text className="text-error text-sm font-body">{item.error || "Server hlášení odmítl."}</Text>
          <Text className="text-muted text-xs font-body mt-1">Vytvořeno v zařízení {new Date(item.clientRecordedAt).toLocaleString("cs-CZ")}. Není započítáno v historii ani statistikách.</Text>
          <View className="flex-row gap-3 mt-2">
            {onRetry && (
              <TouchableOpacity testID={`offline-queue-retry-${item.id}`} onPress={() => onRetry(item.id)} accessibilityRole="button" className="min-h-[44px] px-3 rounded-xl bg-charcoal items-center justify-center">
                <Text className="text-white font-lora-medium">Zkusit znovu</Text>
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                testID={`offline-queue-delete-${item.id}`}
                onPress={() => Alert.alert("Smazat odmítnuté hlášení?", "Hlášení nebylo potvrzené serverem a jeho smazání nelze vrátit.", [
                  { text: "Zrušit", style: "cancel" },
                  { text: "Smazat", style: "destructive", onPress: () => onDelete(item.id) },
                ])}
                accessibilityRole="button"
                className="min-h-[44px] px-3 items-center justify-center"
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
