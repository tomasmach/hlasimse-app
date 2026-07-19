# Cron Job Setup for check-deadlines

## Option 1: Using Supabase Dashboard (Recommended for MVP)

1. Go to Supabase Dashboard > Database > Extensions
2. Enable `pg_cron` and `pg_net` extensions
3. Go to SQL Editor and run:

```sql
SELECT cron.schedule(
  'check-deadlines-job',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/check-deadlines',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

## Option 2: Using External Cron (Alternative)

Use services like:
- Vercel Cron Jobs
- GitHub Actions scheduled workflows
- AWS EventBridge

Example GitHub Action:
```yaml
name: Check Deadlines
on:
  schedule:
    - cron: '*/5 * * * *'
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/check-deadlines \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}"
```

## Verify Cron Job

```sql
SELECT * FROM cron.job;
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```
