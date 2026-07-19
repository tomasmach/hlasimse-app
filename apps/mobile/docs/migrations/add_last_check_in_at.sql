-- Add last_check_in_at column to check_in_profiles
ALTER TABLE check_in_profiles
ADD COLUMN IF NOT EXISTS last_check_in_at timestamp with time zone;

-- Populate from existing check_ins
UPDATE check_in_profiles p
SET last_check_in_at = (
  SELECT MAX(created_at)
  FROM check_ins
  WHERE check_in_profile_id = p.id
);
