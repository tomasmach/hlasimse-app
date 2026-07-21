#!/usr/bin/env bash

set -euo pipefail

: "${ENCRYPTED_BACKUP_FILE:?ENCRYPTED_BACKUP_FILE is required}"
: "${BACKUP_SHA256_FILE:?BACKUP_SHA256_FILE is required}"
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required}"
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${RESTORE_EXPECTED_DATABASE:?RESTORE_EXPECTED_DATABASE is required}"

for path in "${ENCRYPTED_BACKUP_FILE}" "${BACKUP_SHA256_FILE}" "${AGE_IDENTITY_FILE}"; do
  if [[ ! -f "${path}" ]]; then
    echo "Required file does not exist: ${path}" >&2
    exit 1
  fi
done
if [[ ! "${RESTORE_EXPECTED_DATABASE}" =~ ^[a-z0-9_]+_restore_rehearsal$ ]]; then
  echo "RESTORE_EXPECTED_DATABASE must end with _restore_rehearsal" >&2
  exit 1
fi

for executable in age pg_restore psql uv; do
  if ! command -v "${executable}" >/dev/null 2>&1; then
    echo "Required executable is missing: ${executable}" >&2
    exit 1
  fi
done

expected_checksum="$(awk 'NR == 1 {print $1}' "${BACKUP_SHA256_FILE}")"
expected_filename="$(awk 'NR == 1 {print $2}' "${BACKUP_SHA256_FILE}")"
if [[ ! "${expected_checksum}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "BACKUP_SHA256_FILE does not contain a valid SHA-256 checksum" >&2
  exit 1
fi
if [[ "${expected_filename}" != "$(basename "${ENCRYPTED_BACKUP_FILE}")" ]]; then
  echo "BACKUP_SHA256_FILE names a different encrypted backup" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "${ENCRYPTED_BACKUP_FILE}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "${ENCRYPTED_BACKUP_FILE}" | awk '{print $1}')"
else
  echo "sha256sum or shasum is required" >&2
  exit 1
fi
normalized_actual_checksum="$(printf '%s' "${actual_checksum}" | tr '[:upper:]' '[:lower:]')"
normalized_expected_checksum="$(printf '%s' "${expected_checksum}" | tr '[:upper:]' '[:lower:]')"
if [[ "${normalized_actual_checksum}" != "${normalized_expected_checksum}" ]]; then
  echo "Encrypted backup checksum mismatch" >&2
  exit 1
fi

actual_database="$(psql --no-psqlrc --tuples-only --no-align --dbname="${RESTORE_DATABASE_URL}" --command='SELECT current_database();')"
if [[ "${actual_database}" != "${RESTORE_EXPECTED_DATABASE}" ]]; then
  echo "Refusing restore: connected database is '${actual_database}', expected '${RESTORE_EXPECTED_DATABASE}'" >&2
  exit 1
fi

user_table_count="$(psql --no-psqlrc --tuples-only --no-align --dbname="${RESTORE_DATABASE_URL}" --command="SELECT COUNT(*) FROM pg_catalog.pg_class AS c JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname !~ '^pg_toast';")"
if [[ "${user_table_count}" != "0" ]]; then
  echo "Refusing restore: rehearsal database is not empty" >&2
  exit 1
fi

age --decrypt --identity "${AGE_IDENTITY_FILE}" "${ENCRYPTED_BACKUP_FILE}" \
  | pg_restore \
      --exit-on-error \
      --single-transaction \
      --no-owner \
      --no-acl \
      --dbname="${RESTORE_DATABASE_URL}"

invalid_constraints="$(psql --no-psqlrc --tuples-only --no-align --dbname="${RESTORE_DATABASE_URL}" --command="SELECT COUNT(*) FROM pg_catalog.pg_constraint WHERE NOT convalidated;")"
if [[ "${invalid_constraints}" != "0" ]]; then
  echo "Restored database contains unvalidated constraints" >&2
  exit 1
fi

server_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../apps/server" && pwd)"
(
  cd "${server_root}"
  DATABASE_URL="${RESTORE_DATABASE_URL}" uv run python manage.py migrate --check
  DATABASE_URL="${RESTORE_DATABASE_URL}" uv run python manage.py check --deploy
)

psql --no-psqlrc --tuples-only --no-align --dbname="${RESTORE_DATABASE_URL}" --command="SELECT json_build_object('users', (SELECT COUNT(*) FROM core_user), 'profiles', (SELECT COUNT(*) FROM core_checkinprofile), 'guardians', (SELECT COUNT(*) FROM core_guardianmembership), 'check_ins', (SELECT COUNT(*) FROM core_checkin), 'incidents', (SELECT COUNT(*) FROM core_alertincident), 'recipients', (SELECT COUNT(*) FROM core_alertrecipient), 'outbox_events', (SELECT COUNT(*) FROM core_outboxevent), 'delivery_attempts', (SELECT COUNT(*) FROM core_deliveryattempt));"

echo "Encrypted backup restored into the isolated rehearsal database and structural checks passed."
