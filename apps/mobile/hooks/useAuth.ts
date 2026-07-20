import { useEffect } from "react";
import { clearLocalSession, logout, restoreUser } from "@/lib/auth";
import { setUnauthorizedHandler } from "@/lib/api";
import { cancelAllReminders } from "@/lib/reminderNotifications";
import { useAuthStore } from "@/stores/auth";
import { useCheckInStore } from "@/stores/checkin";
import { useGuardiansStore } from "@/stores/guardians";
import { useProductStore } from "@/stores/product";

async function clearRuntimeState(purgeQueue: boolean): Promise<void> {
  await clearLocalSession({ purgeQueue });
  await cancelAllReminders();
  useCheckInStore.getState().clearProfile();
  useGuardiansStore.getState().reset();
  useProductStore.getState().reset();
  useAuthStore.getState().setUser(null);
}

export function useAuth() {
  const { user, isLoading, initialized, setUser, setIsLoading, setInitialized } = useAuthStore();

  const signOut = async () => {
    await logout();
    await cancelAllReminders();
    useCheckInStore.getState().clearProfile();
    useGuardiansStore.getState().reset();
    useProductStore.getState().reset();
    setUser(null);
  };

  const finishAccountDeletion = async () => {
    await clearRuntimeState(true);
  };

  useEffect(() => {
    setUnauthorizedHandler(() => clearRuntimeState(true));
    if (!initialized) {
      restoreUser()
        .then(setUser)
        .finally(() => {
          setIsLoading(false);
          setInitialized(true);
        });
    }
  }, [initialized, setInitialized, setIsLoading, setUser]);

  return { session: user ? { user } : null, user, isLoading, signOut, finishAccountDeletion };
}
