# Production operations

This runbook defines a provider-neutral operating contract for the Django service. The included
Compose topology is for local production-like verification on one machine. It is not a highly
available production platform and does not choose a hosting, database, email, monitoring, DNS, or
secret-management provider.

## Runtime contract

One immutable image runs ten process roles:

| Role | Command | Required instances |
| --- | --- | --- |
| Web/API | `gunicorn --config config/gunicorn.py config.wsgi:application` | At least 2 across failure domains in production |
| Deadline sweep | `python manage.py sweep_deadlines --watch` | At least 1; database locks make concurrent instances safe |
| Alert outbox | `python manage.py process_outbox --watch --queue alert --poll-interval 0.25` | At least 1; never shared with email delivery |
| Email outbox | `python manage.py process_outbox --watch --queue email --poll-interval 2` | At least 1 |
| Push receipts | `python manage.py fetch_push_receipts --watch` | At least 1 |
| Safety reconciliation | `python manage.py reconcile_safety_state --repair --fail-on-gaps --watch` | At least 1; only deterministic repairs |
| Safety metrics | `python manage.py emit_safety_metrics --watch --poll-interval 30` | Exactly 1 per database; stdout JSON only, with no public endpoint |
| Session cleanup | `python manage.py purge_expired_sessions --watch --poll-interval 86400` | Exactly 1, or an equivalent external daily scheduler |
| Delivery monitor | `python manage.py check_delivery_health` every 30 seconds | At least 1 plus external paging |
| Migration job | `python manage.py migrate --noinput && python manage.py createcachetable` | Exactly 1 per release |

The image runs as UID/GID 10001, has no writable application filesystem, drops Linux capabilities,
and contains pre-collected fingerprinted static assets. Gunicorn and every worker must receive
`SIGTERM` and at least 40 seconds to stop. Do not run migrations automatically from web or worker
startup; multiple replicas must never race schema deployment.

The edge proxy/load balancer must terminate TLS, overwrite (not append) `X-Forwarded-Proto`, and be
the only network path to port 8000. Set `GUNICORN_FORWARDED_ALLOW_IPS` to the proxy network or exact
proxy IPs; never use `*` on a publicly reachable container. The application defaults to HTTPS
redirects, secure cookies, one-year HSTS, and manifest-backed static files when
`DJANGO_DEBUG=false`.

Gunicorn raw access logs are intentionally disabled because verification and password-reset secrets
occur in URL paths. Django emits JSON access records keyed by route pattern and correlation ID,
without raw path parameters, query strings, request bodies, Referer, e-mail, or IP address. Configure
the edge proxy to redact these token routes as well and propagate only a valid UUID `X-Request-ID`.

## Independent safety switches

The deadline scheduler, alert delivery, and e-mail delivery have independent, fail-visible switches:

| Variable | Stops | Deliberately continues |
| --- | --- | --- |
| `DEADLINE_SWEEPER_ENABLED=false` | Materializing new due incidents | API check-ins, existing outbox delivery, durable due deadlines |
| `ALERT_OUTBOX_ENABLED=false` | Claiming and sending alert outbox events | Incident persistence, e-mail delivery, durable pending alert events |
| `EMAIL_OUTBOX_ENABLED=false` | Claiming and sending e-mail outbox events | Incident and alert delivery, durable pending e-mail events |

Apply a switch through reviewed deployment configuration and restart only the affected worker role.
The disabled process remains alive and records `healthy=false, disabled=true`; delivery health must
therefore page rather than silently treating an intentional stop as healthy. Never suppress that
alarm without an active incident owner. The `--queue all` compatibility mode stops if either outbox
switch is off, so production must keep the documented dedicated alert and e-mail workers.

Before disabling, record due-deadline and pending-outbox counts. After re-enabling, confirm the
worker heartbeat returns to `healthy=true`, wait for the durable backlog to drain, and run
`python manage.py reconcile_safety_state --repair --fail-on-gaps`. A disabled scheduler leaves each
deadline eligible for normal idempotent materialization after restart; a disabled outbox worker
never claims or mutates its pending events.

## Expired session cleanup

Django database sessions are authentication state, not domain history. Run
`python manage.py purge_expired_sessions --watch --batch-size 1000 --poll-interval 86400` as exactly
one long-running role, or run the same command without `--watch` from an external scheduler at least
daily. The command uses each session's existing `expire_date`; it does not invent or apply retention
periods to check-ins, incidents, delivery records, audit events, logs, or backups.

Cleanup is bounded to at most 10,000 rows per database statement and rechecks `expire_date` during
deletion, so a session refreshed after selection is preserved. The production-like Compose role
uses batches of 1,000. Record command failure as an operational alert because expired session rows
may retain a pseudonymous user identifier even though they can no longer authenticate.

## Required production configuration

Inject configuration from the deployment platform's secret manager. Never bake it into the image,
Compose file, CI logs, shell history, or repository.

- `DJANGO_SECRET_KEY`: unique, random, at least 50 characters.
- `DJANGO_ALLOWED_HOSTS`: exact public hostnames.
- `DATABASE_URL`: PostgreSQL connection with `sslmode=require`, `verify-ca`, or preferably
  `verify-full`; startup rejects weaker modes.
- `DATABASE_CONNECT_TIMEOUT_SECONDS`, `DATABASE_STATEMENT_TIMEOUT_MS`,
  `DATABASE_LOCK_TIMEOUT_MS`, and `DATABASE_IDLE_TRANSACTION_TIMEOUT_MS`: bounded PostgreSQL
  connection, statement, lock, and abandoned-transaction budgets. Defaults are 5 s, 30 s, 5 s,
  and 15 s. Override the statement budget per process role only after measuring that role; never
  remove the limits. Lock timeout must not exceed statement timeout.
- `APP_BASE_URL`: canonical HTTPS web origin.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` or
  `EMAIL_USE_SSL`, `DEFAULT_FROM_EMAIL`, `SERVER_EMAIL`.
- `EXPO_ACCESS_TOKEN`: production Expo access token; enhanced push security must be enabled for the
  project so unauthenticated submissions are rejected.
- `GUNICORN_FORWARDED_ALLOW_IPS`: trusted proxy addresses/CIDRs supported by Gunicorn.
- `WEB_TRUSTED_PROXY_CIDRS`: exact internal proxy addresses/CIDRs that may supply
  `X-Forwarded-For` for web authentication rate limits. Leave empty only when Gunicorn receives
  client connections directly; never include public client networks.

Also configure SPF, DKIM, and DMARC for the sending domain. The selected infrastructure must supply
encrypted backups, point-in-time recovery, metrics, paging, log retention, TLS certificates, and at
least two failure domains. These are release blockers until a provider and an on-call owner exist.

`DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE` and `EMAIL_ALLOW_INSECURE_LOCAL_COMPOSE` exist only for the
loopback-only rehearsal topology and are restricted in code to hosts named `postgres` and `mailpit`.
Never set them on a hosted deployment. The Django admin URL is intentionally absent in production;
operator actions must use reviewed, audited management procedures rather than a public admin panel.

## Local production-like rehearsal

Create a private environment file from the placeholder example. Use a URL-safe PostgreSQL password
or percent-encode it in `DATABASE_URL`.

```bash
cp apps/server/.env.compose.example apps/server/.env.compose.local
chmod 600 apps/server/.env.compose.local
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml config --quiet
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml build
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml --profile ops run --rm migrate
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml up -d postgres mailpit outbox-alerts outbox-email receipts reconciliation safety-metrics session-cleanup sweep delivery-monitor web
```

The web endpoint is bound only to `127.0.0.1:8000`; Mailpit's local inspection UI is at
`127.0.0.1:8025`. PostgreSQL has no host port. The local example disables the HTTPS redirect because
there is no TLS proxy; never reuse that setting on a public deployment.

Validate the running topology after at least 90 seconds so every worker has emitted a heartbeat:

```bash
curl --fail --silent http://127.0.0.1:8000/health/live/
curl --fail --silent http://127.0.0.1:8000/health/ready/
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml --profile ops run --rm delivery-health
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml run --rm safety-metrics python manage.py emit_safety_metrics
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml ps
```

`/health/live/` only proves that the web process responds. `/health/ready/` additionally verifies
the database, a round trip through the shared production cache, and that all migrations are applied.
Production uses the PostgreSQL-backed `hlasimse_cache` table so DRF/password-reset throttles are
shared across every Gunicorn process and replica. `check_delivery_health` is the release-critical
probe: it fails for missing/stale/failing workers, retrying or failed outbox events, and dead-letter
deliveries. The Compose delivery monitor exits non-zero and is restarted when this probe fails, so
the error and restart count remain visible. Compose cannot page an operator: production must alert
on the probe, worker container health, unexpected exits, and monitor restarts. Do not restart-loop
workers to hide the underlying failure.

## Safety observability

`emit_safety_metrics` performs read-only aggregate queries and writes one compact JSON object per
run, or one object per polling interval with `--watch`. The dedicated Compose role has no
healthcheck and exposes no port: collect its stdout with the platform's normal log pipeline. The
snapshot contains only counts, ages, and clocks. It never contains an account, profile, incident,
device, event or request identifier, e-mail address, location, token, or raw error message.

Map the snapshot fields to provider-neutral time series and alerts:

| JSON field | Operational meaning |
| --- | --- |
| `clock.app_minus_database_seconds` | Signed application-versus-database clock drift; alert on sustained absolute drift outside the deployment's time-sync budget |
| `deadlines.eligible_count` / `deadlines.oldest_due_age_seconds` | Due deadline generations still waiting for incident materialization and the age of the oldest; a growing age means the sweeper is not catching up |
| `deadlines.current_generation_incident_gap_count` | Explicit count of the same due generations without their incident; any sustained non-zero value is safety-critical |
| `incidents.open_count` | Current open incident load; use together with deadline and delivery backlog rather than as an error by itself |
| `alert_outbox.pending_count` / `alert_outbox.oldest_pending_age_seconds` | Durable alert-delivery backlog and oldest event age |
| `delivery.dead_letter_count` | Delivery attempts in a terminal dead-letter state; any increase requires investigation |
| `workers.oldest_heartbeat_age_seconds` / `workers.missing_count` / `workers.stale_count` / `workers.failing_count` | Required worker coverage and freshness; page on any missing, stale, or explicitly failing worker |

Django's separate access JSON is the source for API error and latency telemetry. Select records
where `logger="core.request"` and the route pattern belongs to `api/v1/`; calculate server error
rate from `status_code >= 500` divided by all selected requests in the same rolling window, and
calculate latency percentiles from `duration_ms`, grouped by `method` and the bounded `route`
pattern. Do not group by request ID or reconstruct raw URLs. The safety snapshot deliberately does
not duplicate access traffic metrics.

Backup freshness, last successful restore verification, database saturation, and confirmation that
a page reached the on-call operator are **external monitoring inputs**. They are not emitted by
`emit_safety_metrics` and must come from the database/backup provider, infrastructure telemetry,
and paging provider. A running metrics role or successful log ingestion is not evidence that a
backup is recent or that an operator was paged.

Stop the rehearsal without deleting its durable database:

```bash
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml down
```

Deleting the `postgres-data` volume destroys the local database and is intentionally not part of
this runbook.

## Release ordering

Every schema change must follow expand/migrate/contract: deploy additive, backward-compatible
migrations first; migrate data separately; remove old columns only in a later release after every
old process is gone.

Migration `0008` is intentionally only the expand phase for delivery receipt terminology. It keeps
the legacy database value `delivered` readable while new writes use `provider_accepted`; API and web
normalize both to “accepted by push service.” Do not add a bulk rewrite or remove the legacy value
until telemetry proves every old process is gone and the previous application image is outside the
rollback window. Migration `0009` only marks legacy, unsupported `checkin.accepted` outbox rows as
processed and deletes no domain data. Treat it as forward-only during application rollback: deploy
the prior compatible image against the forward schema instead of reversing the data operation.

1. Confirm the physical-device release gate, current delivery health, recent restore rehearsal,
   on-call coverage, and no unresolved incident.
2. Build the image once, scan it, sign it, and promote the same image digest through environments.
3. Take and verify a pre-deployment database backup.
4. Run `python manage.py migrate --plan`, review the plan, then run exactly one
   `python manage.py migrate --noinput` job using the new image. Run
   `python manage.py createcachetable` in the same job; it is idempotent and creates the shared
   throttle cache table when absent.
5. Run `python manage.py migrate --check` and `python manage.py check --deploy` with production
   configuration.
6. Roll web replicas gradually. Require readiness success before routing traffic and retain old
   healthy replicas until the new cohort is stable.
7. Roll the alert-outbox worker first, then email-outbox, push-receipt, and safety-reconciliation
   workers. Confirm all four heartbeats. The alert worker must retain its dedicated queue and
   sub-second idle poll.
8. Roll the deadline sweeper last. Confirm all five workers and delivery queues with
   `python manage.py check_delivery_health` after at least 90 seconds.
9. Exercise registration, check-in, guardian invitation, incident notification, acknowledgement,
   resolution, password reset, and account export in the production smoke-test accounts.
10. Monitor error rate, latency, database saturation, worker heartbeat age, retry queues, dead
    letters, and provider receipts continuously through the rollback window.

Never run `collectstatic` independently on mutable production replicas. It is performed during the
image build with `DJANGO_STATIC_MANIFEST=true`, so code and assets share one digest. A manual image
verification is:

```bash
docker run --rm --entrypoint python hlasimse-server:IMAGE_TAG manage.py collectstatic --noinput --dry-run
```

Supply the same non-secret/static settings used for the build if the deployment runtime requires
them.

## Rollback

Application rollback means redeploying the previously signed image digest. Do this only when its
code is compatible with the already-applied schema. Do not reverse a migration containing data
loss, `DROP`, or irreversible operations during an incident.

1. Stop rollout and remove new web replicas from traffic.
2. If newly generated outbox event formats are not understood by the old release, keep the new
   outbox and receipt workers running while rolling web back. Otherwise roll workers in reverse
   order: sweeper, receipt, email outbox, alert outbox, web.
3. Deploy the previous image digest and require readiness plus delivery-health success.
4. If the schema is incompatible, deploy a forward-fix image. Restore a backup only for confirmed
   database corruption or data loss, with incident command approval and an explicit recovery-point
   decision.
5. Re-run the end-to-end safety smoke tests and preserve all logs, outbox records, delivery attempts,
   and incident audit records for review.

## Backup and restore rehearsal

The production database provider must supply encrypted automated backups and point-in-time recovery.
In addition, rehearse a logical PostgreSQL backup at least quarterly and before destructive schema
work. For the local Compose database:

```bash
mkdir -p backups
chmod 700 backups
BACKUP_FILE="backups/hlasimse-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml exec -T postgres \
  sh -eu -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --compress=9 --no-owner --no-acl --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
shasum -a 256 "$BACKUP_FILE"
```

Record the filename and SHA-256 checksum in the restricted operations log. Encrypt the backup before
moving it off the protected operator machine.

Restore only into a disposable database, never over the live database. Set `BACKUP_FILE` to exactly
one verified dump first:

```bash
export BACKUP_FILE=/absolute/path/to/verified.dump
test -f "$BACKUP_FILE"
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml exec -T postgres \
  sh -eu -c 'test "$POSTGRES_DB" != hlasimse_restore_rehearsal; PGPASSWORD="$POSTGRES_PASSWORD" dropdb --if-exists --username="$POSTGRES_USER" hlasimse_restore_rehearsal; PGPASSWORD="$POSTGRES_PASSWORD" createdb --username="$POSTGRES_USER" hlasimse_restore_rehearsal'
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml exec -T postgres \
  sh -eu -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --exit-on-error --no-owner --no-acl --username="$POSTGRES_USER" --dbname=hlasimse_restore_rehearsal' \
  < "$BACKUP_FILE"
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml exec -T postgres \
  sh -eu -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql --no-psqlrc --set=ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname=hlasimse_restore_rehearsal --command="SELECT COUNT(*) AS applied_migrations FROM django_migrations;"'
```

Create a private environment file whose `DATABASE_URL` ends in `/hlasimse_restore_rehearsal`, then
run application-level validation against the restored copy:

```bash
docker compose --env-file apps/server/.env.restore.local -f compose.production.yml run --rm web python manage.py migrate --check
docker compose --env-file apps/server/.env.restore.local -f compose.production.yml run --rm web python manage.py check --deploy
```

Verify representative counts and the safety-critical relationships among profiles, guardians,
incidents, recipients, outbox events, delivery attempts, and worker heartbeats. Measure and record
backup duration, restore duration, recovery point, integrity results, and whether they meet the
selected RPO/RTO. Remove only the disposable rehearsal database after review:

```bash
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml exec -T postgres \
  sh -eu -c 'test "$POSTGRES_DB" != hlasimse_restore_rehearsal; PGPASSWORD="$POSTGRES_PASSWORD" dropdb --username="$POSTGRES_USER" hlasimse_restore_rehearsal'
```
