# Retired Supabase implementation — do not run

This directory is read-only historical evidence for migration and security review. Nothing below
is part of the supported runtime. Do not deploy the Edge Functions, execute the SQL, enable the
cron jobs, or restore Supabase credentials.

Django/PostgreSQL is the only supported backend and the Django deadline sweeper is the only
permitted scheduler. Enabling any archived scheduler can create split-brain safety state and
duplicate or missed incidents. The controlled retirement procedure is documented in
`docs/migration/supabase-cutover.md`.
