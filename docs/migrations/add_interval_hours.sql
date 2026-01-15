-- Add check_in_interval_hours column to check_in_profiles
ALTER TABLE check_in_profiles
ADD COLUMN IF NOT EXISTS check_in_interval_hours integer DEFAULT 24;

-- Update existing rows
UPDATE check_in_profiles
SET check_in_interval_hours = 24
WHERE check_in_interval_hours IS NULL;

-- Add constraint
ALTER TABLE check_in_profiles
ADD CONSTRAINT check_in_interval_hours_valid
CHECK (check_in_interval_hours IN (12, 24, 48, 168));
