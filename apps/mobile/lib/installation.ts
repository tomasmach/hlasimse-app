import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

const INSTALLATION_KEY = "hlasimse.installation.id.v1";

export function createIdempotencyKey(): string {
  return Crypto.randomUUID();
}

export async function getInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALLATION_KEY);
  if (existing) return existing;
  const created = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION_KEY, created);
  return created;
}
