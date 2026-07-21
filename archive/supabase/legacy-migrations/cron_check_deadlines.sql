-- RETIRED — DO NOT RUN.
--
-- Historical Supabase scheduler evidence only. Executing this file can activate a second
-- deadline scheduler and cause duplicate or missed safety incidents. Django/PostgreSQL and
-- deploy/runtime-contract.json define the only supported runtime.

-- Historical migration: cron job for deadline checking.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT USAGE ON SCHEMA net TO postgres;

SELECT cron.schedule(
  'check-deadlines-job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/check-deadlines',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Historical verification query:
-- SELECT * FROM cron.job;

-- Historical retirement query:
-- SELECT cron.unschedule('check-deadlines-job');
