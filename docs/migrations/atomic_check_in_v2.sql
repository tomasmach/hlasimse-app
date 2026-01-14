-- Migration: Atomic Check-In Function v2
-- Adds GPS coordinates support and auto-resolves active alerts

CREATE OR REPLACE FUNCTION atomic_check_in(
  p_profile_id UUID,
  p_checked_in_at TIMESTAMPTZ,
  p_next_deadline TIMESTAMPTZ,
  p_was_offline BOOLEAN DEFAULT FALSE,
  p_lat FLOAT DEFAULT NULL,
  p_lng FLOAT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  owner_id UUID,
  name TEXT,
  interval_hours INTEGER,
  next_deadline TIMESTAMPTZ,
  last_check_in_at TIMESTAMPTZ,
  last_known_lat FLOAT,
  last_known_lng FLOAT,
  is_active BOOLEAN,
  is_paused BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert check-in record with coordinates
  INSERT INTO check_ins (check_in_profile_id, checked_in_at, was_offline, lat, lng)
  VALUES (p_profile_id, p_checked_in_at, p_was_offline, p_lat, p_lng);

  -- Auto-resolve any active alerts for this profile
  UPDATE alerts
  SET resolved_at = NOW()
  WHERE check_in_profile_id = p_profile_id
    AND resolved_at IS NULL;

  -- Update profile with new deadline, last check-in time, and coordinates
  RETURN QUERY
  UPDATE check_in_profiles
  SET
    last_check_in_at = p_checked_in_at,
    next_deadline = p_next_deadline,
    last_known_lat = COALESCE(p_lat, last_known_lat),
    last_known_lng = COALESCE(p_lng, last_known_lng),
    updated_at = NOW()
  WHERE check_in_profiles.id = p_profile_id
  RETURNING
    check_in_profiles.id,
    check_in_profiles.owner_id,
    check_in_profiles.name,
    check_in_profiles.interval_hours,
    check_in_profiles.next_deadline,
    check_in_profiles.last_check_in_at,
    check_in_profiles.last_known_lat,
    check_in_profiles.last_known_lng,
    check_in_profiles.is_active,
    check_in_profiles.is_paused,
    check_in_profiles.created_at,
    check_in_profiles.updated_at;
END;
$$;
