import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth";
import { useCheckInStore } from "@/stores/checkin";

export function useAuth() {
  const { session, user, isLoading, setSession, setUser, setIsLoading } =
    useAuthStore();
  const { clearProfile } = useCheckInStore();

  const signOut = async () => {
    try {
      // Get current user before signing out
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        // Remove all push tokens for this user
        await supabase.from("push_tokens").delete().eq("user_id", user.id);
      }

      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error("Error signing out:", error);
      throw error;
    }
  };

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

  return { session, user, isLoading, signOut };
}
