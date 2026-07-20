import { useEffect, useState } from "react";
import { router } from "expo-router";
import { useOnboardingStore } from "@/stores/onboarding";

export function useOnboardingPersona() {
  const selectedPersona = useOnboardingStore((state) => state.selectedPersona);
  const loadPersona = useOnboardingStore((state) => state.loadPersona);
  const [loading, setLoading] = useState(!selectedPersona);

  useEffect(() => {
    let active = true;
    if (selectedPersona) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    loadPersona().finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [loadPersona, selectedPersona]);

  useEffect(() => {
    if (!loading && !selectedPersona) router.replace("/(onboarding)");
  }, [loading, selectedPersona]);

  return { selectedPersona, loading };
}
