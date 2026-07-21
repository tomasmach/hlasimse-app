import * as SecureStore from "expo-secure-store";
import { NetworkError } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { CheckInProfile, CheckInReceipt } from "@/types/database";

jest.mock("@/lib/api", () => {
  class TestNetworkError extends Error {}
  return {
    NetworkError: TestNetworkError,
    ApiError: class TestApiError extends Error {
      readonly status: number;
      readonly body: unknown;

      constructor(code: number, body?: unknown, message = "Rejected") {
        super(message);
        this.status = code;
        this.body = body;
      }
    },
    isNetworkError: (error: unknown) => error instanceof TestNetworkError,
    apiRequest: jest.fn(),
  };
});
jest.mock("@/lib/reminderNotifications", () => ({ reconcileReminders: jest.fn() }));

import { apiRequest } from "@/lib/api";
import { ProfileArchiveBlockedError, useCheckInStore } from "@/stores/checkin";

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
  useAuthStore.setState({ user: { id: "user-1", email: "a@example.test", first_name: "A", last_name: "", date_joined: "", email_verified_at: "2026-07-19T00:00:00Z" } });
  useCheckInStore.setState({ profile: confirmedProfile, profiles: [confirmedProfile], isLoading: false, hasFetched: true, lastFetchSucceeded: true, isUsingCachedProfiles: false, profilesCachedAt: null, guardianOnlyMode: false, error: null, pendingCount: 0, failedPendingCount: 0, pendingItems: [], lastCheckInWasOffline: false });
});

describe("offline check-in safety", () => {
  it("queues a network failure without advancing the confirmed deadline", async () => {
    mockApiRequest.mockRejectedValueOnce(new NetworkError());
    const result = await useCheckInStore.getState().checkIn({ lat: 50.1, lng: 14.4, accuracy: 12 });
    const state = useCheckInStore.getState();
    expect(result).toEqual({ success: true, offline: true });
    expect(state.profile?.next_deadline_at).toBe(confirmedProfile.next_deadline_at);
    expect(state.pendingCount).toBe(1);
    expect(state.lastCheckInWasOffline).toBe(true);
    expect(state.pendingItems[0]).toMatchObject({ latitude: null, longitude: null, locationAccuracyMeters: null });
  });

  it("uses an explicitly stale secure profile cache during a cold network failure", async () => {
    mockApiRequest.mockResolvedValueOnce([confirmedProfile]);
    await useCheckInStore.getState().fetchProfile("user-1");
    useCheckInStore.setState({ profile: null, profiles: [], hasFetched: false });
    mockApiRequest.mockRejectedValueOnce(new NetworkError());

    await useCheckInStore.getState().fetchProfile("user-1");

    expect(useCheckInStore.getState()).toMatchObject({
      profile: { id: confirmedProfile.id, next_deadline_at: confirmedProfile.next_deadline_at },
      lastFetchSucceeded: false,
      isUsingCachedProfiles: true,
    });
    expect(useCheckInStore.getState().profilesCachedAt).toEqual(expect.any(String));
    mockApiRequest.mockRejectedValueOnce(new NetworkError());

    await expect(useCheckInStore.getState().checkIn()).resolves.toEqual({
      success: true,
      offline: true,
    });
    expect(useCheckInStore.getState()).toMatchObject({
      isUsingCachedProfiles: true,
      pendingCount: 1,
      profile: { next_deadline_at: confirmedProfile.next_deadline_at },
    });
  });

  it("restores a non-default selected profile from secure local state", async () => {
    const secondProfile: CheckInProfile = {
      ...confirmedProfile,
      id: "22222222-2222-4222-8222-222222222222",
      name: "E2E update sentinel",
      created_at: "2026-01-02T00:00:00.000Z",
    };
    mockApiRequest.mockResolvedValueOnce([confirmedProfile, secondProfile]);
    await useCheckInStore.getState().fetchProfile("user-1");
    await useCheckInStore.getState().selectProfile(secondProfile.id);
    await expect(
      SecureStore.getItemAsync("hlasimse.selected-profile.user-1"),
    ).resolves.toBe(secondProfile.id);

    useCheckInStore.setState({ profile: null, profiles: [], hasFetched: false });
    mockApiRequest.mockResolvedValueOnce([confirmedProfile, secondProfile]);
    await useCheckInStore.getState().fetchProfile("user-1");

    expect(useCheckInStore.getState().profiles.map((profile) => profile.id)).toEqual([
      confirmedProfile.id,
      secondProfile.id,
    ]);
    expect(useCheckInStore.getState().profile?.id).toBe(secondProfile.id);
  });

  it("allows a guardian-only account to skip owned profile creation", async () => {
    await useCheckInStore.getState().chooseGuardianOnlyMode("user-1", true);
    mockApiRequest.mockResolvedValueOnce([]);
    await useCheckInStore.getState().fetchProfile("user-1");
    expect(useCheckInStore.getState()).toMatchObject({ profile: null, profiles: [], guardianOnlyMode: true, lastFetchSucceeded: true });
  });

  it("does not queue an explicit server rejection", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("Validation failed"));
    const result = await useCheckInStore.getState().checkIn();
    expect(result).toEqual({ success: false, offline: false });
    expect(useCheckInStore.getState().pendingCount).toBe(0);
  });

  it.each([426, 503])("does not report or queue a %s release-gate rejection", async (status) => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockApiRequest.mockRejectedValueOnce(new ApiError(status, {
      code: status === 426 ? "update_required" : "maintenance",
    }));

    await expect(useCheckInStore.getState().checkIn()).resolves.toEqual({
      success: false,
      offline: false,
    });
    expect(useCheckInStore.getState()).toMatchObject({
      pendingCount: 0,
      lastCheckInWasOffline: false,
    });
  });

  it("omits queue provenance from a live check-in and preserves the false receipt field", async () => {
    const receipt: CheckInReceipt = {
      id: "receipt-live",
      idempotency_key: "live-key",
      accepted_at: "2026-07-19T10:00:00Z",
      deadline_generation: 2,
      next_deadline_at: "2026-07-20T10:00:00Z",
      submitted_from_queue: false,
    };
    mockApiRequest
      .mockResolvedValueOnce(receipt)
      .mockResolvedValueOnce([confirmedProfile]);

    await expect(useCheckInStore.getState().checkIn()).resolves.toEqual({
      success: true,
      offline: false,
    });

    const body = mockApiRequest.mock.calls[0][1].body;
    expect(body).not.toHaveProperty("submitted_from_queue");
  });

  it("reuses the queued UUID as the Idempotency-Key during synchronization", async () => {
    mockApiRequest.mockRejectedValueOnce(new NetworkError());
    await useCheckInStore.getState().checkIn();
    const initialHeaders = mockApiRequest.mock.calls[0][1].headers;
    mockApiRequest.mockReset();
    const receipt: CheckInReceipt = {
      id: "receipt-queued",
      idempotency_key: initialHeaders["Idempotency-Key"],
      accepted_at: "2026-07-19T10:00:00Z",
      deadline_generation: 2,
      next_deadline_at: "2026-07-20T10:00:00Z",
      submitted_from_queue: true,
    };
    mockApiRequest.mockResolvedValueOnce(receipt).mockResolvedValueOnce([]);
    await useCheckInStore.getState().syncPendingCheckIns();
    expect(mockApiRequest.mock.calls[0][1].headers["Idempotency-Key"]).toBe(initialHeaders["Idempotency-Key"]);
    expect(mockApiRequest.mock.calls[0][1].body.submitted_from_queue).toBe(true);
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

  it("keeps an update-blocked queued check-in pending for the updated app", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockApiRequest.mockRejectedValueOnce(new NetworkError());
    await useCheckInStore.getState().checkIn();
    mockApiRequest.mockReset();
    mockApiRequest.mockRejectedValueOnce(new ApiError(426, { code: "update_required" }));

    await useCheckInStore.getState().syncPendingCheckIns();

    expect(useCheckInStore.getState()).toMatchObject({
      pendingCount: 1,
      failedPendingCount: 0,
      pendingItems: [expect.objectContaining({ status: "pending", error: null })],
    });
  });

  it("keeps the profile active and exposes the exact incident when archive returns 409", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockApiRequest.mockRejectedValueOnce(
      new ApiError(
        409,
        {
          code: "profile_has_open_incident",
          detail: "Profil nelze archivovat během aktivního incidentu.",
          incident_id: "incident-open-1",
        },
        "Profil nelze archivovat během aktivního incidentu.",
      ),
    );

    await expect(useCheckInStore.getState().deleteProfile(confirmedProfile.id)).rejects.toEqual(
      expect.objectContaining({
        name: "ProfileArchiveBlockedError",
        code: "profile_has_open_incident",
        incidentId: "incident-open-1",
      }),
    );
    expect(useCheckInStore.getState().profiles).toEqual([confirmedProfile]);
    expect(useCheckInStore.getState().profile).toEqual(confirmedProfile);
    expect(ProfileArchiveBlockedError).toBeDefined();
  });

  it("removes an archived profile only after the server confirms deletion", async () => {
    let confirmArchive: (() => void) | undefined;
    mockApiRequest.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        confirmArchive = resolve;
      }),
    );

    const archive = useCheckInStore.getState().deleteProfile(confirmedProfile.id);
    expect(useCheckInStore.getState().profiles).toEqual([confirmedProfile]);
    confirmArchive?.();
    await archive;

    expect(useCheckInStore.getState().profiles).toEqual([]);
    expect(useCheckInStore.getState().profile).toBeNull();
  });
});
