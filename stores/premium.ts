import { create } from 'zustand';

// RevenueCat temporarily disabled - all features are free
// TODO: Re-enable RevenueCat when implementing subscriptions

interface PremiumState {
  isPremium: boolean;
  isLoading: boolean;
  initError: string | null;
  packages: never[];
  customerInfo: null;

  initialize: () => Promise<void>;
  checkPremiumStatus: () => Promise<void>;
  fetchPackages: () => Promise<void>;
  purchasePackage: (pkg: unknown) => Promise<boolean>;
  restorePurchases: () => Promise<boolean>;
}

export const usePremiumStore = create<PremiumState>((set) => ({
  // All features are free for now
  isPremium: true,
  isLoading: false,
  initError: null,
  packages: [],
  customerInfo: null,

  initialize: async () => {
    // No-op: RevenueCat disabled
    set({ isLoading: false });
  },

  checkPremiumStatus: async () => {
    // No-op: Always premium
  },

  fetchPackages: async () => {
    // No-op: No packages to fetch
  },

  purchasePackage: async () => {
    // No-op: Purchases disabled
    return true;
  },

  restorePurchases: async () => {
    // No-op: Already premium
    return true;
  },
}));
