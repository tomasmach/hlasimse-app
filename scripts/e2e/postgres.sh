#!/usr/bin/env bash

# This file is sourced by common.sh. Keep startup side-effect free so the E2E
# validator can inspect the harness without requiring a running Docker daemon.

E2E_POSTGRES_IMAGE="postgres:18.4-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296"
E2E_POSTGRES_DB="hlasimse_e2e"
E2E_POSTGRES_USER="hlasimse_e2e"
E2E_POSTGRES_LABEL_KEY="cz.hlasimse.e2e.run"
E2E_POSTGRES_RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}"
E2E_POSTGRES_CONTAINER_NAME="hlasimse-e2e-postgres-${E2E_POSTGRES_RUN_ID}"
E2E_POSTGRES_CONTAINER_ID=""
E2E_POSTGRES_EXPECTED_LABEL="${E2E_POSTGRES_RUN_ID}"
E2E_POSTGRES_HOST_PORT=""

e2e_start_postgres() {
  local container_id
  local container_run_output
  local actual_label
  local published_address
  local port

  if [[ -n "${E2E_POSTGRES_CONTAINER_ID}" ]]; then
    e2e_log "PostgreSQL E2E container is already owned by this run."
    return 0
  fi

  e2e_require docker
  if ! docker info >/dev/null 2>&1; then
    e2e_log "Docker is required for the isolated PostgreSQL E2E database."
    return 1
  fi

  if [[ -n "${DATABASE_URL:-}" ]]; then
    e2e_log "Replacing inherited DATABASE_URL with this run's isolated PostgreSQL E2E database."
  fi

  if ! container_run_output="$(
    docker run --detach \
      --name "${E2E_POSTGRES_CONTAINER_NAME}" \
      --label "${E2E_POSTGRES_LABEL_KEY}=${E2E_POSTGRES_EXPECTED_LABEL}" \
      --publish "127.0.0.1::5432" \
      --env "POSTGRES_DB=${E2E_POSTGRES_DB}" \
      --env "POSTGRES_USER=${E2E_POSTGRES_USER}" \
      --env POSTGRES_HOST_AUTH_METHOD=trust \
      --read-only \
      --tmpfs /var/run/postgresql:size=16m,mode=3775 \
      --tmpfs /var/lib/postgresql:size=512m,mode=0755 \
      "${E2E_POSTGRES_IMAGE}"
  )"; then
    e2e_log "Could not start an isolated PostgreSQL E2E container."
    return 1
  fi
  container_id="${container_run_output}"
  if [[ ! "${container_id}" =~ ^[0-9a-f]{64}$ ]]; then
    container_id="$(
      docker inspect --format '{{.Id}}' "${E2E_POSTGRES_CONTAINER_NAME}" 2>/dev/null || true
    )"
  fi
  if [[ ! "${container_id}" =~ ^[0-9a-f]{64}$ ]]; then
    e2e_log "Docker returned an invalid PostgreSQL container ID; refusing to continue."
    return 1
  fi
  E2E_POSTGRES_CONTAINER_ID="${container_id}"

  actual_label="$(
    docker inspect \
      --format "{{ index .Config.Labels \"${E2E_POSTGRES_LABEL_KEY}\" }}" \
      "${E2E_POSTGRES_CONTAINER_ID}" 2>/dev/null || true
  )"
  if [[ "${actual_label}" != "${E2E_POSTGRES_EXPECTED_LABEL}" ]]; then
    e2e_log "PostgreSQL ownership label verification failed; refusing to use the container."
    return 1
  fi

  published_address="$(
    docker port "${E2E_POSTGRES_CONTAINER_ID}" 5432/tcp 2>/dev/null || true
  )"
  if [[ ! "${published_address}" =~ ^127\.0\.0\.1:([0-9]+)$ ]]; then
    e2e_log "PostgreSQL was not published on one dynamic IPv4 loopback port; refusing to continue."
    return 1
  fi
  port="${BASH_REMATCH[1]}"
  if ((port < 1 || port > 65535)); then
    e2e_log "Docker returned an invalid PostgreSQL loopback port."
    return 1
  fi
  E2E_POSTGRES_HOST_PORT="${port}"

  for _ in {1..60}; do
    if docker exec "${E2E_POSTGRES_CONTAINER_ID}" pg_isready \
      --username "${E2E_POSTGRES_USER}" \
      --dbname "${E2E_POSTGRES_DB}" >/dev/null 2>&1; then
      break
    fi
    if [[ "$(docker inspect --format '{{.State.Running}}' "${E2E_POSTGRES_CONTAINER_ID}" 2>/dev/null || true)" != "true" ]]; then
      e2e_log "PostgreSQL E2E container stopped before becoming ready."
      return 1
    fi
    sleep 1
  done
  if ! docker exec "${E2E_POSTGRES_CONTAINER_ID}" pg_isready \
    --username "${E2E_POSTGRES_USER}" \
    --dbname "${E2E_POSTGRES_DB}" >/dev/null 2>&1; then
    e2e_log "Timed out waiting for the isolated PostgreSQL E2E database."
    return 1
  fi

  DATABASE_URL="postgresql://${E2E_POSTGRES_USER}@127.0.0.1:${E2E_POSTGRES_HOST_PORT}/${E2E_POSTGRES_DB}"
  export DATABASE_URL
  e2e_log "Isolated PostgreSQL E2E database is ready on a dynamic loopback port."
}

e2e_assert_postgres_backend() {
  (
    cd "${E2E_ROOT_DIR}/apps/server"
    uv run python manage.py shell --verbosity 0 -c '
import json

from django.db import connection

connection.ensure_connection()
database_name = str(connection.settings_dict["NAME"])
database_host = str(connection.settings_dict["HOST"])
assert connection.vendor == "postgresql", f"expected PostgreSQL, got {connection.vendor}"
assert database_host == "127.0.0.1", f"database host is not IPv4 loopback: {database_host}"
assert any(marker in database_name.casefold() for marker in ("e2e", "test")), (
    f"database name is not explicitly isolated for tests: {database_name}"
)
with connection.cursor() as cursor:
    cursor.execute("SELECT current_database()")
    actual_database_name = str(cursor.fetchone()[0])
assert actual_database_name == database_name, "connected database differs from Django settings"
print(json.dumps({
    "database_vendor": connection.vendor,
    "database_name": database_name,
    "database_host_scope": "ipv4-loopback",
    "connected_database_verified": True,
}, sort_keys=True))
'
  ) | tee "${E2E_ARTIFACT_DIR}/backend/database-assertion.json"
}

e2e_stop_postgres() {
  local actual_label

  if [[ -z "${E2E_POSTGRES_CONTAINER_ID}" ]]; then
    return 0
  fi

  if ! docker inspect "${E2E_POSTGRES_CONTAINER_ID}" >/dev/null 2>&1; then
    E2E_POSTGRES_CONTAINER_ID=""
    E2E_POSTGRES_HOST_PORT=""
    unset DATABASE_URL || true
    return 0
  fi

  actual_label="$(
    docker inspect \
      --format "{{ index .Config.Labels \"${E2E_POSTGRES_LABEL_KEY}\" }}" \
      "${E2E_POSTGRES_CONTAINER_ID}" 2>/dev/null || true
  )"
  if [[ "${actual_label}" != "${E2E_POSTGRES_EXPECTED_LABEL}" ]]; then
    e2e_log "PostgreSQL ownership label mismatch; refusing to remove an unverified container."
    return 1
  fi

  docker rm --force "${E2E_POSTGRES_CONTAINER_ID}" >/dev/null
  E2E_POSTGRES_CONTAINER_ID=""
  E2E_POSTGRES_HOST_PORT=""
  unset DATABASE_URL || true
}
