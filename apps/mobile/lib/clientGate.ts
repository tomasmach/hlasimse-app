import { Platform } from "react-native";
import { apiRequest } from "@/lib/api";
import {
  gateFromConfig,
  InvalidClientReleaseError,
  type ClientGate,
  type ClientReleaseConfig,
} from "@/lib/clientRelease";

export function supportsMobileReleaseGate(): boolean {
  return Platform.OS === "ios" || Platform.OS === "android";
}

export async function checkClientRelease(): Promise<ClientGate | null> {
  if (!supportsMobileReleaseGate()) return null;
  try {
    const config = await apiRequest<ClientReleaseConfig>("/api/v1/client-config/", {
      auth: false,
      timeoutMs: 10_000,
    });
    return gateFromConfig(config);
  } catch (error) {
    if (error instanceof InvalidClientReleaseError) {
      return {
        kind: "update",
        detail: (
          "Verzi této instalace nelze bezpečně ověřit. " +
          "Nainstalujte prosím aktuální oficiální verzi aplikace."
        ),
        minVersion: null,
        minBuild: null,
        storeUrl: null,
      };
    }
    throw error;
  }
}
