-- Migration: Add UNIQUE constraint to check_in_profiles.owner_id
-- Purpose: Ensures each user can only have one check-in profile at the database level
-- This enables the race-condition handling (PostgreSQL error code 23505) in stores/checkin.ts

ALTER TABLE check_in_profiles
ADD CONSTRAINT check_in_profiles_owner_id_key
UNIQUE (owner_id);
