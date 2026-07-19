import type { CheckInProfile } from "../types/database";

jest.mock("@/lib/supabase", () => ({
  supabase: { rpc: jest.fn() },
}));

jest.mock("@/lib/offlineQueue", () => ({
  addToQueue: jest.fn(),
  getQueue: jest.fn(),
  removeFromQueue: jest.fn(),
  getQueueCount: jest.fn(),
}));

jest.mock("@/lib/reminderNotifications", () => ({
  scheduleReminders: jest.fn(),
}));

import { supabase } from "../lib/supabase";
import {
  addToQueue,
  getQueue,
  getQueueCount,
  removeFromQueue,
} from "../lib/offlineQueue";
import { scheduleReminders } from "../lib/reminderNotifications";
import { useCheckInStore } from "../stores/checkin";

const mockRpc = supabase.rpc as jest.Mock;
const mockAddToQueue = addToQueue as jest.Mock;
const mockGetQueue = getQueue as jest.Mock;
const mockRemoveFromQueue = removeFromQueue as jest.Mock;
const mockGetQueueCount = getQueueCount as jest.Mock;
const mockScheduleReminders = scheduleReminders as jest.Mock;
const mockConsoleError = jest
  .spyOn(console, "error")
  .mockImplementation(() => undefined);

const confirmedProfile: CheckInProfile = {
  id: "profile-1",
  owner_id: "user-1",
  name: "Jana",
  avatar_url: null,
  interval_hours: 24,
  next_deadline: "2026-07-19T12:00:00.000Z",
  last_check_in_at: "2026-07-18T12:00:00.000Z",
  last_known_lat: null,
  last_known_lng: null,
  is_paused: false,
  paused_until: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-07-18T12:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetQueueCount.mockResolvedValue(1);
  mockRemoveFromQueue.mockResolvedValue(undefined);
  mockScheduleReminders.mockResolvedValue(undefined);
  useCheckInStore.setState({
    profile: confirmedProfile,
    isLoading: false,
    hasFetched: true,
    error: null,
    pendingCount: 0,
    lastCheckInWasOffline: false,
  });
});

afterAll(() => {
  mockConsoleError.mockRestore();
});

describe("offline check-in safety", () => {
  it("queues a network failure without advancing the server-confirmed deadline", async () => {
    mockRpc.mockRejectedValue(new TypeError("Network request failed"));
    mockAddToQueue.mockResolvedValue({ id: "pending-1" });

    const result = await useCheckInStore.getState().checkIn();
    const state = useCheckInStore.getState();

    expect(result).toEqual({ success: true, offline: true });
    expect(mockAddToQueue).toHaveBeenCalledTimes(1);
    expect(state.profile?.next_deadline).toBe(confirmedProfile.next_deadline);
    expect(state.profile?.last_check_in_at).toBe(
      confirmedProfile.last_check_in_at
    );
    expect(state.lastCheckInWasOffline).toBe(true);
    expect(state.pendingCount).toBe(1);
    expect(mockScheduleReminders).not.toHaveBeenCalled();
  });

  it("reports failure when the pending check-in cannot be stored safely", async () => {
    mockRpc.mockRejectedValue(new TypeError("Network request failed"));
    mockAddToQueue.mockRejectedValue(new Error("Storage unavailable"));

    const result = await useCheckInStore.getState().checkIn();
    const state = useCheckInStore.getState();

    expect(result).toEqual({ success: false, offline: false });
    expect(state.isLoading).toBe(false);
    expect(state.lastCheckInWasOffline).toBe(false);
    expect(state.profile?.next_deadline).toBe(confirmedProfile.next_deadline);
  });

  it("updates the deadline only after the server confirms synchronization", async () => {
    const syncedProfile = {
      ...confirmedProfile,
      next_deadline: "2026-07-20T12:00:00.000Z",
      last_check_in_at: "2026-07-19T12:00:00.000Z",
    };
    mockGetQueue.mockResolvedValue([
      {
        id: "pending-1",
        profileId: confirmedProfile.id,
        checkedInAt: syncedProfile.last_check_in_at,
        nextDeadline: syncedProfile.next_deadline,
        lat: null,
        lng: null,
      },
    ]);
    mockRpc.mockResolvedValue({ data: syncedProfile, error: null });
    mockGetQueueCount.mockResolvedValue(0);

    const result = await useCheckInStore.getState().syncPendingCheckIns();
    const state = useCheckInStore.getState();

    expect(result).toEqual({ synced: 1, failed: 0 });
    expect(mockRemoveFromQueue).toHaveBeenCalledWith("pending-1");
    expect(state.profile?.next_deadline).toBe(syncedProfile.next_deadline);
    expect(state.pendingCount).toBe(0);
    expect(state.lastCheckInWasOffline).toBe(false);
    expect(mockScheduleReminders).toHaveBeenCalledWith(
      syncedProfile.next_deadline
    );
  });
});
