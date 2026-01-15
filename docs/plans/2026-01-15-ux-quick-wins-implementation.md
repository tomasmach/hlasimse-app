# UX Quick Wins Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement UX improvements for seniors, guardians, and settings before app store launch.

**Architecture:** Component-based changes across check-in screen (success overlay, offline messages), guardians screen (card improvements, empty states), and new settings screens (profile editing, interval picker, paywall). Premium state managed via RevenueCat with local caching in Zustand.

**Tech Stack:** React Native, Expo, NativeWind, Zustand, RevenueCat, Supabase

---

## Phase 1: Seniors UX (Check-in Screen)

### Task 1: Create Success Overlay Component

**Files:**
- Create: `components/SuccessOverlay.tsx`

**Step 1: Create the component**

```tsx
import { useEffect } from 'react';
import { View, Text, Pressable, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SuccessOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  intervalHours?: number;
}

export function SuccessOverlay({ visible, onDismiss, intervalHours = 24 }: SuccessOverlayProps) {
  const scale = new Animated.Value(0);
  const opacity = new Animated.Value(0);

  useEffect(() => {
    if (visible) {
      // Animate in
      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      // Auto-dismiss after 3 seconds
      const timer = setTimeout(() => {
        handleDismiss();
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleDismiss = () => {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      onDismiss();
    });
  };

  if (!visible) return null;

  const intervalText = intervalHours >= 24
    ? `${intervalHours / 24} ${intervalHours === 24 ? 'den' : 'dny'}`
    : `${intervalHours} hodin`;

  return (
    <Pressable
      onPress={handleDismiss}
      className="absolute inset-0 z-50"
    >
      <Animated.View
        className="flex-1 bg-white items-center justify-center"
        style={{ opacity }}
      >
        <Animated.View style={{ transform: [{ scale }] }}>
          <View className="w-24 h-24 rounded-full bg-green-100 items-center justify-center mb-6">
            <Ionicons name="checkmark" size={48} color="#4ADE80" />
          </View>
        </Animated.View>

        <Text className="text-3xl font-bold text-charcoal mb-2">
          Vše v pořádku!
        </Text>

        <Text className="text-lg text-muted text-center">
          Další hlášení za{'\n'}
          <Text className="font-semibold text-charcoal">{intervalText}</Text>
        </Text>
      </Animated.View>
    </Pressable>
  );
}
```

**Step 2: Commit**

```bash
git add components/SuccessOverlay.tsx
git commit -m "feat: add SuccessOverlay component"
```

---

### Task 2: Integrate Success Overlay into Check-in Screen

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Step 1: Import and add state**

At the top of the file, add import:
```tsx
import { SuccessOverlay } from '../../components/SuccessOverlay';
```

Add state for overlay visibility (near other useState calls):
```tsx
const [showSuccessOverlay, setShowSuccessOverlay] = useState(false);
```

**Step 2: Modify handleCheckIn to show overlay**

Find the success handling in `handleCheckIn` function. After successful check-in, instead of (or in addition to) the toast, set:
```tsx
setShowSuccessOverlay(true);
```

Remove or comment out the success toast if it feels redundant.

**Step 3: Add SuccessOverlay to render**

Before the closing `</SafeAreaView>` or at the end of the main View, add:
```tsx
<SuccessOverlay
  visible={showSuccessOverlay}
  onDismiss={() => setShowSuccessOverlay(false)}
  intervalHours={profile?.check_in_interval_hours || 24}
/>
```

**Step 4: Test manually**

- Run `npm start`
- Open app on simulator
- Tap check-in button
- Verify full-screen success overlay appears
- Verify it auto-dismisses after 3 seconds
- Verify tap dismisses early

**Step 5: Commit**

```bash
git add app/(tabs)/index.tsx
git commit -m "feat: integrate success overlay into check-in screen"
```

---

### Task 3: Simplify Offline Messages

**Files:**
- Modify: `components/OfflineBanner.tsx`
- Modify: `app/(tabs)/index.tsx` (toast messages)

**Step 1: Update OfflineBanner**

Replace the current content with simplified messaging:

```tsx
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface OfflineBannerProps {
  pendingCount: number;
}

export function OfflineBanner({ pendingCount }: OfflineBannerProps) {
  if (pendingCount === 0) return null;

  return (
    <View className="bg-sand rounded-2xl p-4 mx-4 mb-4">
      <View className="flex-row items-center">
        <Ionicons name="cellular-outline" size={20} color="#8B7F7A" />
        <View className="ml-3 flex-1">
          <Text className="text-charcoal font-medium">
            Čekáme na připojení...
          </Text>
          <Text className="text-muted text-sm">
            Vaše hlášení je v bezpečí.
          </Text>
        </View>
      </View>
    </View>
  );
}
```

Note: Removed the manual "Odeslat" button - auto-sync handles it.

**Step 2: Update offline toast in index.tsx**

Find the toast shown when saving offline. Change the message to:
```tsx
"Máme to! Pošleme hned, až bude signál."
```

Find error toast for sync failure. Change to:
```tsx
"Nepodařilo se odeslat. Zkuste to znovu."
```

**Step 3: Test manually**

- Enable airplane mode
- Tap check-in
- Verify new toast message appears
- Verify banner shows simplified text
- Disable airplane mode, verify auto-sync

**Step 4: Commit**

```bash
git add components/OfflineBanner.tsx app/(tabs)/index.tsx
git commit -m "feat: simplify offline messages for seniors"
```

---

## Phase 2: Guardian Experience

### Task 4: Update WatchedProfileCard with Colors and Last Check-in

**Files:**
- Modify: `components/WatchedProfileCard.tsx`

**Step 1: Update the component**

Replace/update the component to include:
- Color-coded borders (green/orange/rose)
- "Naposledy: [time]" display
- Better status text

```tsx
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import { cs } from 'date-fns/locale';

interface WatchedProfileCardProps {
  profile: {
    id: string;
    name: string;
    next_check_in_deadline: string;
    last_check_in_at: string | null;
  };
  onViewLocation?: () => void;
}

export function WatchedProfileCard({ profile, onViewLocation }: WatchedProfileCardProps) {
  const deadline = new Date(profile.next_check_in_deadline);
  const now = new Date();
  const timeRemaining = deadline.getTime() - now.getTime();
  const hoursRemaining = timeRemaining / (1000 * 60 * 60);

  const isOverdue = timeRemaining < 0;
  const isApproaching = !isOverdue && hoursRemaining < 1;
  const isOk = !isOverdue && !isApproaching;

  // Border and status colors
  const borderColor = isOverdue
    ? 'border-accent'
    : isApproaching
      ? 'border-brand-500'
      : 'border-green-400';

  const statusIcon = isOverdue ? 'warning' : isApproaching ? 'time' : 'checkmark-circle';
  const statusColor = isOverdue ? '#f43f5e' : isApproaching ? '#f97316' : '#4ADE80';
  const statusText = isOverdue
    ? 'Neohlásil/a se!'
    : isApproaching
      ? 'Blíží se termín'
      : 'V pořádku';

  // Format last check-in time
  const lastCheckInText = profile.last_check_in_at
    ? formatDistanceToNow(new Date(profile.last_check_in_at), {
        addSuffix: true,
        locale: cs
      })
    : 'Zatím se neohlásil/a';

  // Format countdown/overdue
  const formatTime = (ms: number) => {
    const absMs = Math.abs(ms);
    const hours = Math.floor(absMs / (1000 * 60 * 60));
    const minutes = Math.floor((absMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((absMs % (1000 * 60)) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <View className={`bg-white rounded-2xl p-4 border-2 ${borderColor}`}>
      {/* Header */}
      <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 rounded-full bg-brand-100 items-center justify-center">
          <Text className="text-brand-500 font-bold">
            {profile.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text className="ml-3 text-lg font-semibold text-charcoal flex-1">
          {profile.name}
        </Text>
      </View>

      {/* Status */}
      <View className="flex-row items-center mb-2">
        <Ionicons name={statusIcon} size={18} color={statusColor} />
        <Text className="ml-2 font-medium" style={{ color: statusColor }}>
          {statusText}
        </Text>
      </View>

      {/* Last check-in */}
      <Text className="text-muted text-sm mb-1">
        Naposledy: {lastCheckInText}
      </Text>

      {/* Countdown or overdue */}
      <Text className={`text-sm ${isOverdue ? 'text-accent' : 'text-charcoal'}`}>
        {isOverdue ? 'Po termínu: ' : 'Zbývá: '}
        <Text className="font-mono font-semibold">
          {formatTime(timeRemaining)}
        </Text>
      </Text>

      {/* Location button (only when overdue) */}
      {isOverdue && onViewLocation && (
        <Pressable
          onPress={onViewLocation}
          className="mt-3 flex-row items-center justify-center bg-brand-50 rounded-xl py-2"
        >
          <Ionicons name="location" size={18} color="#f97316" />
          <Text className="ml-2 text-brand-500 font-medium">
            Zobrazit polohu
          </Text>
        </Pressable>
      )}
    </View>
  );
}
```

**Step 2: Install date-fns if not present**

```bash
npm install date-fns
```

**Step 3: Test manually**

- Open guardians tab
- View watched profiles
- Verify color borders match status
- Verify "Naposledy:" shows

**Step 4: Commit**

```bash
git add components/WatchedProfileCard.tsx package.json package-lock.json
git commit -m "feat: add color borders and last check-in to watched cards"
```

---

### Task 5: Add Empty States to Guardians Screen

**Files:**
- Modify: `app/(tabs)/guardians.tsx`
- Create: `components/EmptyState.tsx`

**Step 1: Create reusable EmptyState component**

```tsx
import { View, Text, Pressable } from 'react-native';

interface EmptyStateProps {
  emoji: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ emoji, title, description, actionLabel, onAction }: EmptyStateProps) {
  return (
    <View className="items-center py-8 px-4">
      <Text className="text-5xl mb-4">{emoji}</Text>
      <Text className="text-lg font-semibold text-charcoal mb-2 text-center">
        {title}
      </Text>
      <Text className="text-muted text-center mb-4">
        {description}
      </Text>
      {actionLabel && onAction && (
        <Pressable
          onPress={onAction}
          className="bg-brand-500 px-6 py-3 rounded-full"
        >
          <Text className="text-white font-semibold">{actionLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
```

**Step 2: Commit EmptyState**

```bash
git add components/EmptyState.tsx
git commit -m "feat: add EmptyState component"
```

**Step 3: Update guardians.tsx**

Import the component:
```tsx
import { EmptyState } from '../../components/EmptyState';
```

For "Moji strážci" section when empty:
```tsx
{guardians.length === 0 ? (
  <EmptyState
    emoji="👀"
    title="Zatím nemáte žádné strážce"
    description="Strážce dostane upozornění, když se neohlásíte včas."
    actionLabel="+ Přidat strážce"
    onAction={() => setShowAddModal(true)}
  />
) : (
  // existing guardian cards map
)}
```

For "Hlídám" section when empty:
```tsx
{watchedProfiles.length === 0 ? (
  <EmptyState
    emoji="🛡️"
    title="Nikoho nehlídáte"
    description="Až vás někdo pozve jako strážce, uvidíte ho zde."
  />
) : (
  // existing watched profile cards map
)}
```

For "Čekající pozvánky" - don't render section at all when empty:
```tsx
{pendingInvites.length > 0 && (
  <View>
    <Text className="text-lg font-semibold mb-3">Čekající pozvánky</Text>
    {/* invite cards */}
  </View>
)}
```

**Step 4: Test manually**

- Clear guardians/invites (or use fresh account)
- Verify empty states show with correct emoji/text
- Verify CTA button works for "Moji strážci"
- Verify pending invites section hidden when empty

**Step 5: Commit**

```bash
git add app/(tabs)/guardians.tsx
git commit -m "feat: add empty states to guardians screen"
```

---

## Phase 3: Settings & Premium

### Task 6: Create Premium Store with RevenueCat

**Files:**
- Create: `stores/premium.ts`
- Modify: `app/_layout.tsx` (initialize RevenueCat)

**Step 1: Install RevenueCat**

```bash
npx expo install react-native-purchases
```

**Step 2: Create premium store**

```tsx
import { create } from 'zustand';
import Purchases, { CustomerInfo, PurchasesPackage } from 'react-native-purchases';
import { Platform } from 'react-native';

interface PremiumState {
  isPremium: boolean;
  isLoading: boolean;
  packages: PurchasesPackage[];
  customerInfo: CustomerInfo | null;

  initialize: () => Promise<void>;
  checkPremiumStatus: () => Promise<void>;
  fetchPackages: () => Promise<void>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
}

const REVENUECAT_API_KEY_IOS = 'your_ios_api_key'; // TODO: Add from env
const REVENUECAT_API_KEY_ANDROID = 'your_android_api_key'; // TODO: Add from env
const PREMIUM_ENTITLEMENT_ID = 'premium';

export const usePremiumStore = create<PremiumState>((set, get) => ({
  isPremium: false,
  isLoading: true,
  packages: [],
  customerInfo: null,

  initialize: async () => {
    try {
      const apiKey = Platform.OS === 'ios'
        ? REVENUECAT_API_KEY_IOS
        : REVENUECAT_API_KEY_ANDROID;

      await Purchases.configure({ apiKey });
      await get().checkPremiumStatus();
    } catch (error) {
      console.error('Failed to initialize RevenueCat:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  checkPremiumStatus: async () => {
    try {
      const customerInfo = await Purchases.getCustomerInfo();
      const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
      set({ isPremium, customerInfo });
    } catch (error) {
      console.error('Failed to check premium status:', error);
    }
  },

  fetchPackages: async () => {
    try {
      const offerings = await Purchases.getOfferings();
      if (offerings.current?.availablePackages) {
        set({ packages: offerings.current.availablePackages });
      }
    } catch (error) {
      console.error('Failed to fetch packages:', error);
    }
  },

  purchasePackage: async (pkg: PurchasesPackage) => {
    try {
      const { customerInfo } = await Purchases.purchasePackage(pkg);
      const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
      set({ isPremium, customerInfo });
      return isPremium;
    } catch (error: any) {
      if (!error.userCancelled) {
        console.error('Purchase failed:', error);
      }
      return false;
    }
  },

  restorePurchases: async () => {
    try {
      const customerInfo = await Purchases.restorePurchases();
      const isPremium = customerInfo.entitlements.active[PREMIUM_ENTITLEMENT_ID] !== undefined;
      set({ isPremium, customerInfo });
      return isPremium;
    } catch (error) {
      console.error('Restore failed:', error);
      return false;
    }
  },
}));
```

**Step 3: Initialize in _layout.tsx**

Add to the root layout's useEffect (after auth initialization):
```tsx
import { usePremiumStore } from '../stores/premium';

// Inside component:
const initializePremium = usePremiumStore((state) => state.initialize);

useEffect(() => {
  initializePremium();
}, []);
```

**Step 4: Commit**

```bash
git add stores/premium.ts app/_layout.tsx package.json package-lock.json
git commit -m "feat: add RevenueCat premium store"
```

---

### Task 7: Create Paywall Component

**Files:**
- Create: `components/Paywall.tsx`

**Step 1: Create the component**

```tsx
import { View, Text, Pressable, Modal, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePremiumStore } from '../stores/premium';
import { useEffect, useState } from 'react';
import { PurchasesPackage } from 'react-native-purchases';

interface PaywallProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function Paywall({ visible, onClose, onSuccess }: PaywallProps) {
  const { packages, fetchPackages, purchasePackage, restorePurchases } = usePremiumStore();
  const [selectedPackage, setSelectedPackage] = useState<PurchasesPackage | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (visible && packages.length === 0) {
      fetchPackages();
    }
  }, [visible]);

  useEffect(() => {
    // Default select annual package
    const annual = packages.find(p => p.packageType === 'ANNUAL');
    if (annual) setSelectedPackage(annual);
  }, [packages]);

  const handlePurchase = async () => {
    if (!selectedPackage) return;
    setIsLoading(true);
    const success = await purchasePackage(selectedPackage);
    setIsLoading(false);
    if (success) {
      onSuccess?.();
      onClose();
    }
  };

  const handleRestore = async () => {
    setIsLoading(true);
    const success = await restorePurchases();
    setIsLoading(false);
    if (success) {
      onSuccess?.();
      onClose();
    }
  };

  const annualPkg = packages.find(p => p.packageType === 'ANNUAL');
  const monthlyPkg = packages.find(p => p.packageType === 'MONTHLY');

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View className="flex-1 bg-cream p-6">
        {/* Close button */}
        <Pressable onPress={onClose} className="self-end p-2">
          <Ionicons name="close" size={28} color="#2D2926" />
        </Pressable>

        {/* Header */}
        <View className="items-center mt-4 mb-8">
          <Text className="text-5xl mb-4">⭐</Text>
          <Text className="text-2xl font-bold text-charcoal">
            Hlásím se Premium
          </Text>
        </View>

        {/* Benefits */}
        <View className="bg-white rounded-2xl p-6 mb-6">
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

        {/* CTA */}
        <Pressable
          onPress={handlePurchase}
          disabled={isLoading || !selectedPackage}
          className="bg-brand-500 rounded-full py-4 items-center mb-4"
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
        <Pressable onPress={handleRestore} className="items-center py-2">
          <Text className="text-muted">Obnovit nákup</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

function BenefitRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View className="flex-row items-center mb-3">
      <Ionicons name={icon as any} size={22} color="#4ADE80" />
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
      className={`border-2 rounded-2xl p-4 ${
        selected ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white'
      }`}
    >
      <View className="flex-row items-center justify-between">
        <View>
          <View className="flex-row items-center">
            <Text className="text-charcoal font-semibold text-lg">{title}</Text>
            {recommended && (
              <View className="ml-2 bg-brand-500 px-2 py-0.5 rounded-full">
                <Text className="text-white text-xs font-medium">Doporučeno</Text>
              </View>
            )}
          </View>
          {subtitle && <Text className="text-muted text-sm">{subtitle}</Text>}
        </View>
        <View className={`w-6 h-6 rounded-full border-2 items-center justify-center ${
          selected ? 'border-brand-500 bg-brand-500' : 'border-gray-300'
        }`}>
          {selected && <Ionicons name="checkmark" size={16} color="white" />}
        </View>
      </View>
    </Pressable>
  );
}
```

**Step 2: Commit**

```bash
git add components/Paywall.tsx
git commit -m "feat: add Paywall component"
```

---

### Task 8: Redesign Settings Screen

**Files:**
- Modify: `app/(tabs)/settings.tsx`

**Step 1: Rewrite settings screen**

```tsx
import { View, Text, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/auth';
import { useCheckInStore } from '../../stores/checkin';
import { usePremiumStore } from '../../stores/premium';
import { useState } from 'react';
import { Paywall } from '../../components/Paywall';

export default function SettingsScreen() {
  const { user, signOut } = useAuthStore();
  const { profile } = useCheckInStore();
  const { isPremium } = usePremiumStore();
  const [showPaywall, setShowPaywall] = useState(false);

  const handleLogout = () => {
    Alert.alert(
      'Odhlásit se',
      'Opravdu se chcete odhlásit?',
      [
        { text: 'Zrušit', style: 'cancel' },
        { text: 'Odhlásit', style: 'destructive', onPress: signOut },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Smazat účet',
      'Opravdu chcete smazat účet? Všechna data budou nenávratně odstraněna.',
      [
        { text: 'Zrušit', style: 'cancel' },
        {
          text: 'Smazat',
          style: 'destructive',
          onPress: () => router.push('/delete-account')
        },
      ]
    );
  };

  const handleIntervalPress = () => {
    if (isPremium) {
      router.push('/interval-picker');
    } else {
      setShowPaywall(true);
    }
  };

  const intervalText = profile?.check_in_interval_hours
    ? `${profile.check_in_interval_hours} hodin`
    : '24 hodin';

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView className="flex-1 px-4">
        <Text className="text-2xl font-bold text-charcoal mt-4 mb-6">
          ⚙️ Nastavení
        </Text>

        {/* PROFIL */}
        <Text className="text-sm font-semibold text-muted mb-2 ml-2">PROFIL</Text>
        <View className="bg-white rounded-2xl mb-6 overflow-hidden">
          <SettingsRow
            icon="person-outline"
            label="Jméno"
            value={profile?.name || user?.user_metadata?.name || 'Nastavit'}
            onPress={() => router.push('/edit-name')}
          />
          <Divider />
          <SettingsRow
            icon="timer-outline"
            label="Interval hlášení"
            value={intervalText}
            onPress={handleIntervalPress}
            showLock={!isPremium}
          />
        </View>

        {/* PŘEDPLATNÉ */}
        <Text className="text-sm font-semibold text-muted mb-2 ml-2">PŘEDPLATNÉ</Text>
        <View className="bg-white rounded-2xl mb-6 p-4">
          <View className="flex-row items-center">
            <Text className="text-2xl mr-3">⭐</Text>
            <View className="flex-1">
              <Text className="text-charcoal font-semibold">
                Hlásím se {isPremium ? 'Premium' : 'Free'}
              </Text>
              {isPremium && (
                <Text className="text-muted text-sm">Aktivní předplatné</Text>
              )}
            </View>
            <Pressable
              onPress={() => setShowPaywall(true)}
              className={`px-4 py-2 rounded-full ${
                isPremium ? 'bg-gray-100' : 'bg-brand-500'
              }`}
            >
              <Text className={isPremium ? 'text-charcoal' : 'text-white'}>
                {isPremium ? 'Spravovat' : 'Upgradovat'}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* ÚČET */}
        <Text className="text-sm font-semibold text-muted mb-2 ml-2">ÚČET</Text>
        <View className="bg-white rounded-2xl mb-6 overflow-hidden">
          <View className="p-4 flex-row items-center">
            <Ionicons name="mail-outline" size={22} color="#8B7F7A" />
            <Text className="ml-3 text-charcoal">{user?.email}</Text>
          </View>
          <Divider />
          <Pressable onPress={handleLogout} className="p-4 flex-row items-center">
            <Ionicons name="log-out-outline" size={22} color="#8B7F7A" />
            <Text className="ml-3 text-charcoal">Odhlásit se</Text>
          </Pressable>
          <Divider />
          <Pressable onPress={handleDeleteAccount} className="p-4 flex-row items-center">
            <Ionicons name="trash-outline" size={22} color="#f43f5e" />
            <Text className="ml-3 text-accent">Smazat účet</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Paywall
        visible={showPaywall}
        onClose={() => setShowPaywall(false)}
      />
    </SafeAreaView>
  );
}

function SettingsRow({
  icon,
  label,
  value,
  onPress,
  showLock
}: {
  icon: string;
  label: string;
  value: string;
  onPress: () => void;
  showLock?: boolean;
}) {
  return (
    <Pressable onPress={onPress} className="p-4 flex-row items-center">
      <Ionicons name={icon as any} size={22} color="#8B7F7A" />
      <Text className="ml-3 text-charcoal flex-1">{label}</Text>
      <Text className="text-muted mr-2">{value}</Text>
      {showLock && <Ionicons name="lock-closed" size={16} color="#8B7F7A" />}
      <Ionicons name="chevron-forward" size={20} color="#8B7F7A" />
    </Pressable>
  );
}

function Divider() {
  return <View className="h-px bg-gray-100 ml-12" />;
}
```

**Step 2: Commit**

```bash
git add app/(tabs)/settings.tsx
git commit -m "feat: redesign settings screen with profile and premium sections"
```

---

### Task 9: Create Edit Name Screen

**Files:**
- Create: `app/(tabs)/edit-name.tsx`

**Step 1: Create the screen**

```tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useCheckInStore } from '../../stores/checkin';
import { supabase } from '../../lib/supabase';

export default function EditNameScreen() {
  const { profile, fetchProfile } = useCheckInStore();
  const [name, setName] = useState(profile?.name || '');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Jméno je povinné');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const { error: updateError } = await supabase
        .from('check_in_profiles')
        .update({ name: name.trim() })
        .eq('id', profile?.id);

      if (updateError) throw updateError;

      await fetchProfile();
      router.back();
    } catch (err: any) {
      setError(err.message || 'Nepodařilo se uložit');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-row items-center justify-between px-4 py-2">
        <Pressable onPress={() => router.back()} className="p-2">
          <Text className="text-brand-500 text-lg">← Zpět</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={isLoading}
          className="p-2"
        >
          {isLoading ? (
            <ActivityIndicator color="#f97316" />
          ) : (
            <Text className="text-brand-500 text-lg font-semibold">Uložit</Text>
          )}
        </Pressable>
      </View>

      <View className="px-6 pt-6">
        <Text className="text-lg font-semibold text-charcoal mb-2">
          Vaše jméno
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Zadejte jméno"
          className="bg-white rounded-2xl px-4 py-4 text-charcoal text-lg border border-gray-200"
          autoFocus
        />
        {error && (
          <Text className="text-accent mt-2">{error}</Text>
        )}
        <Text className="text-muted mt-4">
          Toto jméno uvidí vaši strážci.
        </Text>
      </View>
    </SafeAreaView>
  );
}
```

**Step 2: Commit**

```bash
git add app/(tabs)/edit-name.tsx
git commit -m "feat: add edit name screen"
```

---

### Task 10: Create Interval Picker Screen (Premium)

**Files:**
- Create: `app/(tabs)/interval-picker.tsx`

**Step 1: Create the screen**

```tsx
import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCheckInStore } from '../../stores/checkin';
import { supabase } from '../../lib/supabase';

const INTERVAL_OPTIONS = [
  { hours: 12, label: '12 hodin' },
  { hours: 24, label: '24 hodin' },
  { hours: 48, label: '48 hodin' },
  { hours: 168, label: '7 dní' },
];

export default function IntervalPickerScreen() {
  const { profile, fetchProfile } = useCheckInStore();
  const [selectedHours, setSelectedHours] = useState(profile?.check_in_interval_hours || 24);
  const [isLoading, setIsLoading] = useState(false);

  const handleSelect = async (hours: number) => {
    if (hours === selectedHours) return;

    setIsLoading(true);
    try {
      const { error } = await supabase
        .from('check_in_profiles')
        .update({ check_in_interval_hours: hours })
        .eq('id', profile?.id);

      if (error) throw error;

      setSelectedHours(hours);
      await fetchProfile();
    } catch (err) {
      console.error('Failed to update interval:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-row items-center px-4 py-2">
        <Pressable onPress={() => router.back()} className="p-2">
          <Text className="text-brand-500 text-lg">← Zpět</Text>
        </Pressable>
      </View>

      <View className="px-6 pt-6">
        <Text className="text-xl font-bold text-charcoal mb-6">
          Jak často se chcete hlásit?
        </Text>

        <View className="gap-3">
          {INTERVAL_OPTIONS.map((option) => (
            <Pressable
              key={option.hours}
              onPress={() => handleSelect(option.hours)}
              disabled={isLoading}
              className={`bg-white rounded-2xl p-4 flex-row items-center border-2 ${
                selectedHours === option.hours
                  ? 'border-brand-500'
                  : 'border-transparent'
              }`}
            >
              <View className={`w-6 h-6 rounded-full border-2 items-center justify-center mr-4 ${
                selectedHours === option.hours
                  ? 'border-brand-500 bg-brand-500'
                  : 'border-gray-300'
              }`}>
                {selectedHours === option.hours && (
                  <Ionicons name="checkmark" size={16} color="white" />
                )}
              </View>
              <Text className="text-charcoal text-lg">{option.label}</Text>
              {isLoading && selectedHours === option.hours && (
                <ActivityIndicator className="ml-auto" color="#f97316" />
              )}
            </Pressable>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}
```

**Step 2: Commit**

```bash
git add app/(tabs)/interval-picker.tsx
git commit -m "feat: add interval picker screen for premium users"
```

---

### Task 11: Create Delete Account Screen

**Files:**
- Create: `app/(tabs)/delete-account.tsx`

**Step 1: Create the screen**

```tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../../stores/auth';
import { supabase } from '../../lib/supabase';

export default function DeleteAccountScreen() {
  const { user, signOut } = useAuthStore();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDelete = async () => {
    if (!password) {
      setError('Zadejte heslo pro potvrzení');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Re-authenticate with password
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user?.email || '',
        password,
      });

      if (authError) {
        setError('Nesprávné heslo');
        setIsLoading(false);
        return;
      }

      // Delete user data (cascade will handle related tables)
      // The actual user deletion should be done via Edge Function with service role
      const { error: deleteError } = await supabase.functions.invoke('delete-user', {
        body: { userId: user?.id },
      });

      if (deleteError) throw deleteError;

      // Sign out
      await signOut();

      Alert.alert('Účet smazán', 'Váš účet byl úspěšně smazán.');
      router.replace('/login');
    } catch (err: any) {
      setError(err.message || 'Nepodařilo se smazat účet');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-row items-center px-4 py-2">
        <Pressable onPress={() => router.back()} className="p-2">
          <Text className="text-brand-500 text-lg">← Zpět</Text>
        </Pressable>
      </View>

      <View className="px-6 pt-6">
        <Text className="text-5xl mb-4">⚠️</Text>
        <Text className="text-xl font-bold text-charcoal mb-2">
          Smazat účet
        </Text>
        <Text className="text-muted mb-6">
          Tato akce je nevratná. Všechna vaše data budou trvale odstraněna.
        </Text>

        <Text className="text-charcoal font-medium mb-2">
          Pro potvrzení zadejte heslo:
        </Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Heslo"
          secureTextEntry
          className="bg-white rounded-2xl px-4 py-4 text-charcoal border border-gray-200 mb-2"
        />
        {error && (
          <Text className="text-accent mb-4">{error}</Text>
        )}

        <Pressable
          onPress={handleDelete}
          disabled={isLoading}
          className="bg-accent rounded-full py-4 items-center mt-4"
        >
          {isLoading ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white font-semibold text-lg">
              Smazat účet trvale
            </Text>
          )}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
```

**Step 2: Create Edge Function for user deletion**

```bash
# Create the function directory
mkdir -p supabase/functions/delete-user
```

Create `supabase/functions/delete-user/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Get the user from the auth header
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');

    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { userId } = await req.json();

    // Verify the user is deleting their own account
    if (user.id !== userId) {
      throw new Error('Unauthorized');
    }

    // Delete user data (order matters due to foreign keys)
    await supabaseAdmin.from('push_tokens').delete().eq('user_id', userId);
    await supabaseAdmin.from('alerts').delete().eq('profile_id',
      supabaseAdmin.from('check_in_profiles').select('id').eq('owner_id', userId)
    );
    await supabaseAdmin.from('check_ins').delete().eq('profile_id',
      supabaseAdmin.from('check_in_profiles').select('id').eq('owner_id', userId)
    );
    await supabaseAdmin.from('guardian_invites').delete().or(`inviter_id.eq.${userId},invitee_id.eq.${userId}`);
    await supabaseAdmin.from('guardians').delete().eq('user_id', userId);
    await supabaseAdmin.from('check_in_profiles').delete().eq('owner_id', userId);
    await supabaseAdmin.from('users').delete().eq('id', userId);

    // Delete the auth user
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
```

**Step 3: Commit**

```bash
git add app/(tabs)/delete-account.tsx supabase/functions/delete-user/index.ts
git commit -m "feat: add delete account screen and edge function"
```

---

## Phase 4: Database Updates

### Task 12: Add check_in_interval_hours to profiles

**Files:**
- Create: `docs/migrations/add_interval_hours.sql`

**Step 1: Create migration**

```sql
-- Add check_in_interval_hours column to check_in_profiles
ALTER TABLE check_in_profiles
ADD COLUMN IF NOT EXISTS check_in_interval_hours integer DEFAULT 24;

-- Update existing rows
UPDATE check_in_profiles
SET check_in_interval_hours = 24
WHERE check_in_interval_hours IS NULL;

-- Add constraint
ALTER TABLE check_in_profiles
ADD CONSTRAINT check_in_interval_hours_valid
CHECK (check_in_interval_hours IN (12, 24, 48, 168));
```

**Step 2: Apply migration manually**

Run in Supabase SQL Editor.

**Step 3: Commit**

```bash
git add docs/migrations/add_interval_hours.sql
git commit -m "feat: add check_in_interval_hours migration"
```

---

### Task 13: Add last_check_in_at to profiles

**Files:**
- Create: `docs/migrations/add_last_check_in_at.sql`

**Step 1: Create migration**

```sql
-- Add last_check_in_at column to check_in_profiles
ALTER TABLE check_in_profiles
ADD COLUMN IF NOT EXISTS last_check_in_at timestamp with time zone;

-- Populate from existing check_ins
UPDATE check_in_profiles p
SET last_check_in_at = (
  SELECT MAX(created_at)
  FROM check_ins
  WHERE profile_id = p.id
);
```

**Step 2: Apply migration manually**

Run in Supabase SQL Editor.

**Step 3: Commit**

```bash
git add docs/migrations/add_last_check_in_at.sql
git commit -m "feat: add last_check_in_at migration"
```

---

## Final Checklist

After all tasks are complete:

1. [ ] Test full check-in flow with success overlay
2. [ ] Test offline mode with new messages
3. [ ] Test guardian cards with all three states (green/orange/rose)
4. [ ] Test empty states on fresh account
5. [ ] Test settings screen navigation
6. [ ] Test name editing
7. [ ] Test paywall appears for free users
8. [ ] Test interval picker for premium users
9. [ ] Test delete account flow
10. [ ] Deploy edge functions: `supabase functions deploy delete-user`
11. [ ] Apply database migrations
12. [ ] Configure RevenueCat API keys

---

## RevenueCat Setup Notes

1. Create RevenueCat account at https://www.revenuecat.com
2. Create new project "Hlásím se"
3. Add iOS and Android apps
4. Create entitlement "premium"
5. Create offerings with monthly (50 CZK) and annual (500 CZK) packages
6. Add API keys to environment/app config
7. Configure 14-day free trial on packages
