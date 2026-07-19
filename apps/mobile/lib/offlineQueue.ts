// lib/offlineQueue.ts
import AsyncStorage from "@react-native-async-storage/async-storage";

const QUEUE_KEY = "offline_checkin_queue";

export interface PendingCheckIn {
  id: string;
  profileId: string;
  checkedInAt: string;
  nextDeadline: string;
  lat: number | null;
  lng: number | null;
  createdAt: string;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  remainingCount: number;
}

// Async mutex to prevent race conditions on queue operations
class AsyncMutex {
  private locked = false;
  private waiting: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }

  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

const queueMutex = new AsyncMutex();

// Generate unique ID for pending check-in
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Internal read without lock (for use inside locked sections)
async function readQueueUnsafe(): Promise<PendingCheckIn[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    if (!data) return [];
    return JSON.parse(data) as PendingCheckIn[];
  } catch (error) {
    console.error("Error reading offline queue:", error);
    return [];
  }
}

export async function addToQueue(
  checkIn: Omit<PendingCheckIn, "id" | "createdAt">
): Promise<PendingCheckIn> {
  return queueMutex.withLock(async () => {
    const queue = await readQueueUnsafe();
    const newCheckIn: PendingCheckIn = {
      ...checkIn,
      id: generateId(),
      createdAt: new Date().toISOString(),
    };
    queue.push(newCheckIn);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return newCheckIn;
  });
}

export async function getQueue(): Promise<PendingCheckIn[]> {
  return queueMutex.withLock(async () => {
    return readQueueUnsafe();
  });
}

export async function removeFromQueue(id: string): Promise<void> {
  return queueMutex.withLock(async () => {
    const queue = await readQueueUnsafe();
    const filtered = queue.filter((item) => item.id !== id);
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
  });
}

export async function clearQueue(): Promise<void> {
  return queueMutex.withLock(async () => {
    await AsyncStorage.removeItem(QUEUE_KEY);
  });
}

export async function getQueueCount(): Promise<number> {
  return queueMutex.withLock(async () => {
    const queue = await readQueueUnsafe();
    return queue.length;
  });
}
