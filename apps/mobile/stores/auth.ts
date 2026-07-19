import { create } from "zustand";
import type { AuthUser } from "@/types/api";

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  initialized: boolean;
  setUser: (user: AuthUser | null) => void;
  setIsLoading: (isLoading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  initialized: false,
  setUser: (user) => set({ user }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setInitialized: (initialized) => set({ initialized }),
}));
