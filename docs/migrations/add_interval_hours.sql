-- Add interval_hours column to check_in_profiles
ALTER TABLE check_in_profiles
ADD COLUMN IF NOT EXISTS interval_hours integer DEFAULT 24;

-- Update existing rows
UPDATE check_in_profiles
SET interval_hours = 24
WHERE interval_hours IS NULL;

-- Add constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'interval_hours_valid'
    AND conrelid = 'check_in_profiles'::regclass
  ) THEN
    ALTER TABLE check_in_profiles
    ADD CONSTRAINT interval_hours_valid
    CHECK (interval_hours IN (12, 24, 48, 168));
  END IF;
END $$;
