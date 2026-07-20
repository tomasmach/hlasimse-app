jest.mock("@/lib/api", () => ({ apiRequest: jest.fn() }));
jest.mock("@/lib/installation", () => ({ getInstallationId: jest.fn() }));

import { apiRequest } from "@/lib/api";
import { getInstallationId } from "@/lib/installation";
import { useProductStore } from "@/stores/product";
import type { AccountExport, AlertIncident, CheckInHistoryPage } from "@/types/product";

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
  const timeline = { next: null, previous: null, results: [{ id: "event-1", event_type: "profile.paused", occurred_at: "2026-07-19T10:00:00Z", profile_id: "profile-1", details: { automatic: false, deadline_generation: 4 } }] } as const;
  request.mockResolvedValueOnce(timeline);
  await expect(useProductStore.getState().loadTimeline("profile-1")).resolves.toEqual(timeline);
  expect(request).toHaveBeenCalledWith("/api/v1/profiles/profile-1/timeline/?page_size=100");
  expect(useProductStore.getState().timeline?.results[0].event_type).toBe("profile.paused");
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
