# Database Requirements

## Required Constraints

### check_in_profiles Table

**UNIQUE Constraint on owner_id:** ✅ APPLIED
- Constraint `check_in_profiles_owner_id_key` on `owner_id` column
- Prevents duplicate profiles for the same user at the database level
- Enables race-condition handling via PostgreSQL error code 23505

**Migration:** `docs/migrations/check_in_profiles_owner_id_unique.sql`

```sql
ALTER TABLE check_in_profiles
ADD CONSTRAINT check_in_profiles_owner_id_key
UNIQUE (owner_id);
```

**Application handling** (in `stores/checkin.ts` createProfile):
1. Pre-check for existing profiles (defense in depth)
2. Unique violation error handling (PostgreSQL error code 23505)
3. Returns existing profile when duplicate is detected

Concurrent inserts will now correctly trigger the 23505 unique-violation error, which the catch block handles by fetching and returning the existing profile.

## Required Functions

### atomic_check_in RPC

**Purpose:** Performs check-in and profile update atomically in a single transaction to prevent inconsistent state.

**Migration:** See `docs/migrations/atomic_check_in.sql`

**Why Required:**
- Ensures check-in record insertion and profile update happen together or not at all
- Prevents inconsistent state where a check-in is recorded but the profile deadline isn't updated (or vice versa)
- Uses PostgreSQL transactions to guarantee atomicity

**Used by:** `stores/checkin.ts` checkIn() function
