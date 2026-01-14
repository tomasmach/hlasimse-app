import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "hasSeenOnboarding";

interface OnboardingState {
  hasSeenOnboarding: boolean | null;
  isLoading: boolean;
  checkOnboardingStatus: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  hasSeenOnboarding: null,
  isLoading: true,
  checkOnboardingStatus: async () => {
    try {
      set({ isLoading: true });
      const value = await AsyncStorage.getItem(STORAGE_KEY);
      set({ hasSeenOnboarding: value === "true", isLoading: false });
    } catch (error) {
      console.error("Error checking onboarding status:", error);
      set({ hasSeenOnboarding: false, isLoading: false });
    }
  },
  completeOnboarding: async () => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, "true");
      set({ hasSeenOnboarding: true });
    } catch (error) {
      console.error("Error saving onboarding status:", error);
    }
  },
  resetOnboarding: async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY);
      set({ hasSeenOnboarding: false, isLoading: false });
    } catch (error) {
      console.error("Error resetting onboarding:", error);
    }
  },
}));
