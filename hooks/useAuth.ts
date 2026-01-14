import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";
import { useCheckInStore } from "@/stores/checkin";

export function useAuth() {
  const { session, user, isLoading, setSession, setUser, setIsLoading } =
    useAuthStore();
  const { clearProfile } = useCheckInStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);

      // Clear profile on logout
      if (!session) {
        clearProfile();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return { session, user, isLoading };
}
