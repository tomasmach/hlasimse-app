import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createIdempotencyKey, getInstallationId } from "@/lib/installation";

const randomUUID = Crypto.randomUUID as jest.Mock;
const secureStore = SecureStore as typeof SecureStore & { __reset: () => void };

beforeEach(() => {
  secureStore.__reset();
  randomUUID.mockReset();
});

it("uses the native cryptographic UUID source for idempotency keys", () => {
  randomUUID.mockReturnValue("11111111-1111-4111-8111-111111111111");

  expect(createIdempotencyKey()).toBe("11111111-1111-4111-8111-111111111111");
  expect(randomUUID).toHaveBeenCalledTimes(1);
});

it("creates and reuses one securely stored installation identifier", async () => {
  randomUUID.mockReturnValue("22222222-2222-4222-8222-222222222222");

  await expect(getInstallationId()).resolves.toBe("22222222-2222-4222-8222-222222222222");
  await expect(getInstallationId()).resolves.toBe("22222222-2222-4222-8222-222222222222");
  expect(randomUUID).toHaveBeenCalledTimes(1);
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
    "hlasimse.installation.id.v1",
    "22222222-2222-4222-8222-222222222222",
  );
});
