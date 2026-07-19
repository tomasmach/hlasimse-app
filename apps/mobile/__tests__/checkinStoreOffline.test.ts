import * as SecureStore from "expo-secure-store";
import { NetworkError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { CheckInProfile } from "@/types/database";

jest.mock("@/lib/api", () => {
  class TestNetworkError extends Error {}
  return {
    NetworkError: TestNetworkError,
    ApiError: class TestApiError extends Error {
      constructor(code: number, _body?: unknown, message = "Rejected") {
        super(message);
        Object.defineProperty(this, "status", { value: code });
      }
    },
    isNetworkError: (error: unknown) => error instanceof TestNetworkError,
    apiRequest: jest.fn(),
  };
});
jest.mock("@/lib/reminderNotifications", () => ({ scheduleReminders: jest.fn() }));

import { apiRequest } from "@/lib/api";
import { useCheckInStore } from "@/stores/checkin";

const mockApiRequest = apiRequest as jest.Mock;
const confirmedProfile: CheckInProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Jana",
  interval_seconds: 86400,
  enabled: true,
  is_paused: false,
  paused_until: null,
  last_checked_in_at: "2026-07-18T12:00:00.000Z",
  next_deadline_at: "2026-07-19T12:00:00.000Z",
  deadline_generation: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-07-18T12:00:00.000Z",
  interval_hours: 24,
  next_deadline: "2026-07-19T12:00:00.000Z",
  last_check_in_at: "2026-07-18T12:00:00.000Z",
  is_active: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  (SecureStore as unknown as { __reset(): void }).__reset();
  useAuthStore.setState({ user: { id: "user-1", email: "a@example.test", first_name: "A", last_name: "", date_joined: "" } });
  useCheckInStore.setState({ profile: confirmedProfile, profiles: [confirmedProfile], isLoading: false, hasFetched: true, error: null, pendingCount: 0, failedPendingCount: 0, pendingItems: [], lastCheckInWasOffline: false });
});

describe("offline check-in safety", () => {
  it("queues a network failure without advancing the confirmed deadline", async () => {
    mockApiRequest.mockRejectedValueOnce(new NetworkError());
    const result = await useCheckInStore.getState().checkIn();
    const state = useCheckInStore.getState();
    expect(result).toEqual({ success: true, offline: true });
    expect(state.profile?.next_deadline_at).toBe(confirmedProfile.next_deadline_at);
    expect(state.pendingCount).toBe(1);
    expect(state.lastCheckInWasOffline).toBe(true);
  });

  it("does not queue an explicit server rejection", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Validation failed"));
    const result = await useCheckInStore.getState().checkIn();
    expect(result).toEqual({ success: false, offline: false });
    expect(useCheckInStore.getState().pendingCount).toBe(0);
  });

  it("reuses the queued UUID as the Idempotency-Key during synchronization", async () => {
    mockApiRequest.mockRejectedValueOnce(new NetworkError());
    await useCheckInStore.getState().checkIn();
    const initialHeaders = mockApiRequest.mock.calls[0][1].headers;
    mockApiRequest.mockReset();
    mockApiRequest.mockResolvedValueOnce({ id: "receipt" }).mockResolvedValueOnce([]);
    await useCheckInStore.getState().syncPendingCheckIns();
    expect(mockApiRequest.mock.calls[0][1].headers["Idempotency-Key"]).toBe(initialHeaders["Idempotency-Key"]);
    expect(useCheckInStore.getState().pendingCount).toBe(0);
  });

  it("keeps a server-rejected queued check-in visible as failed", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockApiRequest.mockRejectedValueOnce(new NetworkError());
    await useCheckInStore.getState().checkIn();
    mockApiRequest.mockReset();
    mockApiRequest.mockRejectedValueOnce(new ApiError(409, null, "Deadline už vypršel"));
    await useCheckInStore.getState().syncPendingCheckIns();
    const state = useCheckInStore.getState();
    expect(state.pendingCount).toBe(0);
    expect(state.failedPendingCount).toBe(1);
    expect(state.pendingItems[0].error).toBe("Deadline už vypršel");
  });
});
