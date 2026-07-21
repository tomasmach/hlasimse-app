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
const journalKey = (userId: string, installationId: string) => `hlasimse.queue.${scope(userId, installationId)}.journal.v1`;

interface QueueJournal {
  version: 1;
  desiredIds: string[];
  upserts: PendingCheckIn[];
  deletes: string[];
}

export class OfflineQueueIntegrityError extends Error {
  constructor() {
    super("Frontu čekajících hlášení nelze bezpečně ověřit. Hlášení nemažte a kontaktujte podporu.");
    this.name = "OfflineQueueIntegrityError";
  }
}

function parseIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((id) => typeof id === "string" && id.length > 0) ||
      new Set(parsed).size !== parsed.length
    ) {
      throw new OfflineQueueIntegrityError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof OfflineQueueIntegrityError) throw error;
    throw new OfflineQueueIntegrityError();
  }
}

function parseItem(
  raw: string,
  userId: string,
  installationId: string,
  expectedId?: string,
): PendingCheckIn {
  try {
    const item = JSON.parse(raw) as Partial<PendingCheckIn>;
    if (
      typeof item.id !== "string" ||
      (expectedId !== undefined && item.id !== expectedId) ||
      item.userId !== userId ||
      item.installationId !== installationId ||
      typeof item.profileId !== "string" ||
      typeof item.clientRecordedAt !== "string" ||
      typeof item.createdAt !== "string" ||
      !["pending", "failed"].includes(item.status || "") ||
      !(item.error === null || typeof item.error === "string")
    ) {
      throw new OfflineQueueIntegrityError();
    }
    return item as PendingCheckIn;
  } catch (error) {
    if (error instanceof OfflineQueueIntegrityError) throw error;
    throw new OfflineQueueIntegrityError();
  }
}

function parseJournal(raw: string, userId: string, installationId: string): QueueJournal {
  try {
    const journal = JSON.parse(raw) as Partial<QueueJournal>;
    if (
      journal.version !== 1 ||
      !Array.isArray(journal.desiredIds) ||
      !Array.isArray(journal.upserts) ||
      !Array.isArray(journal.deletes)
    ) {
      throw new OfflineQueueIntegrityError();
    }
    const desiredIds = parseIds(JSON.stringify(journal.desiredIds));
    const deletes = parseIds(JSON.stringify(journal.deletes));
    const upserts = journal.upserts.map((item) =>
      parseItem(JSON.stringify(item), userId, installationId),
    );
    if (upserts.some((item) => !desiredIds.includes(item.id))) {
      throw new OfflineQueueIntegrityError();
    }
    return { version: 1, desiredIds, upserts, deletes };
  } catch (error) {
    if (error instanceof OfflineQueueIntegrityError) throw error;
    throw new OfflineQueueIntegrityError();
  }
}

async function applyJournal(
  userId: string,
  installationId: string,
  journal: QueueJournal,
): Promise<void> {
  for (const item of journal.upserts) {
    await SecureStore.setItemAsync(
      entryKey(userId, installationId, item.id),
      JSON.stringify(item),
    );
  }
  if (journal.desiredIds.length) {
    await SecureStore.setItemAsync(
      indexKey(userId, installationId),
      JSON.stringify(journal.desiredIds),
    );
  } else {
    await SecureStore.deleteItemAsync(indexKey(userId, installationId));
  }
  for (const id of journal.deletes) {
    await SecureStore.deleteItemAsync(entryKey(userId, installationId, id));
  }
  await SecureStore.deleteItemAsync(journalKey(userId, installationId));
}

async function recoverJournal(userId: string, installationId: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(journalKey(userId, installationId));
  if (!raw) return;
  await applyJournal(userId, installationId, parseJournal(raw, userId, installationId));
}

async function commitJournal(
  userId: string,
  installationId: string,
  journal: QueueJournal,
): Promise<void> {
  await SecureStore.setItemAsync(
    journalKey(userId, installationId),
    JSON.stringify(journal),
  );
  await applyJournal(userId, installationId, journal);
}

async function readIds(userId: string, installationId: string): Promise<string[]> {
  await recoverJournal(userId, installationId);
  const raw = await SecureStore.getItemAsync(indexKey(userId, installationId));
  if (!raw) return [];
  return parseIds(raw);
}

export async function addToQueue(input: Omit<PendingCheckIn, "id" | "createdAt"> & { id?: string }): Promise<PendingCheckIn> {
  return mutex.withLock(async () => {
    const ids = await readIds(input.userId, input.installationId);
    const item: PendingCheckIn = {
      ...input,
      id: input.id || createIdempotencyKey(),
      createdAt: new Date().toISOString(),
      status: input.status || "pending",
      error: input.error || null,
    };
    if (ids.includes(item.id)) {
      const raw = await SecureStore.getItemAsync(
        entryKey(input.userId, input.installationId, item.id),
      );
      if (!raw) throw new OfflineQueueIntegrityError();
      return parseItem(raw, input.userId, input.installationId, item.id);
    }
    if (ids.length >= MAX_PENDING_CHECK_INS) {
      throw new Error("Fronta čekajících hlášení je plná. Připojte se k internetu a zkuste synchronizaci.");
    }
    await commitJournal(input.userId, input.installationId, {
      version: 1,
      desiredIds: [...ids, item.id],
      upserts: [item],
      deletes: [],
    });
    return item;
  });
}

export async function getQueue(userId: string, installationId: string): Promise<PendingCheckIn[]> {
  return mutex.withLock(async () => {
    const ids = await readIds(userId, installationId);
    const records = await Promise.all(ids.map((id) => SecureStore.getItemAsync(entryKey(userId, installationId, id))));
    return records.map((raw, index) => {
      if (!raw) throw new OfflineQueueIntegrityError();
      return parseItem(raw, userId, installationId, ids[index]);
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
    const ids = await readIds(userId, installationId);
    if (!ids.includes(id)) return;
    const raw = await SecureStore.getItemAsync(entryKey(userId, installationId, id));
    if (!raw) throw new OfflineQueueIntegrityError();
    const item = parseItem(raw, userId, installationId, id);
    await commitJournal(userId, installationId, {
      version: 1,
      desiredIds: ids,
      upserts: [{ ...item, ...values }],
      deletes: [],
    });
  });
}

export async function removeFromQueue(userId: string, installationId: string, id: string): Promise<void> {
  await mutex.withLock(async () => {
    const ids = await readIds(userId, installationId);
    if (!ids.includes(id)) return;
    const remaining = ids.filter((queuedId) => queuedId !== id);
    await commitJournal(userId, installationId, {
      version: 1,
      desiredIds: remaining,
      upserts: [],
      deletes: [id],
    });
  });
}

export async function clearQueue(userId: string, installationId: string): Promise<void> {
  await mutex.withLock(async () => {
    const ids = await readIds(userId, installationId);
    if (!ids.length) return;
    await commitJournal(userId, installationId, {
      version: 1,
      desiredIds: [],
      upserts: [],
      deletes: ids,
    });
  });
}

export async function getQueueCount(userId: string, installationId: string): Promise<number> {
  return (await getQueue(userId, installationId)).length;
}
