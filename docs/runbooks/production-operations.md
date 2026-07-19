# Production operations

This runbook defines a provider-neutral operating contract for the Django service. The included
Compose topology is for local production-like verification on one machine. It is not a highly
available production platform and does not choose a hosting, database, email, monitoring, DNS, or
secret-management provider.

## Runtime contract

One immutable image runs five process roles:

| Role | Command | Required instances |
| --- | --- | --- |
| Web/API | `gunicorn --config config/gunicorn.py config.wsgi:application` | At least 2 across failure domains in production |
| Deadline sweep | `python manage.py sweep_deadlines --watch` | At least 1; database locks make concurrent instances safe |
| Outbox | `python manage.py process_outbox --watch` | At least 1 |
| Push receipts | `python manage.py fetch_push_receipts --watch` | At least 1 |
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

## Required production configuration

Inject configuration from the deployment platform's secret manager. Never bake it into the image,
Compose file, CI logs, shell history, or repository.

- `DJANGO_SECRET_KEY`: unique, random, at least 50 characters.
- `DJANGO_ALLOWED_HOSTS`: exact public hostnames.
- `DATABASE_URL`: PostgreSQL connection with TLS required by the selected database provider.
- `APP_BASE_URL`: canonical HTTPS web origin.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, `EMAIL_USE_TLS` or
  `EMAIL_USE_SSL`, `DEFAULT_FROM_EMAIL`, `SERVER_EMAIL`.
- `EXPO_ACCESS_TOKEN`: production Expo access token; enhanced push security must be enabled for the
  project so unauthenticated submissions are rejected.
- `GUNICORN_FORWARDED_ALLOW_IPS`: trusted proxy addresses/CIDRs supported by Gunicorn.

Also configure SPF, DKIM, and DMARC for the sending domain. The selected infrastructure must supply
encrypted backups, point-in-time recovery, metrics, paging, log retention, TLS certificates, and at
least two failure domains. These are release blockers until a provider and an on-call owner exist.

## Local production-like rehearsal

Create a private environment file from the placeholder example. Use a URL-safe PostgreSQL password
or percent-encode it in `DATABASE_URL`.

```bash
cp apps/server/.env.compose.example apps/server/.env.compose.local
chmod 600 apps/server/.env.compose.local
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml config --quiet
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml build
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml --profile ops run --rm migrate
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml up -d postgres mailpit outbox receipts sweep delivery-monitor web
```

The web endpoint is bound only to `127.0.0.1:8000`; Mailpit's local inspection UI is at
`127.0.0.1:8025`. PostgreSQL has no host port. The local example disables the HTTPS redirect because
there is no TLS proxy; never reuse that setting on a public deployment.

Validate the running topology after at least 90 seconds so every worker has emitted a heartbeat:

```bash
curl --fail --silent http://127.0.0.1:8000/health/live/
curl --fail --silent http://127.0.0.1:8000/health/ready/
docker compose --env-file apps/server/.env.compose.local -f compose.production.yml --profile ops run --rm delivery-health
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
7. Roll the outbox worker, then push-receipt worker. Confirm both heartbeats.
8. Roll the deadline sweeper last. Confirm all three workers and delivery queues with
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
   order: sweeper, receipt, outbox, web.
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
