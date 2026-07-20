import { create } from "zustand";

import { apiRequest } from "@/lib/api";
import { getInstallationId } from "@/lib/installation";
import { syncIncidentBadge } from "@/lib/notificationBadges";
import type {
  AccountExport,
  AlertIncident,
  CheckInHistoryFilter,
  CheckInHistoryPage,
  CheckInStatistics,
  ProductDataError,
  ProductPeriodFilter,
  ProductResource,
  ProductResourceState,
  ProfileTimelinePage,
  PushDevice,
  PushDeviceDiagnostics,
} from "@/types/product";

const resourceNames: ProductResource[] = [
  "history",
  "statistics",
  "timeline",
  "alerts",
  "alertDetail",
  "alertAcknowledgement",
  "accountExport",
  "pushDevices",
];

const idleResource = (): ProductResourceState => ({
  status: "idle",
  error: null,
  lastLoadedAt: null,
});

const initialResources = (): Record<ProductResource, ProductResourceState> =>
  Object.fromEntries(resourceNames.map((name) => [name, idleResource()])) as Record<
    ProductResource,
    ProductResourceState
  >;

function productError(error: unknown): ProductDataError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : null;
  const normalizedStatus = status !== null && Number.isFinite(status) ? status : null;
  const name = error instanceof Error ? error.name : "";
  return {
    message: error instanceof Error ? error.message : "Data se nepodařilo načíst.",
    status: normalizedStatus,
    retryable:
      name === "NetworkError" ||
      normalizedStatus === 408 ||
      normalizedStatus === 429 ||
      (normalizedStatus !== null && normalizedStatus >= 500),
  };
}

function queryString(values: Record<string, string | number | undefined>): string {
  const entries = Object.entries(values).filter((entry): entry is [string, string | number] =>
    entry[1] !== undefined,
  );
  return entries.length
    ? `?${entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}`
    : "";
}

function periodQuery(filter: ProductPeriodFilter): Record<string, string | undefined> {
  return { profile: filter.profile, from: filter.from, to: filter.to };
}

const TIMELINE_PAGE_SIZE = 50;

function timelinePagePath(profileId: string, cursorUrl?: string): string {
  const pathname = `/api/v1/profiles/${encodeURIComponent(profileId)}/timeline/`;
  if (!cursorUrl) return `${pathname}?page_size=${TIMELINE_PAGE_SIZE}`;
  const apiMarker = cursorUrl.indexOf("/api/");
  const pathWithQuery = apiMarker >= 0 ? cursorUrl.slice(apiMarker) : cursorUrl;
  const withoutFragment = pathWithQuery.split("#", 1)[0];
  const queryMarker = withoutFragment.indexOf("?");
  const cursorPath = queryMarker >= 0 ? withoutFragment.slice(0, queryMarker) : withoutFragment;
  const query = queryMarker >= 0 ? withoutFragment.slice(queryMarker + 1) : "";
  const hasCursor = query.split("&").some((part) => part.split("=", 1)[0] === "cursor");
  if (cursorPath !== pathname || !hasCursor) {
    throw new Error("Server vrátil neplatný odkaz na další stránku časové osy.");
  }
  return `${cursorPath}?${query}`;
}

function appendTimelinePage(
  current: ProfileTimelinePage,
  nextPage: ProfileTimelinePage,
): ProfileTimelinePage {
  const seen = new Set<string>();
  const results = [...current.results, ...nextPage.results].filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
  return {
    previous: current.previous,
    next: nextPage.next,
    results,
  };
}

interface ProductState {
  history: CheckInHistoryPage | null;
  statistics: CheckInStatistics | null;
  timeline: ProfileTimelinePage | null;
  timelineProfileId: string | null;
  alerts: AlertIncident[];
  alertDetails: Record<string, AlertIncident>;
  pushDevices: PushDevice[];
  pushDiagnostics: PushDeviceDiagnostics | null;
  resources: Record<ProductResource, ProductResourceState>;
  loadHistory: (filter?: CheckInHistoryFilter) => Promise<CheckInHistoryPage>;
  loadStatistics: (filter?: ProductPeriodFilter) => Promise<CheckInStatistics>;
  loadTimeline: (profileId: string) => Promise<ProfileTimelinePage>;
  loadMoreTimeline: (profileId: string) => Promise<ProfileTimelinePage | null>;
  loadAlerts: () => Promise<AlertIncident[]>;
  loadAlert: (alertId: string) => Promise<AlertIncident>;
  acknowledgeAlert: (alertId: string) => Promise<AlertIncident>;
  removeCheckInLocation: (checkInId: string) => Promise<void>;
  exportAccountData: () => Promise<AccountExport>;
  loadPushDevices: () => Promise<PushDeviceDiagnostics>;
  deactivatePushDevice: (deviceId: string) => Promise<void>;
  evictProfileAccess: (profileId: string) => void;
  clearResourceError: (resource: ProductResource) => void;
  reset: () => void;
}

function replaceAlert(alerts: AlertIncident[], alert: AlertIncident): AlertIncident[] {
  const index = alerts.findIndex((item) => item.id === alert.id);
  if (index < 0) return [alert, ...alerts];
  return alerts.map((item) => (item.id === alert.id ? alert : item));
}

export const useProductStore = create<ProductState>((set, get) => {
  let accountEpoch = 0;
  let alertMutationRevision = 0;
  let pushMutationRevision = 0;
  let locationMutationRevision = 0;
  const requestVersions = Object.fromEntries(resourceNames.map((name) => [name, 0])) as Record<
    ProductResource,
    number
  >;

  interface RequestTicket {
    resource: ProductResource;
    version: number;
    epoch: number;
  }

  const isCurrent = (ticket: RequestTicket): boolean =>
    ticket.epoch === accountEpoch && requestVersions[ticket.resource] === ticket.version;

  const isSameAccount = (ticket: RequestTicket): boolean => ticket.epoch === accountEpoch;

  const start = (resource: ProductResource): RequestTicket => {
    const ticket = {
      resource,
      version: ++requestVersions[resource],
      epoch: accountEpoch,
    };
    set((state) => ({
      resources: {
        ...state.resources,
        [resource]: { ...state.resources[resource], status: "loading", error: null },
      },
    }));
    return ticket;
  };

  const succeed = (ticket: RequestTicket): void => {
    if (!isCurrent(ticket)) return;
    set((state) => ({
      resources: {
        ...state.resources,
        [ticket.resource]: { status: "ready", error: null, lastLoadedAt: new Date().toISOString() },
      },
    }));
  };

  const fail = (ticket: RequestTicket, error: unknown): never => {
    if (isCurrent(ticket)) {
      set((state) => ({
        resources: {
          ...state.resources,
          [ticket.resource]: {
            ...state.resources[ticket.resource],
            status: "error",
            error: productError(error),
          },
        },
      }));
    }
    throw error;
  };

  return {
    history: null,
    statistics: null,
    timeline: null,
    timelineProfileId: null,
    alerts: [],
    alertDetails: {},
    pushDevices: [],
    pushDiagnostics: null,
    resources: initialResources(),

    loadHistory: async (filter = {}) => {
      const ticket = start("history");
      const mutationRevision = locationMutationRevision;
      try {
        const result = await apiRequest<CheckInHistoryPage>(
          `/api/v1/check-ins/${queryString({
            ...periodQuery(filter),
            page: filter.page,
            page_size: filter.pageSize,
          })}`,
        );
        if (isCurrent(ticket) && mutationRevision === locationMutationRevision) {
          set({ history: result });
        }
        succeed(ticket);
        return result;
      } catch (error) {
        return fail(ticket, error);
      }
    },

    loadStatistics: async (filter = {}) => {
      const ticket = start("statistics");
      try {
        const result = await apiRequest<CheckInStatistics>(
          `/api/v1/statistics/${queryString(periodQuery(filter))}`,
        );
        if (isCurrent(ticket)) set({ statistics: result });
        succeed(ticket);
        return result;
      } catch (error) {
        return fail(ticket, error);
      }
    },

    loadTimeline: async (profileId) => {
      const ticket = start("timeline");
      const mutationRevision = locationMutationRevision;
      if (get().timelineProfileId !== profileId) {
        set({ timeline: null, timelineProfileId: profileId });
      }
      try {
        const result = await apiRequest<ProfileTimelinePage>(timelinePagePath(profileId));
        if (
          isCurrent(ticket) &&
          mutationRevision === locationMutationRevision &&
          get().timelineProfileId === profileId
        ) {
          set({ timeline: result });
        }
        succeed(ticket);
        return result;
      } catch (error) {
        return fail(ticket, error);
      }
    },

    loadMoreTimeline: async (profileId) => {
      const current = get().timelineProfileId === profileId ? get().timeline : null;
      if (!current?.next) return current;
      const ticket = start("timeline");
      const mutationRevision = locationMutationRevision;
      try {
        const nextPage = await apiRequest<ProfileTimelinePage>(
          timelinePagePath(profileId, current.next),
        );
        const latest = get().timelineProfileId === profileId ? get().timeline : null;
        const merged = latest ? appendTimelinePage(latest, nextPage) : nextPage;
        if (
          isCurrent(ticket) &&
          mutationRevision === locationMutationRevision &&
          get().timelineProfileId === profileId
        ) {
          set({ timeline: merged });
        }
        succeed(ticket);
        return merged;
      } catch (error) {
        return fail(ticket, error);
      }
    },

    loadAlerts: async () => {
      const ticket = start("alerts");
      const mutationRevision = alertMutationRevision;
      try {
        const result = await apiRequest<AlertIncident[]>("/api/v1/alerts/");
        if (isCurrent(ticket) && mutationRevision === alertMutationRevision) {
          set((state) => ({
            alerts: result,
            alertDetails: {
              ...state.alertDetails,
              ...Object.fromEntries(result.map((alert) => [alert.id, alert])),
            },
          }));
          await syncIncidentBadge(result);
        }
        succeed(ticket);
        return result;
      } catch (error) {
        return fail(ticket, error);
      }
    },

    loadAlert: async (alertId) => {
      const ticket = start("alertDetail");
      const mutationRevision = alertMutationRevision;
      try {
        const result = await apiRequest<AlertIncident>(`/api/v1/alerts/${alertId}/`);
        if (isCurrent(ticket) && mutationRevision === alertMutationRevision) {
          set((state) => ({
            alerts: replaceAlert(state.alerts, result),
            alertDetails: { ...state.alertDetails, [result.id]: result },
          }));
        }
        succeed(ticket);
        return result;
      } catch (error) {
        const status = productError(error).status;
        if (status === 403 || status === 404) {
          set((state) => {
            const alertDetails = { ...state.alertDetails };
            delete alertDetails[alertId];
            const alerts = state.alerts.filter((item) => item.id !== alertId);
            void syncIncidentBadge(alerts);
            return { alertDetails, alerts };
          });
        }
        return fail(ticket, error);
      }
    },

    acknowledgeAlert: async (alertId) => {
      const ticket = start("alertAcknowledgement");
      try {
        const result = await apiRequest<AlertIncident>(
          `/api/v1/alerts/${alertId}/acknowledge/`,
          { method: "POST" },
        );
        // Update only after the server returns its canonical acknowledgement record.
        if (isSameAccount(ticket)) {
          alertMutationRevision += 1;
          set((state) => ({
            alerts: replaceAlert(state.alerts, result),
            alertDetails: { ...state.alertDetails, [result.id]: result },
          }));
          await syncIncidentBadge(get().alerts);
        }
        succeed(ticket);
        return result;
      } catch (error) {
        return fail(ticket, error);
      }
    },

    removeCheckInLocation: async (checkInId) => {
      const mutationEpoch = accountEpoch;
      await apiRequest<void>(
        `/api/v1/check-ins/${encodeURIComponent(checkInId)}/location/`,
        { method: "DELETE" },
      );
      if (mutationEpoch !== accountEpoch) return;
      locationMutationRevision += 1;
      set((state) => ({
        history: state.history
          ? {
              ...state.history,
              results: state.history.results.map((item) =>
                item.id === checkInId ? { ...item, has_location: false } : item,
              ),
            }
          : null,
        timeline: state.timeline
          ? {
              ...state.timeline,
              results: state.timeline.results.map((event) =>
                event.event_type === "checkin.confirmed" &&
                event.details.check_in_id === checkInId
                  ? { ...event, details: { ...event.details, has_location: false } }
                  : event,
              ),
            }
          : null,
      }));
    },

    exportAccountData: async () => {
      const ticket = start("accountExport");
      try {
        // The export contains sensitive data, so it is returned to the caller and not retained.
        const result = await apiRequest<AccountExport>("/api/v1/account/export/");
        succeed(ticket);
        return result;
      } catch (error) {
        return fail(ticket, error);
      }
    },

    loadPushDevices: async () => {
      const ticket = start("pushDevices");
      const mutationRevision = pushMutationRevision;
      try {
        const [devices, installationId] = await Promise.all([
          apiRequest<PushDevice[]>("/api/v1/push-devices/"),
          getInstallationId(),
        ]);
        const currentDevice = devices.find((device) => device.installation_id === installationId) ?? null;
        const diagnostics: PushDeviceDiagnostics = {
          current_installation_id: installationId,
          current_device: currentDevice,
          active_device_count: devices.filter((device) => device.active).length,
          registration_state: currentDevice
            ? currentDevice.active
              ? "active"
              : "inactive"
            : "not_registered",
          delivery_guaranteed: false,
        };
        if (isCurrent(ticket) && mutationRevision === pushMutationRevision) {
          set({ pushDevices: devices, pushDiagnostics: diagnostics });
        }
        succeed(ticket);
        return diagnostics;
      } catch (error) {
        return fail(ticket, error);
      }
    },

    deactivatePushDevice: async (deviceId) => {
      const ticket = start("pushDevices");
      try {
        await apiRequest<void>(`/api/v1/push-devices/${deviceId}/`, { method: "DELETE" });
        if (!isSameAccount(ticket)) return;
        pushMutationRevision += 1;
        const remaining = get().pushDevices.map((device) =>
          device.id === deviceId ? { ...device, active: false } : device,
        );
        const installationId = get().pushDiagnostics?.current_installation_id ?? (await getInstallationId());
        const currentDevice = remaining.find((device) => device.installation_id === installationId) ?? null;
        set({
          pushDevices: remaining,
          pushDiagnostics: {
            current_installation_id: installationId,
            current_device: currentDevice,
            active_device_count: remaining.filter((device) => device.active).length,
            registration_state: currentDevice?.active ? "active" : currentDevice ? "inactive" : "not_registered",
            delivery_guaranteed: false,
          },
        });
        succeed(ticket);
      } catch (error) {
        return fail(ticket, error);
      }
    },

    evictProfileAccess: (profileId) => {
      alertMutationRevision += 1;
      set((state) => {
        const alerts = state.alerts.filter((item) => item.profile_id !== profileId);
        const alertDetails = Object.fromEntries(Object.entries(state.alertDetails).filter(([, item]) => item.profile_id !== profileId));
        void syncIncidentBadge(alerts);
        return { alerts, alertDetails };
      });
    },

    clearResourceError: (resource) => {
      set((state) => ({
        resources: {
          ...state.resources,
          [resource]: {
            ...state.resources[resource],
            status: state.resources[resource].lastLoadedAt ? "ready" : "idle",
            error: null,
          },
        },
      }));
    },

    reset: () => {
      accountEpoch += 1;
      alertMutationRevision += 1;
      pushMutationRevision += 1;
      locationMutationRevision += 1;
      set({
        history: null,
        statistics: null,
        timeline: null,
        timelineProfileId: null,
        alerts: [],
        alertDetails: {},
        pushDevices: [],
        pushDiagnostics: null,
        resources: initialResources(),
      });
      void syncIncidentBadge([]);
    },
  };
});
