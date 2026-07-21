#!/usr/bin/env bash

set -euo pipefail

image_ref="${1:?usage: validate-production-image.sh IMAGE_REF}"
run_id="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
network_name="hlasimse-container-gate-${run_id}"
postgres_name="hlasimse-container-gate-postgres-${run_id}"
web_name="hlasimse-container-gate-web-${run_id}"
worker_names=(
  "hlasimse-container-gate-sweep-${run_id}"
  "hlasimse-container-gate-alerts-${run_id}"
  "hlasimse-container-gate-email-${run_id}"
  "hlasimse-container-gate-receipts-${run_id}"
  "hlasimse-container-gate-reconciliation-${run_id}"
  "hlasimse-container-gate-metrics-${run_id}"
  "hlasimse-container-gate-monitor-${run_id}"
)
postgres_image="postgres:18.4-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296"

cleanup() {
  docker rm --force "${web_name}" "${worker_names[@]}" "${postgres_name}" >/dev/null 2>&1 || true
  docker network rm "${network_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker network create "${network_name}" >/dev/null
docker run --detach --name "${postgres_name}" \
  --network "${network_name}" \
  --network-alias postgres \
  --env POSTGRES_DB=hlasimse_container_gate \
  --env POSTGRES_USER=hlasimse \
  --env POSTGRES_HOST_AUTH_METHOD=trust \
  --read-only \
  --tmpfs /var/run/postgresql:size=16m,mode=3775 \
  --tmpfs /var/lib/postgresql:size=512m,mode=0755 \
  "${postgres_image}" >/dev/null

for _ in $(seq 1 30); do
  if docker exec "${postgres_name}" pg_isready \
    --username hlasimse --dbname hlasimse_container_gate >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "${postgres_name}" pg_isready \
  --username hlasimse --dbname hlasimse_container_gate >/dev/null

export DJANGO_DEBUG=false
export DJANGO_SECRET_KEY
DJANGO_SECRET_KEY="$(printf 'container-gate-not-a-secret-%s-' 1 2 3)"
export DJANGO_ALLOWED_HOSTS=ci.hlasim.se
export DJANGO_SECURE_SSL_REDIRECT=true
export DJANGO_STATIC_MANIFEST=true
export DATABASE_URL=postgresql://hlasimse@postgres:5432/hlasimse_container_gate
export DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE=true
export APP_BASE_URL=https://ci.hlasim.se
export SUPPORT_EMAIL=support@ci.hlasim.se
export LEGAL_TERMS_VERSION=2026-07-21-container-gate
export EXPO_ACCESS_TOKEN=container-gate-only-no-provider-requests
export MOBILE_MIN_IOS_VERSION=1.0.0
export MOBILE_MIN_IOS_BUILD=1
export MOBILE_IOS_STORE_URL=https://apps.apple.com/app/hlasim-se/id1234567890
export MOBILE_MIN_ANDROID_VERSION=1.0.0
export MOBILE_MIN_ANDROID_BUILD=1
export MOBILE_ANDROID_STORE_URL=https://play.google.com/store/apps/details?id=cz.hlasimse.app
export DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
export EMAIL_HOST=smtp.ci.invalid
export EMAIL_PORT=587
export EMAIL_HOST_USER=container-gate
export EMAIL_HOST_PASSWORD
EMAIL_HOST_PASSWORD="$(printf '%s' 'not' '-a-real-' 'smtp-credential')"
export EMAIL_USE_TLS=true
export EMAIL_USE_SSL=false
export DEFAULT_FROM_EMAIL='Hlásím se CI <noreply@ci.hlasim.se>'

production_env=(
  --env DJANGO_DEBUG
  --env DJANGO_SECRET_KEY
  --env DJANGO_ALLOWED_HOSTS
  --env DJANGO_SECURE_SSL_REDIRECT
  --env DJANGO_STATIC_MANIFEST
  --env DATABASE_URL
  --env DATABASE_ALLOW_INSECURE_LOCAL_COMPOSE
  --env APP_BASE_URL
  --env SUPPORT_EMAIL
  --env LEGAL_TERMS_VERSION
  --env EXPO_ACCESS_TOKEN
  --env MOBILE_MIN_IOS_VERSION
  --env MOBILE_MIN_IOS_BUILD
  --env MOBILE_IOS_STORE_URL
  --env MOBILE_MIN_ANDROID_VERSION
  --env MOBILE_MIN_ANDROID_BUILD
  --env MOBILE_ANDROID_STORE_URL
  --env DJANGO_EMAIL_BACKEND
  --env EMAIL_HOST
  --env EMAIL_PORT
  --env EMAIL_HOST_USER
  --env EMAIL_HOST_PASSWORD
  --env EMAIL_USE_TLS
  --env EMAIL_USE_SSL
  --env DEFAULT_FROM_EMAIL
)
runtime_security=(
  --network "${network_name}"
  --read-only
  --tmpfs /tmp:size=64m,mode=1777
  --tmpfs /run:size=16m,mode=0755
  --cap-drop ALL
  --security-opt no-new-privileges:true
)

run_manage() {
  docker run --rm \
    "${runtime_security[@]}" \
    "${production_env[@]}" \
    --entrypoint python \
    "${image_ref}" manage.py "$@"
}

run_worker() {
  local name="$1"
  shift
  docker run --detach --name "${name}" \
    "${runtime_security[@]}" \
    "${production_env[@]}" \
    --entrypoint python \
    "${image_ref}" manage.py "$@" >/dev/null
}

configured_user="$(docker image inspect --format '{{.Config.User}}' "${image_ref}")"
if [[ "${configured_user}" != "10001:10001" ]]; then
  echo "Production image must run as UID/GID 10001:10001, got '${configured_user}'" >&2
  exit 1
fi

run_manage makemigrations --check --dry-run
run_manage check --deploy
run_manage migrate --noinput
run_manage createcachetable
run_manage migrate --check
run_manage collectstatic --noinput --dry-run

docker run --detach --name "${web_name}" \
  "${runtime_security[@]}" \
  "${production_env[@]}" \
  "${image_ref}" >/dev/null

web_ready=false
for _ in $(seq 1 30); do
  if docker exec "${web_name}" python -c \
    "import urllib.request; request = urllib.request.Request('http://127.0.0.1:8000/health/ready/', headers={'Host': 'ci.hlasim.se', 'X-Forwarded-Proto': 'https'}); urllib.request.urlopen(request, timeout=3).read()" \
    >/dev/null 2>&1; then
    web_ready=true
    break
  fi
  sleep 1
done
if [[ "${web_ready}" != "true" ]]; then
  docker logs "${web_name}" >&2
  echo "Production container did not pass its readiness probe" >&2
  exit 1
fi

run_worker "${worker_names[0]}" sweep_deadlines --watch --poll-interval 1
run_worker "${worker_names[1]}" process_outbox --watch --queue alert --poll-interval 0.25
run_worker "${worker_names[2]}" process_outbox --watch --queue email --poll-interval 0.25
run_worker "${worker_names[3]}" fetch_push_receipts --watch --poll-interval 1 --error-backoff 1
run_worker "${worker_names[4]}" reconcile_safety_state --repair --fail-on-gaps --watch --poll-interval 1
run_worker "${worker_names[5]}" emit_safety_metrics --watch --poll-interval 1 --heartbeat-max-age-seconds 30

workers_healthy=false
for _ in $(seq 1 30); do
  all_running=true
  for name in "${worker_names[@]:0:6}"; do
    if [[ "$(docker inspect --format '{{.State.Running}}' "${name}")" != "true" ]]; then
      all_running=false
      docker logs "${name}" >&2
    fi
  done
  if [[ "${all_running}" == "true" ]] && run_manage check_delivery_health \
    --heartbeat-max-age-seconds 30 >/dev/null 2>&1; then
    workers_healthy=true
    break
  fi
  sleep 1
done
if [[ "${workers_healthy}" != "true" ]]; then
  run_manage check_delivery_health --heartbeat-max-age-seconds 30 || true
  echo "Production worker topology did not reach healthy delivery state" >&2
  exit 1
fi

run_worker "${worker_names[6]}" check_delivery_health --watch --poll-interval 1 \
  --heartbeat-max-age-seconds 30
sleep 2
if [[ "$(docker inspect --format '{{.State.Running}}' "${worker_names[6]}")" != "true" ]]; then
  docker logs "${worker_names[6]}" >&2
  echo "Production delivery monitor role exited unexpectedly" >&2
  exit 1
fi

metrics_line="$(docker logs "${worker_names[5]}" 2>&1 | tail -n 1)"
python3 - "${metrics_line}" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload["schema_version"] == 2
assert payload["safety_switches"]["guardian_location_disclosure_enabled"] is True
assert payload["workers"]["required_count"] == 5
PY

echo "Production image readiness, five delivery heartbeats, metrics, and monitor topology passed."
