import { create } from 'zustand';
import Purchases, { CustomerInfo, PurchasesPackage, PurchasesError } from 'react-native-purchases';
import { Platform } from 'react-native';

interface PremiumState {
  isPremium: boolean;
  isLoading: boolean;
  initError: string | null;
  packages: PurchasesPackage[];
  customerInfo: CustomerInfo | null;

  initialize: () => Promise<void>;
  checkPremiumStatus: () => Promise<void>;
  fetchPackages: () => Promise<void>;
  purchasePackage: (pkg: PurchasesPackage) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
}

// API keys will be configured later - use placeholders for now
const REVENUECAT_API_KEY_IOS = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY || 'ios_placeholder';
const REVENUECAT_API_KEY_ANDROID = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY || 'android_placeholder';
const PREMIUM_ENTITLEMENT_ID = 'premium';

export const usePremiumStore = create<PremiumState>((set, get) => ({
  isPremium: false,
  isLoading: true,
  initError: null,
  packages: [],
  customerInfo: null,

  initialize: async () => {
    try {
      set({ initError: null });
      const apiKey = Platform.OS === 'ios'
        ? REVENUECAT_API_KEY_IOS
        : REVENUECAT_API_KEY_ANDROID;

      await Purchases.configure({ apiKey });
      await get().checkPremiumStatus();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('Failed to initialize RevenueCat:', error);
      set({ initError: errorMessage });
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
    } catch (error) {
      // Safe type guard: check if error is an object with userCancelled property
      const isUserCancelled = typeof error === 'object' &&
                              error !== null &&
                              'userCancelled' in error &&
                              (error as PurchasesError).userCancelled === true;

      // Only log errors that aren't user cancellations
      if (!isUserCancelled) {
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
