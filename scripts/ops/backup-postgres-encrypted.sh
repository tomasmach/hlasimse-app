#!/usr/bin/env bash

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AGE_RECIPIENT:?AGE_RECIPIENT is required}"
: "${BACKUP_OUTPUT_DIR:?BACKUP_OUTPUT_DIR must be an existing absolute directory}"

if [[ "${BACKUP_OUTPUT_DIR}" != /* || "${BACKUP_OUTPUT_DIR}" == "/" ]]; then
  echo "BACKUP_OUTPUT_DIR must be an absolute directory other than /" >&2
  exit 1
fi
if [[ ! -d "${BACKUP_OUTPUT_DIR}" ]]; then
  echo "BACKUP_OUTPUT_DIR does not exist; create it with mode 0700 first" >&2
  exit 1
fi

for executable in age pg_dump; do
  if ! command -v "${executable}" >/dev/null 2>&1; then
    echo "Required executable is missing: ${executable}" >&2
    exit 1
  fi
done

umask 077
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
encrypted_backup="${BACKUP_OUTPUT_DIR%/}/hlasimse-${timestamp}.dump.age"
checksum_file="${encrypted_backup}.sha256"
partial_backup="${encrypted_backup}.partial"
partial_checksum="${checksum_file}.partial"

if [[ -e "${encrypted_backup}" || -e "${checksum_file}" ]]; then
  echo "Backup output already exists for timestamp ${timestamp}" >&2
  exit 1
fi

cleanup() {
  rm -f -- "${partial_backup}" "${partial_checksum}"
}
trap cleanup EXIT INT TERM

# The PostgreSQL stream is encrypted before any bytes reach persistent storage.
# Prefer a DATABASE_URL without an embedded password and use PGPASSFILE or a
# short-lived provider identity when the database platform supports it.
pg_dump \
  --dbname="${DATABASE_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  | age --recipient "${AGE_RECIPIENT}" --output "${partial_backup}"

test -s "${partial_backup}"
if command -v sha256sum >/dev/null 2>&1; then
  checksum="$(sha256sum "${partial_backup}" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  checksum="$(shasum -a 256 "${partial_backup}" | awk '{print $1}')"
else
  echo "sha256sum or shasum is required" >&2
  exit 1
fi

printf '%s  %s\n' "${checksum}" "$(basename "${encrypted_backup}")" > "${partial_checksum}"
mv -- "${partial_backup}" "${encrypted_backup}"
mv -- "${partial_checksum}" "${checksum_file}"
trap - EXIT INT TERM

printf 'Encrypted backup: %s\nChecksum file: %s\n' "${encrypted_backup}" "${checksum_file}"
