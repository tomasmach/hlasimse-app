import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "hasSeenOnboarding";
const PERSONA_KEY = "onboardingPersona";

export type Persona = "alone" | "caregiver" | "traveler";

interface OnboardingState {
  hasSeenOnboarding: boolean | null;
  isLoading: boolean;
  selectedPersona: Persona | null;
  checkOnboardingStatus: () => Promise<void>;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
  setPersona: (persona: Persona) => Promise<void>;
  loadPersona: () => Promise<void>;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  hasSeenOnboarding: null,
  isLoading: true,
  selectedPersona: null,
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
      await AsyncStorage.removeItem(PERSONA_KEY);
      set({ hasSeenOnboarding: false, isLoading: false, selectedPersona: null });
    } catch (error) {
      console.error("Error resetting onboarding:", error);
    }
  },
  setPersona: async (persona: Persona) => {
    try {
      await AsyncStorage.setItem(PERSONA_KEY, persona);
      set({ selectedPersona: persona });
    } catch (error) {
      console.error("Error saving persona:", error);
    }
  },
  loadPersona: async () => {
    try {
      const value = await AsyncStorage.getItem(PERSONA_KEY);
      if (value) {
        set({ selectedPersona: value as Persona });
      }
    } catch (error) {
      console.error("Error loading persona:", error);
    }
  },
}));
