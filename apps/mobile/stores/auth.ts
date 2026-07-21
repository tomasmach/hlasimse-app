import { create } from "zustand";
import type { AuthUser } from "@/types/api";

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  initialized: boolean;
  setUser: (user: AuthUser | null) => void;
  replaceUserIfCurrent: (user: AuthUser) => boolean;
  setIsLoading: (isLoading: boolean) => void;
  setInitialized: (initialized: boolean) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isLoading: true,
  initialized: false,
  setUser: (user) => set({ user }),
  replaceUserIfCurrent: (user) => {
    if (get().user?.id !== user.id) return false;
    set({ user });
    return true;
  },
  setIsLoading: (isLoading) => set({ isLoading }),
  setInitialized: (initialized) => set({ initialized }),
}));
