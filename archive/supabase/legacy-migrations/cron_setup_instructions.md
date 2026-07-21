# RETIRED — DO NOT RUN

This document is preserved only as evidence of the former Supabase deployment. Running any command
below can reactivate a second deadline scheduler and is prohibited. The supported scheduler is the
Django `sweep_deadlines` process defined in `deploy/runtime-contract.json`.

## Historical cron setup

The former MVP enabled `pg_cron` and `pg_net` in Supabase, then scheduled an HTTP request to the
retired `check-deadlines` Edge Function every five minutes. An external cron service was also
considered as an alternative.

The exact historical SQL is retained in `cron_check_deadlines.sql` for audit. It must not be copied
into any live database or CI workflow. During cutover, operators must instead prove that the old
job and Edge Function are disabled as required by `docs/migration/supabase-cutover.md`.
