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

class AsyncMutex {
  private tail: Promise<void> = Promise.resolve();

  async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

const pushDeviceMutex = new AsyncMutex();
let registrationsBlocked = false;

export async function registerPushDevice(expoPushToken: string): Promise<PushDevice> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new Error("Push notifikace lze registrovat jen na iOS nebo Androidu.");
  }
  return pushDeviceMutex.withLock(async () => {
    if (registrationsBlocked) {
      throw new Error("Registrace upozornění je pozastavená během odhlašování.");
    }
    return apiRequest<PushDevice>("/api/v1/push-devices/", {
      method: "POST",
      body: {
        installation_id: await getInstallationId(),
        expo_push_token: expoPushToken,
        platform: Platform.OS,
      },
    });
  });
}

export async function beginPushDeviceLogout(): Promise<string> {
  registrationsBlocked = true;
  return pushDeviceMutex.withLock(getInstallationId);
}

export function resumePushDeviceRegistration(): void {
  registrationsBlocked = false;
}

export async function isCurrentPushDeviceActive(): Promise<boolean> {
  const installationId = await getInstallationId();
  const devices = await apiRequest<PushDevice[]>("/api/v1/push-devices/");
  return devices.some((device) => device.installation_id === installationId && device.active);
}

export async function deactivateCurrentPushDevice(): Promise<void> {
  registrationsBlocked = true;
  try {
    await pushDeviceMutex.withLock(async () => {
      const installationId = await getInstallationId();
      const devices = await apiRequest<PushDevice[]>("/api/v1/push-devices/");
      const current = devices.find((device) => device.installation_id === installationId && device.active);
      if (current) await apiRequest<void>(`/api/v1/push-devices/${current.id}/`, { method: "DELETE" });
    });
  } catch (error) {
    registrationsBlocked = false;
    throw error;
  }
}
