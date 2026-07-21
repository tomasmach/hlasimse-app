import * as SecureStore from "expo-secure-store";
import {
  addToQueue,
  clearQueue,
  getQueue,
  MAX_PENDING_CHECK_INS,
  removeFromQueue,
} from "@/lib/offlineQueue";

const base = {
  installationId: "22222222-2222-4222-8222-222222222222",
  profileId: "33333333-3333-4333-8333-333333333333",
  clientRecordedAt: "2026-07-19T12:00:00Z",
  latitude: 50.08,
  longitude: 14.43,
  locationAccuracyMeters: 8,
  status: "pending" as const,
  error: null,
};

beforeEach(() => (SecureStore as unknown as { __reset(): void }).__reset());

it("isolates encrypted queue entries by user and installation and purges only the target scope", async () => {
  await addToQueue({ ...base, userId: "user-a" });
  await addToQueue({ ...base, userId: "user-b" });
  expect(await getQueue("user-a", base.installationId)).toHaveLength(1);
  expect(await getQueue("user-b", base.installationId)).toHaveLength(1);
  await clearQueue("user-a", base.installationId);
  expect(await getQueue("user-a", base.installationId)).toHaveLength(0);
  expect(await getQueue("user-b", base.installationId)).toHaveLength(1);
});

it("bounds the queue instead of silently dropping older safety events", async () => {
  for (let index = 0; index < MAX_PENDING_CHECK_INS; index += 1) {
    await addToQueue({ ...base, userId: "user-a", id: `pending-${index}` });
  }
  await expect(
    addToQueue({ ...base, userId: "user-a", id: "pending-over-limit" }),
  ).rejects.toThrow("plná");
  expect(await getQueue("user-a", base.installationId)).toHaveLength(MAX_PENDING_CHECK_INS);
});

it("recovers an entry when the app stops after writing it but before updating the index", async () => {
  const secureStore = SecureStore as unknown as {
    __values: Map<string, string>;
    setItemAsync: jest.Mock;
  };
  let rejectIndexOnce = true;
  secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
    if (rejectIndexOnce && key.endsWith(".index")) {
      rejectIndexOnce = false;
      throw new Error("simulated process stop before index commit");
    }
    secureStore.__values.set(key, value);
  });

  await expect(addToQueue({ ...base, userId: "user-a", id: "stable-check-in-id" })).rejects.toThrow(
    "simulated process stop",
  );

  expect(await getQueue("user-a", base.installationId)).toMatchObject([
    { id: "stable-check-in-id", status: "pending" },
  ]);
});

it("finishes a removal after an interrupted entry deletion", async () => {
  const item = await addToQueue({ ...base, userId: "user-a" });
  const secureStore = SecureStore as unknown as {
    __values: Map<string, string>;
    deleteItemAsync: jest.Mock;
  };
  let rejectEntryDeleteOnce = true;
  secureStore.deleteItemAsync.mockImplementation(async (key: string) => {
    if (rejectEntryDeleteOnce && key.endsWith(`.${item.id}`)) {
      rejectEntryDeleteOnce = false;
      throw new Error("simulated process stop during removal");
    }
    secureStore.__values.delete(key);
  });

  await expect(removeFromQueue("user-a", base.installationId, item.id)).rejects.toThrow(
    "simulated process stop",
  );
  expect(await getQueue("user-a", base.installationId)).toHaveLength(0);
});

it("fails visibly instead of treating a corrupted queue index as empty", async () => {
  const secureStore = SecureStore as unknown as { __values: Map<string, string> };
  secureStore.__values.set(
    `hlasimse.queue.user-a.${base.installationId}.index`,
    "not-json",
  );

  await expect(getQueue("user-a", base.installationId)).rejects.toThrow(
    "nelze bezpečně ověřit",
  );
});
