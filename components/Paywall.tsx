import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePremiumStore } from '../stores/premium';
import { useEffect, useState, ComponentProps } from 'react';
import { PurchasesPackage } from 'react-native-purchases';

type IoniconsName = ComponentProps<typeof Ionicons>['name'];

const colors = {
  charcoal: '#2D2926',
  success: '#4ADE80',
} as const;

interface PaywallProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function Paywall({ visible, onClose, onSuccess }: PaywallProps) {
  const { packages, fetchPackages, purchasePackage, restorePurchases } = usePremiumStore();
  const [selectedPackage, setSelectedPackage] = useState<PurchasesPackage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && packages.length === 0) {
      fetchPackages();
    }
  }, [visible, packages.length, fetchPackages]);

  useEffect(() => {
    // Default select annual package
    const annual = packages.find(p => p.packageType === 'ANNUAL');
    if (annual) setSelectedPackage(annual);
  }, [packages]);

  const handlePurchase = async () => {
    if (!selectedPackage) return;
    setIsLoading(true);
    setError(null);
    try {
      const success = await purchasePackage(selectedPackage);
      if (success) {
        onSuccess?.();
        onClose();
      }
    } catch (e) {
      setError('Nákup se nezdařil. Zkuste to prosím znovu.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestore = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const success = await restorePurchases();
      if (success) {
        onSuccess?.();
        onClose();
      } else {
        setError('Nebyl nalezen žádný předchozí nákup.');
      }
    } catch (e) {
      setError('Obnovení se nezdařilo. Zkuste to prosím znovu.');
    } finally {
      setIsLoading(false);
    }
  };

  const annualPkg = packages.find(p => p.packageType === 'ANNUAL');
  const monthlyPkg = packages.find(p => p.packageType === 'MONTHLY');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View className="flex-1 bg-cream p-6">
        {/* Close button */}
        <Pressable onPress={onClose} className="self-end p-2">
          <Ionicons name="close" size={28} color={colors.charcoal} />
        </Pressable>

        {/* Header */}
        <View className="items-center mt-4 mb-8">
          <Text className="text-5xl mb-4">⭐</Text>
          <Text className="text-2xl font-bold text-charcoal">
            Hlásím se Premium
          </Text>
        </View>

        {/* Benefits */}
        <View className="bg-white rounded-3xl p-6 mb-6">
          <BenefitRow icon="timer-outline" text="Nastavitelný interval (1h až 7 dní)" />
          <BenefitRow icon="people-outline" text="Až 5 strážců" />
          <BenefitRow icon="eye-off-outline" text="Bez reklam" />
        </View>

        {/* Package options */}
        <View className="gap-3 mb-6">
          {annualPkg && (
            <PackageOption
              title="500 Kč / rok"
              subtitle="(2 měsíce zdarma)"
              selected={selectedPackage?.identifier === annualPkg.identifier}
              recommended
              onSelect={() => setSelectedPackage(annualPkg)}
            />
          )}
          {monthlyPkg && (
            <PackageOption
              title="50 Kč / měsíc"
              selected={selectedPackage?.identifier === monthlyPkg.identifier}
              onSelect={() => setSelectedPackage(monthlyPkg)}
            />
          )}
        </View>

        {/* Error message */}
        {error && (
          <View className="bg-red-100 rounded-xl p-3 mb-4">
            <Text className="text-red-600 text-center text-sm">{error}</Text>
          </View>
        )}

        {/* CTA */}
        <Pressable
          onPress={handlePurchase}
          disabled={isLoading || !selectedPackage}
          className="bg-coral rounded-full py-4 items-center mb-4"
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-lg">
              Vyzkoušet 14 dní zdarma
            </Text>
          )}
        </Pressable>

        {/* Restore */}
        <Pressable onPress={handleRestore} disabled={isLoading} className="items-center py-2">
          <Text className="text-muted">Obnovit nákup</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function BenefitRow({ icon, text }: { icon: IoniconsName; text: string }) {
  return (
    <View className="flex-row items-center mb-3">
      <Ionicons name={icon} size={22} color={colors.success} />
      <Text className="ml-3 text-charcoal">{text}</Text>
    </View>
  );
}

function PackageOption({
  title,
  subtitle,
  selected,
  recommended,
  onSelect
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  recommended?: boolean;
  onSelect: () => void;
}) {
  return (
    <Pressable
      onPress={onSelect}
      className={`border-2 rounded-3xl p-4 ${
        selected ? 'border-coral bg-coral/10' : 'border-muted/30 bg-white'
      }`}
    >
      <View className="flex-row items-center justify-between">
        <View>
          <View className="flex-row items-center">
            <Text className="text-charcoal font-semibold text-lg">{title}</Text>
            {recommended && (
              <View className="ml-2 bg-coral px-2 py-0.5 rounded-full">
                <Text className="text-white text-xs font-medium">Doporučeno</Text>
              </View>
            )}
          </View>
          {subtitle && <Text className="text-muted text-sm">{subtitle}</Text>}
        </View>
        <View className={`w-6 h-6 rounded-full border-2 items-center justify-center ${
          selected ? 'border-coral bg-coral' : 'border-muted/50'
        }`}>
          {selected && <Ionicons name="checkmark" size={16} color="white" />}
        </View>
      </View>
    </Pressable>
  );
}
