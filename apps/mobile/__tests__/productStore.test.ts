jest.mock("@/lib/api", () => ({ apiRequest: jest.fn() }));
jest.mock("@/lib/installation", () => ({ getInstallationId: jest.fn() }));

import { apiRequest } from "@/lib/api";
import { getInstallationId } from "@/lib/installation";
import { useProductStore } from "@/stores/product";
import type {
  AccountExport,
  AlertIncident,
  CheckInHistoryPage,
  ProfileTimelinePage,
} from "@/types/product";

const request = apiRequest as jest.Mock;
const installation = getInstallationId as jest.Mock;

const providerAcceptedAlert: AlertIncident = {
  id: "alert-1",
  profile_id: "profile-1",
  profile_name: "Denní kontrola",
  deadline_generation: 3,
  deadline_at: "2026-07-19T10:00:00Z",
  opened_at: "2026-07-19T10:01:00Z",
  resolved_at: null,
  status: "open",
  acknowledgements: [],
  last_known_location: null,
  delivery_status: {
    state: "sent_to_provider",
    attempt_counts: { ticket_received: 1 },
  },
  can_acknowledge: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  useProductStore.getState().reset();
  installation.mockResolvedValue("installation-1");
});

it("loads paginated server-confirmed history and exact statistics filters", async () => {
  const page: CheckInHistoryPage = {
    count: 1,
    next: null,
    previous: null,
    results: [
      {
        id: "check-in-1",
        profile_id: "profile-1",
        profile_name: "Denní kontrola",
        accepted_at: "2026-07-19T09:00:00Z",
        client_recorded_at: null,
        deadline_generation: 2,
        response_deadline_at: "2026-07-20T09:00:00Z",
        server_confirmed: true,
        resolved_incident_count: 0,
        submitted_from_queue: false,
      },
    ],
  };
  const statistics = {
    period: { from: "2026-07-01T00:00:00Z", to: null },
    total_check_ins: 1,
    on_time_check_ins: 1,
    incident_count: 0,
    definitions: {
      total_check_ins: "Potvrzené",
      on_time_check_ins: "Včas",
      incident_count: "Incidenty",
    },
  };
  request.mockResolvedValueOnce(page).mockResolvedValueOnce(statistics);

  await useProductStore.getState().loadHistory({
    profile: "profile-1",
    from: "2026-07-01T00:00:00Z",
    page: 2,
    pageSize: 25,
  });
  await useProductStore.getState().loadStatistics({
    profile: "profile-1",
    from: "2026-07-01T00:00:00Z",
  });

  expect(request).toHaveBeenNthCalledWith(
    1,
    "/api/v1/check-ins/?profile=profile-1&from=2026-07-01T00%3A00%3A00Z&page=2&page_size=25",
  );
  expect(request).toHaveBeenNthCalledWith(
    2,
    "/api/v1/statistics/?profile=profile-1&from=2026-07-01T00%3A00%3A00Z",
  );
  expect(useProductStore.getState().history?.results[0].server_confirmed).toBe(true);
  expect(useProductStore.getState().resources.history.status).toBe("ready");
});

it("loads the owner-authorized combined safety timeline", async () => {
  const timeline: ProfileTimelinePage = {
    next: null,
    previous: null,
    results: [
      {
        id: "event-1",
        event_type: "profile.paused",
        occurred_at: "2026-07-19T10:00:00Z",
        profile_id: "profile-1",
        details: {
          automatic: false,
          deadline_generation: 4,
          has_scheduled_resume: false,
        },
      },
    ],
  };
  request.mockResolvedValueOnce(timeline);
  await expect(useProductStore.getState().loadTimeline("profile-1")).resolves.toEqual(timeline);
  expect(request).toHaveBeenCalledWith("/api/v1/profiles/profile-1/timeline/?page_size=50");
  expect(useProductStore.getState().timeline?.results[0].event_type).toBe("profile.paused");
  expect(useProductStore.getState().timelineProfileId).toBe("profile-1");
});

it("appends cursor pages in server order without duplicating events", async () => {
  const first: ProfileTimelinePage = {
    previous: null,
    next: "https://api.example.test/api/v1/profiles/profile-1/timeline/?cursor=older-1&page_size=50",
    results: [
      {
        id: "event-new",
        event_type: "checkin.confirmed",
        occurred_at: "2026-07-19T11:00:00Z",
        profile_id: "profile-1",
        details: {
          check_in_id: "check-in-new",
          deadline_generation: 5,
          next_deadline_at: "2026-07-20T11:00:00Z",
          submitted_from_queue: false,
          resolved_incident_count: 0,
        },
      },
    ],
  };
  const second: ProfileTimelinePage = {
    previous: "https://api.example.test/api/v1/profiles/profile-1/timeline/?cursor=newer-1",
    next: null,
    results: [
      first.results[0],
      {
        id: "event-old",
        event_type: "checkin.confirmed",
        occurred_at: "2026-07-18T11:00:00Z",
        profile_id: "profile-1",
        details: {
          check_in_id: "check-in-old",
          deadline_generation: 4,
          next_deadline_at: "2026-07-19T11:00:00Z",
          submitted_from_queue: true,
          resolved_incident_count: 1,
        },
      },
    ],
  };
  request.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

  await useProductStore.getState().loadTimeline("profile-1");
  const merged = await useProductStore.getState().loadMoreTimeline("profile-1");

  expect(request).toHaveBeenNthCalledWith(
    2,
    "/api/v1/profiles/profile-1/timeline/?cursor=older-1&page_size=50",
  );
  expect(merged?.results.map((event) => event.id)).toEqual(["event-new", "event-old"]);
  expect(merged?.results[1]).toMatchObject({
    event_type: "checkin.confirmed",
    details: { submitted_from_queue: true },
  });
  expect(merged?.next).toBeNull();
});

it("rejects a cursor URL for another profile without issuing a request", async () => {
  const page: ProfileTimelinePage = {
    previous: null,
    next: "https://api.example.test/api/v1/profiles/other/timeline/?cursor=escape",
    results: [],
  };
  request.mockResolvedValueOnce(page);
  await useProductStore.getState().loadTimeline("profile-1");

  await expect(useProductStore.getState().loadMoreTimeline("profile-1")).rejects.toThrow(
    "neplatný odkaz",
  );
  expect(request).toHaveBeenCalledTimes(1);
});

it("does not mix a late timeline response into the newly selected profile", async () => {
  let finishFirst: ((page: ProfileTimelinePage) => void) | undefined;
  const firstRequest = new Promise<ProfileTimelinePage>((resolve) => {
    finishFirst = resolve;
  });
  const secondPage: ProfileTimelinePage = {
    previous: null,
    next: null,
    results: [
      {
        id: "profile-2-event",
        event_type: "profile.created",
        occurred_at: "2026-07-19T12:00:00Z",
        profile_id: "profile-2",
        details: {
          enabled: true,
          is_paused: false,
          interval_seconds: 3_600,
          deadline_generation: 1,
        },
      },
    ],
  };
  request.mockReturnValueOnce(firstRequest).mockResolvedValueOnce(secondPage);

  const firstLoad = useProductStore.getState().loadTimeline("profile-1");
  await useProductStore.getState().loadTimeline("profile-2");
  finishFirst?.({
    previous: null,
    next: null,
    results: [
      {
        id: "profile-1-event",
        event_type: "profile.created",
        occurred_at: "2026-07-19T11:00:00Z",
        profile_id: "profile-1",
        details: {
          enabled: true,
          is_paused: false,
          interval_seconds: 7_200,
          deadline_generation: 1,
        },
      },
    ],
  });
  await firstLoad;

  expect(useProductStore.getState().timelineProfileId).toBe("profile-2");
  expect(useProductStore.getState().timeline?.results.map((event) => event.id)).toEqual([
    "profile-2-event",
  ]);
});

it("keeps provider acceptance distinct from delivery and waits for server acknowledgement", async () => {
  request.mockResolvedValueOnce([providerAcceptedAlert]);
  await useProductStore.getState().loadAlerts();
  expect(useProductStore.getState().alerts[0].delivery_status.state).toBe("sent_to_provider");

  let finishAcknowledgement: ((alert: AlertIncident) => void) | undefined;
  request.mockReturnValueOnce(
    new Promise<AlertIncident>((resolve) => {
      finishAcknowledgement = resolve;
    }),
  );
  const acknowledgement = useProductStore.getState().acknowledgeAlert("alert-1");
  expect(useProductStore.getState().alerts[0].acknowledgements).toHaveLength(0);

  const confirmed = {
    ...providerAcceptedAlert,
    acknowledgements: [{ user_id: "guardian-1", acknowledged_at: "2026-07-19T10:02:00Z" }],
  };
  finishAcknowledgement?.(confirmed);
  await acknowledgement;

  expect(request).toHaveBeenLastCalledWith("/api/v1/alerts/alert-1/acknowledge/", {
    method: "POST",
  });
  expect(useProductStore.getState().alerts[0].acknowledgements).toEqual(confirmed.acknowledgements);
});

it("returns a sensitive account export without retaining it in the store", async () => {
  const exported = {
    schema_version: 1,
    account: {
      id: "user-1",
      email: "jana@example.test",
      first_name: "Jana",
      last_name: "Nová",
      date_joined: "2026-07-19T09:00:00Z",
      email_verified_at: "2026-07-19T09:01:00Z",
    },
    profiles: [],
    check_ins: [],
    owned_guardian_memberships: [],
    watched_memberships: [],
    sent_invitations: [],
    received_invitations: [],
    owned_incidents: [],
    received_incidents: [],
    push_devices: [],
  } satisfies AccountExport;
  request.mockResolvedValueOnce(exported);

  await expect(useProductStore.getState().exportAccountData()).resolves.toBe(exported);
  expect(request).toHaveBeenCalledWith("/api/v1/account/export/");
  expect(Object.values(useProductStore.getState())).not.toContain(exported);
});

it("reports registration-only push diagnostics and deactivates only after server confirmation", async () => {
  const device = {
    id: "device-1",
    installation_id: "installation-1",
    platform: "ios" as const,
    active: true,
    last_seen_at: "2026-07-19T09:00:00Z",
  };
  request.mockResolvedValueOnce([device]);

  const diagnostics = await useProductStore.getState().loadPushDevices();
  expect(diagnostics).toMatchObject({
    registration_state: "active",
    active_device_count: 1,
    delivery_guaranteed: false,
  });

  let confirmDeactivation: (() => void) | undefined;
  request.mockReturnValueOnce(new Promise<void>((resolve) => (confirmDeactivation = resolve)));
  const deactivation = useProductStore.getState().deactivatePushDevice("device-1");
  expect(useProductStore.getState().pushDevices[0].active).toBe(true);
  confirmDeactivation?.();
  await deactivation;
  expect(useProductStore.getState().pushDevices[0].active).toBe(false);
  expect(useProductStore.getState().pushDiagnostics?.registration_state).toBe("inactive");
});

it("preserves loaded data and marks retryable network failures", async () => {
  useProductStore.setState({ alerts: [providerAcceptedAlert] });
  request.mockRejectedValueOnce(
    Object.assign(new Error("Server není dostupný."), { name: "NetworkError" }),
  );

  await expect(useProductStore.getState().loadAlerts()).rejects.toThrow("Server není dostupný.");
  expect(useProductStore.getState().alerts).toEqual([providerAcceptedAlert]);
  expect(useProductStore.getState().resources.alerts).toMatchObject({
    status: "error",
    error: { retryable: true, status: null },
  });
});

it("does not restore private data when an in-flight request finishes after reset", async () => {
  let finishLoading: ((alerts: AlertIncident[]) => void) | undefined;
  request.mockReturnValueOnce(
    new Promise<AlertIncident[]>((resolve) => {
      finishLoading = resolve;
    }),
  );

  const loading = useProductStore.getState().loadAlerts();
  useProductStore.getState().reset();
  finishLoading?.([providerAcceptedAlert]);
  await loading;

  expect(useProductStore.getState().alerts).toEqual([]);
  expect(useProductStore.getState().resources.alerts.status).toBe("idle");
});

it("evicts incident and location data immediately when profile access is revoked", () => {
  useProductStore.setState({ alerts: [providerAcceptedAlert], alertDetails: { [providerAcceptedAlert.id]: { ...providerAcceptedAlert, last_known_location: { latitude: "50.1", longitude: "14.4", accuracy_meters: "10", recorded_at: "2026-07-19T09:00:00Z", is_live: false } } } });
  useProductStore.getState().evictProfileAccess(providerAcceptedAlert.profile_id);
  expect(useProductStore.getState().alerts).toEqual([]);
  expect(useProductStore.getState().alertDetails).toEqual({});
});

it("does not render a cached incident after the server revokes access", async () => {
  useProductStore.setState({ alerts: [providerAcceptedAlert], alertDetails: { [providerAcceptedAlert.id]: providerAcceptedAlert } });
  request.mockRejectedValueOnce(Object.assign(new Error("Nenalezeno"), { status: 404 }));
  await expect(useProductStore.getState().loadAlert(providerAcceptedAlert.id)).rejects.toThrow("Nenalezeno");
  expect(useProductStore.getState().alerts).toEqual([]);
  expect(useProductStore.getState().alertDetails).toEqual({});
});
