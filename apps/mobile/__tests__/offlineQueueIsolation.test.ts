import * as SecureStore from "expo-secure-store";
import { addToQueue, clearQueue, getQueue, MAX_PENDING_CHECK_INS } from "@/lib/offlineQueue";

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
    await addToQueue({ ...base, userId: "user-a" });
  }
  await expect(addToQueue({ ...base, userId: "user-a" })).rejects.toThrow("plná");
  expect(await getQueue("user-a", base.installationId)).toHaveLength(MAX_PENDING_CHECK_INS);
});
