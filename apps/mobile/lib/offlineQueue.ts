import * as SecureStore from "expo-secure-store";
import { createIdempotencyKey } from "@/lib/installation";

export const MAX_PENDING_CHECK_INS = 20;

export interface PendingCheckIn {
  id: string;
  userId: string;
  installationId: string;
  profileId: string;
  clientRecordedAt: string;
  latitude: number | null;
  longitude: number | null;
  locationAccuracyMeters: number | null;
  createdAt: string;
  status: "pending" | "failed";
  error: string | null;
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

const mutex = new AsyncMutex();
const scope = (userId: string, installationId: string) => `${userId}.${installationId}`;
const indexKey = (userId: string, installationId: string) => `hlasimse.queue.${scope(userId, installationId)}.index`;
const entryKey = (userId: string, installationId: string, id: string) => `hlasimse.queue.${scope(userId, installationId)}.${id}`;

async function readIds(userId: string, installationId: string): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(indexKey(userId, installationId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((id) => typeof id === "string") ? parsed : [];
  } catch {
    return [];
  }
}

export async function addToQueue(input: Omit<PendingCheckIn, "id" | "createdAt"> & { id?: string }): Promise<PendingCheckIn> {
  return mutex.withLock(async () => {
    const ids = await readIds(input.userId, input.installationId);
    if (ids.length >= MAX_PENDING_CHECK_INS) {
      throw new Error("Fronta čekajících hlášení je plná. Připojte se k internetu a zkuste synchronizaci.");
    }
    const item: PendingCheckIn = {
      ...input,
      id: input.id || createIdempotencyKey(),
      createdAt: new Date().toISOString(),
      status: input.status || "pending",
      error: input.error || null,
    };
    await SecureStore.setItemAsync(entryKey(input.userId, input.installationId, item.id), JSON.stringify(item));
    await SecureStore.setItemAsync(indexKey(input.userId, input.installationId), JSON.stringify([...ids, item.id]));
    return item;
  });
}

export async function getQueue(userId: string, installationId: string): Promise<PendingCheckIn[]> {
  return mutex.withLock(async () => {
    const ids = await readIds(userId, installationId);
    const records = await Promise.all(ids.map((id) => SecureStore.getItemAsync(entryKey(userId, installationId, id))));
    return records.flatMap((raw) => {
      if (!raw) return [];
      try {
        const item = JSON.parse(raw) as PendingCheckIn;
        return item.userId === userId && item.installationId === installationId
          ? [{ ...item, status: item.status || "pending", error: item.error || null }]
          : [];
      } catch {
        return [];
      }
    });
  });
}

export async function updateQueueItem(
  userId: string,
  installationId: string,
  id: string,
  values: Pick<PendingCheckIn, "status" | "error">,
): Promise<void> {
  await mutex.withLock(async () => {
    const raw = await SecureStore.getItemAsync(entryKey(userId, installationId, id));
    if (!raw) return;
    const item = JSON.parse(raw) as PendingCheckIn;
    if (item.userId !== userId || item.installationId !== installationId) return;
    await SecureStore.setItemAsync(entryKey(userId, installationId, id), JSON.stringify({ ...item, ...values }));
  });
}

export async function removeFromQueue(userId: string, installationId: string, id: string): Promise<void> {
  await mutex.withLock(async () => {
    const ids = await readIds(userId, installationId);
    await SecureStore.deleteItemAsync(entryKey(userId, installationId, id));
    const remaining = ids.filter((queuedId) => queuedId !== id);
    if (remaining.length) {
      await SecureStore.setItemAsync(indexKey(userId, installationId), JSON.stringify(remaining));
    } else {
      await SecureStore.deleteItemAsync(indexKey(userId, installationId));
    }
  });
}

export async function clearQueue(userId: string, installationId: string): Promise<void> {
  await mutex.withLock(async () => {
    const ids = await readIds(userId, installationId);
    await Promise.all(ids.map((id) => SecureStore.deleteItemAsync(entryKey(userId, installationId, id))));
    await SecureStore.deleteItemAsync(indexKey(userId, installationId));
  });
}

export async function getQueueCount(userId: string, installationId: string): Promise<number> {
  return (await getQueue(userId, installationId)).length;
}
