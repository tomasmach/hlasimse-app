export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  is_premium: boolean;
  premium_expires_at: string | null;
  trial_used: boolean;
  created_at: string;
  updated_at: string;
}

export interface CheckInProfile {
  id: string;
  owner_id: string;
  name: string;
  avatar_url: string | null;
  interval_hours: number;
  next_deadline: string | null;
  last_check_in_at: string | null;
  last_known_lat: number | null;
  last_known_lng: number | null;
  is_paused: boolean;
  paused_until: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Guardian {
  id: string;
  check_in_profile_id: string;
  user_id: string;
  created_at: string;
}

export interface CheckIn {
  id: string;
  check_in_profile_id: string;
  checked_in_at: string;
  lat: number | null;
  lng: number | null;
  was_offline: boolean;
  synced_at: string | null;
}

export interface Alert {
  id: string;
  check_in_profile_id: string;
  triggered_at: string;
  resolved_at: string | null;
  alert_type: "push" | "sms";
  notified_guardians: string[];
}

export interface PushToken {
  id: string;
  user_id: string;
  token: string;
  platform: "ios" | "android";
  created_at: string;
  updated_at: string;
}
