jest.mock("@/lib/api", () => ({ apiRequest: jest.fn() }));
jest.mock("@/lib/installation", () => ({ getInstallationId: jest.fn(async () => "22222222-2222-4222-8222-222222222222") }));

import { apiRequest } from "@/lib/api";
import {
  beginPushDeviceLogout,
  deactivateCurrentPushDevice,
  registerPushDevice,
  resumePushDeviceRegistration,
} from "@/lib/pushDevices";

const request = apiRequest as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resumePushDeviceRegistration();
});

it("registers the Expo token against the stable installation", async () => {
  request.mockResolvedValue({ id: "device-1" });
  await registerPushDevice("ExponentPushToken[test]");
  expect(request).toHaveBeenCalledWith("/api/v1/push-devices/", {
    method: "POST",
    body: {
      installation_id: "22222222-2222-4222-8222-222222222222",
      expo_push_token: "ExponentPushToken[test]",
      platform: "ios",
    },
  });
});

it("deactivates only the current installation on logout", async () => {
  request.mockResolvedValueOnce([
    { id: "other", installation_id: "other", active: true },
    { id: "current", installation_id: "22222222-2222-4222-8222-222222222222", active: true },
  ]).mockResolvedValueOnce(undefined);
  await deactivateCurrentPushDevice();
  expect(request).toHaveBeenLastCalledWith("/api/v1/push-devices/current/", { method: "DELETE" });
});

it("drains an in-flight registration and blocks reactivation during logout", async () => {
  let resolveRegistration!: (value: { id: string }) => void;
  const registrationResponse = new Promise<{ id: string }>((resolve) => {
    resolveRegistration = resolve;
  });
  request.mockReturnValueOnce(registrationResponse);

  const registration = registerPushDevice("ExponentPushToken[in-flight]");
  await Promise.resolve();
  const logoutBarrier = beginPushDeviceLogout();
  let barrierFinished = false;
  void logoutBarrier.then(() => { barrierFinished = true; });
  await Promise.resolve();
  expect(barrierFinished).toBe(false);

  resolveRegistration({ id: "device-in-flight" });
  await registration;
  await expect(logoutBarrier).resolves.toBe("22222222-2222-4222-8222-222222222222");
  await expect(registerPushDevice("ExponentPushToken[late]")).rejects.toThrow(
    "během odhlašování",
  );
  expect(request).toHaveBeenCalledTimes(1);
});
