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

// Generate unique ID for pending check-in
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function addToQueue(
  checkIn: Omit<PendingCheckIn, "id" | "createdAt">
): Promise<PendingCheckIn> {
  const queue = await getQueue();
  const newCheckIn: PendingCheckIn = {
    ...checkIn,
    id: generateId(),
    createdAt: new Date().toISOString(),
  };
  queue.push(newCheckIn);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return newCheckIn;
}

export async function getQueue(): Promise<PendingCheckIn[]> {
  try {
    const data = await AsyncStorage.getItem(QUEUE_KEY);
    if (!data) return [];
    return JSON.parse(data) as PendingCheckIn[];
  } catch (error) {
    console.error("Error reading offline queue:", error);
    return [];
  }
}

export async function removeFromQueue(id: string): Promise<void> {
  const queue = await getQueue();
  const filtered = queue.filter((item) => item.id !== id);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

export async function getQueueCount(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}
