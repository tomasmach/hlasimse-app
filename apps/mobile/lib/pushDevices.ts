import { Platform } from "react-native";
import { apiRequest } from "@/lib/api";
import { getInstallationId } from "@/lib/installation";

interface PushDevice {
  id: string;
  installation_id: string;
  expo_push_token: string;
  platform: "ios" | "android";
  active: boolean;
}

export async function registerPushDevice(expoPushToken: string): Promise<PushDevice> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("Push notifikace lze registrovat jen na iOS nebo Androidu.");
  }
  return apiRequest<PushDevice>("/api/v1/push-devices/", {
    method: "POST",
    body: {
      installation_id: await getInstallationId(),
      expo_push_token: expoPushToken,
      platform: Platform.OS,
    },
  });
}

export async function deactivateCurrentPushDevice(): Promise<void> {
  const installationId = await getInstallationId();
  const devices = await apiRequest<PushDevice[]>("/api/v1/push-devices/");
  const current = devices.find((device) => device.installation_id === installationId && device.active);
  if (current) await apiRequest<void>(`/api/v1/push-devices/${current.id}/`, { method: "DELETE" });
}
