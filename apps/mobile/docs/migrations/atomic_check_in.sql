-- Migration: Atomic Check-In Function
-- This function performs check-in and profile update atomically in a transaction

CREATE OR REPLACE FUNCTION atomic_check_in(
  p_profile_id UUID,
  p_checked_in_at TIMESTAMPTZ,
  p_next_deadline TIMESTAMPTZ,
  p_was_offline BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id UUID,
  owner_id UUID,
  name TEXT,
  interval_hours INTEGER,
  next_deadline TIMESTAMPTZ,
  last_check_in_at TIMESTAMPTZ,
  is_active BOOLEAN,
  is_paused BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert check-in record
  INSERT INTO check_ins (check_in_profile_id, checked_in_at, was_offline)
  VALUES (p_profile_id, p_checked_in_at, p_was_offline);

  -- Update profile with new deadline and last check-in time
  -- Return the updated profile
  RETURN QUERY
  UPDATE check_in_profiles
  SET
    last_check_in_at = p_checked_in_at,
    next_deadline = p_next_deadline,
    updated_at = NOW()
  WHERE check_in_profiles.id = p_profile_id
  RETURNING
    check_in_profiles.id,
    check_in_profiles.owner_id,
    check_in_profiles.name,
    check_in_profiles.interval_hours,
    check_in_profiles.next_deadline,
    check_in_profiles.last_check_in_at,
    check_in_profiles.is_active,
    check_in_profiles.is_paused,
    check_in_profiles.created_at,
    check_in_profiles.updated_at;
END;
$$;
