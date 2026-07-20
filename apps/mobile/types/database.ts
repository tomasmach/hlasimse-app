export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface CheckInProfile {
  id: string;
  name: string;
  interval_seconds: number;
  enabled: boolean;
  is_paused: boolean;
  paused_until: string | null;
  last_checked_in_at: string | null;
  next_deadline_at: string | null;
  deadline_generation: number;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
  // Compatibility aliases used by the current UI until the multi-profile redesign.
  interval_hours: number;
  next_deadline: string | null;
  last_check_in_at: string | null;
  is_active: boolean;
}

export interface CheckInReceipt {
  id: string;
  idempotency_key: string;
  accepted_at: string;
  deadline_generation: number;
  next_deadline_at: string | null;
  /** Server-owned provenance; true only after replay from the local queue. */
  submitted_from_queue: boolean;
}

export interface GuardianWithUser {
  id: string;
  email: string;
  display_name: string;
  status: "active" | "revoked";
  created_at: string;
  user: Pick<User, "id" | "email" | "name">;
}

export interface InviteWithInviter {
  id: string;
  profile_id: string;
  profile_name: string;
  owner_display_name: string;
  status: "pending" | "accepted" | "declined" | "expired" | "revoked";
  expires_at: string;
  created_at: string;
  inviter: Pick<User, "id" | "email" | "name">;
  check_in_profile: Pick<CheckInProfile, "id" | "name">;
}

export interface WatchedProfile {
  id: string;
  membership_id: string | null;
  name: string;
  owner_display_name: string;
  enabled: boolean;
  is_paused: boolean;
  paused_until: string | null;
  last_checked_in_at: string | null;
  next_deadline_at: string | null;
  deadline_generation: number;
  open_alert_count: number;
  next_deadline: string | null;
  last_check_in_at: string | null;
  has_active_alert: boolean;
  last_known_lat: null;
  last_known_lng: null;
}

export function normalizeProfile(profile: Omit<CheckInProfile, "interval_hours" | "next_deadline" | "last_check_in_at" | "is_active">): CheckInProfile {
  return {
    ...profile,
    interval_hours: profile.interval_seconds / 3600,
    next_deadline: profile.next_deadline_at,
    last_check_in_at: profile.last_checked_in_at,
    is_active: profile.enabled,
  };
}
