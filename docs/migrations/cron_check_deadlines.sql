-- Migration: Cron job for deadline checking
-- Run this in Supabase SQL Editor after enabling pg_cron extension

-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Create cron job to call Edge Function every 5 minutes
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

-- To verify the job is scheduled:
-- SELECT * FROM cron.job;

-- To unschedule (if needed):
-- SELECT cron.unschedule('check-deadlines-job');
