import type { AuthUser, Paginated } from "@/types/api";

export type IsoDateTime = string;

export interface CheckInHistoryItem {
  id: string;
  profile_id: string;
  profile_name: string;
  accepted_at: IsoDateTime;
  client_recorded_at: IsoDateTime | null;
  deadline_generation: number;
  response_deadline_at: IsoDateTime | null;
  /** Only records confirmed by the Django API are included in history. */
  server_confirmed: true;
  resolved_incident_count: number;
  /** Set by the server; never infer this from the device clock. */
  submitted_from_queue: boolean;
}

export type CheckInHistoryPage = Paginated<CheckInHistoryItem>;

export interface ProductPeriodFilter {
  profile?: string;
  from?: IsoDateTime;
  to?: IsoDateTime;
}

export interface CheckInHistoryFilter extends ProductPeriodFilter {
  page?: number;
  pageSize?: number;
}

export interface CheckInStatistics {
  period: {
    from: IsoDateTime | null;
    to: IsoDateTime | null;
  };
  total_check_ins: number;
  on_time_check_ins: number;
  incident_count: number;
  definitions: {
    total_check_ins: string;
    on_time_check_ins: string;
    incident_count: string;
  };
}

export type ProfileTimelineEventType =
  | "profile.created"
  | "profile.paused"
  | "profile.resumed"
  | "profile.archived"
  | "checkin.confirmed"
  | "incident.opened"
  | "incident.resolved";

interface ProfileTimelineEventBase<TType extends ProfileTimelineEventType, TDetails> {
  id: string;
  event_type: TType;
  occurred_at: IsoDateTime;
  profile_id: string;
  details: TDetails;
}

export type ProfileTimelineEvent =
  | ProfileTimelineEventBase<
      "profile.created",
      {
        enabled: boolean;
        is_paused: boolean;
        interval_seconds: number;
        deadline_generation: number;
      }
    >
  | ProfileTimelineEventBase<
      "profile.paused" | "profile.resumed",
      {
        automatic: boolean;
        deadline_generation: number;
        has_scheduled_resume: boolean;
      }
    >
  | ProfileTimelineEventBase<
      "profile.archived",
      {
        deadline_generation: number;
        revoked_membership_count: number;
        revoked_invitation_count: number;
      }
    >
  | ProfileTimelineEventBase<
      "checkin.confirmed",
      {
        check_in_id: string;
        deadline_generation: number;
        next_deadline_at: IsoDateTime | null;
        submitted_from_queue: boolean;
        resolved_incident_count: number;
      }
    >
  | ProfileTimelineEventBase<
      "incident.opened",
      {
        incident_id: string;
        deadline_at: IsoDateTime;
        deadline_generation: number;
      }
    >
  | ProfileTimelineEventBase<
      "incident.resolved",
      {
        incident_id: string;
        resolved_at: IsoDateTime;
        resolved_by_check_in_id: string;
      }
    >;

export interface ProfileTimelinePage {
  next: string | null;
  previous: string | null;
  results: ProfileTimelineEvent[];
}

export type AlertIncidentStatus = "open" | "resolved";

export type DeliveryAttemptStatus =
  | "queued"
  | "ticket_received"
  | "receipt_processing"
  | "delivered"
  | "retryable_failure"
  | "permanent_failure"
  | "dead_letter";

/**
 * `sent_to_provider` means Expo accepted a ticket or is processing its receipt.
 * It must never be presented as proof that a guardian's device received the alert.
 */
export type AlertDeliveryState =
  | "no_delivery_record"
  | "pending"
  | "sent_to_provider"
  | "delivered"
  | "failed";

export interface AlertDeliveryStatus {
  state: AlertDeliveryState;
  attempt_counts: Partial<Record<DeliveryAttemptStatus, number>>;
}

export interface AlertAcknowledgement {
  user_id: string;
  acknowledged_at: IsoDateTime;
}

export interface AlertLastKnownLocation {
  latitude: string;
  longitude: string;
  accuracy_meters: string | null;
  recorded_at: IsoDateTime;
  /** The API currently exposes only the last confirmed check-in location. */
  is_live: false;
}

export interface AlertIncident {
  id: string;
  profile_id: string;
  profile_name: string;
  deadline_generation: number;
  deadline_at: IsoDateTime;
  opened_at: IsoDateTime;
  resolved_at: IsoDateTime | null;
  status: AlertIncidentStatus;
  acknowledgements: AlertAcknowledgement[];
  last_known_location: AlertLastKnownLocation | null;
  delivery_status: AlertDeliveryStatus;
}

export interface PushDevice {
  id: string;
  installation_id: string;
  platform: "ios" | "android";
  active: boolean;
  last_seen_at: IsoDateTime;
}

/** Registration diagnostics only; this is not an end-to-end delivery guarantee. */
export interface PushDeviceDiagnostics {
  current_installation_id: string;
  current_device: PushDevice | null;
  active_device_count: number;
  registration_state: "active" | "inactive" | "not_registered";
  delivery_guaranteed: false;
}

export interface ExportProfile {
  id: string;
  name: string;
  interval_seconds: number;
  enabled: boolean;
  is_paused: boolean;
  paused_until: IsoDateTime | null;
  last_checked_in_at: IsoDateTime | null;
  next_deadline_at: IsoDateTime | null;
  deadline_generation: number;
  archived_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface ExportCheckIn {
  id: string;
  profile_id: string;
  accepted_at: IsoDateTime;
  client_recorded_at: IsoDateTime | null;
  latitude: string | null;
  longitude: string | null;
  location_accuracy_meters: string | null;
  deadline_generation: number;
  response_deadline_at: IsoDateTime | null;
  submitted_from_queue: boolean;
}

export interface ExportGuardianMembership {
  id: string;
  profile_id: string;
  status: "active" | "revoked";
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  guardian__email?: string;
  profile__name?: string;
  profile__owner__first_name?: string;
  profile__owner__last_name?: string;
}

export interface ExportGuardianInvitation {
  id: string;
  profile_id: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  email?: string;
  profile__name?: string;
}

export interface ExportIncident {
  id: string;
  profile_id: string;
  deadline_at: IsoDateTime;
  opened_at: IsoDateTime;
  resolved_at: IsoDateTime | null;
  status: AlertIncidentStatus;
  deadline_generation?: number;
  resolved_by_check_in_id?: string | null;
}

export interface AccountExport {
  schema_version: 1;
  account: AuthUser;
  profiles: ExportProfile[];
  check_ins: ExportCheckIn[];
  owned_guardian_memberships: ExportGuardianMembership[];
  watched_memberships: ExportGuardianMembership[];
  sent_invitations: ExportGuardianInvitation[];
  received_invitations: ExportGuardianInvitation[];
  owned_incidents: ExportIncident[];
  received_incidents: ExportIncident[];
  push_devices: PushDevice[];
}

export type ProductResource =
  | "history"
  | "statistics"
  | "timeline"
  | "alerts"
  | "alertDetail"
  | "alertAcknowledgement"
  | "accountExport"
  | "pushDevices";

export interface ProductDataError {
  message: string;
  status: number | null;
  retryable: boolean;
}

export interface ProductResourceState {
  status: "idle" | "loading" | "ready" | "error";
  error: ProductDataError | null;
  lastLoadedAt: IsoDateTime | null;
}
