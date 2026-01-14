# Database Constraints

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
