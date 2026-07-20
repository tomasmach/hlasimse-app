#!/usr/bin/env bash

set -euo pipefail

image_ref="${1:?usage: validate-production-image.sh IMAGE_REF}"
run_id="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
network_name="hlasimse-container-gate-${run_id}"
postgres_name="hlasimse-container-gate-postgres-${run_id}"
web_name="hlasimse-container-gate-web-${run_id}"
postgres_image="postgres:18.4-bookworm@sha256:1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296"

cleanup() {
  docker rm --force "${web_name}" "${postgres_name}" >/dev/null 2>&1 || true
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

for _ in $(seq 1 30); do
  if docker exec "${web_name}" python -c \
    "import urllib.request; request = urllib.request.Request('http://127.0.0.1:8000/health/live/', headers={'Host': 'ci.hlasim.se', 'X-Forwarded-Proto': 'https'}); urllib.request.urlopen(request, timeout=3).read()" \
    >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

docker logs "${web_name}" >&2
echo "Production container did not pass its live probe" >&2
exit 1
