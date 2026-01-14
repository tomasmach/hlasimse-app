# Database Requirements

## Required Constraints

### check_in_profiles Table

**UNIQUE Constraint on owner_id:**
- A UNIQUE constraint should be added to the `owner_id` column in the `check_in_profiles` table
- This prevents duplicate profiles for the same user at the database level
- SQL to add constraint:
  ```sql
  ALTER TABLE check_in_profiles
  ADD CONSTRAINT check_in_profiles_owner_id_key
  UNIQUE (owner_id);
  ```

**Note:** The application code in `stores/checkin.ts` already handles:
1. Pre-check for existing profiles (defense in depth)
2. Unique violation error handling (PostgreSQL error code 23505)
3. Returns existing profile when duplicate is detected

This ensures the app works correctly both with and without the DB constraint, but the constraint is recommended to prevent race conditions.

## Required Functions

### atomic_check_in RPC

**Purpose:** Performs check-in and profile update atomically in a single transaction to prevent inconsistent state.

**Migration:** See `docs/migrations/atomic_check_in.sql`

**Why Required:**
- Ensures check-in record insertion and profile update happen together or not at all
- Prevents inconsistent state where a check-in is recorded but the profile deadline isn't updated (or vice versa)
- Uses PostgreSQL transactions to guarantee atomicity

**Used by:** `stores/checkin.ts` checkIn() function
