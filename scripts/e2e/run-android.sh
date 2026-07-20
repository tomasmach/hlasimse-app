#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"
trap e2e_cleanup EXIT

ANDROID_SDK_ROOT_EFFECTIVE="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-${HOME}/Library/Android/sdk}}"
ANDROID_ADB_BIN="${ANDROID_SDK_ROOT_EFFECTIVE}/platform-tools/adb"
if [[ ! -x "${ANDROID_ADB_BIN}" ]]; then
  e2e_log "Missing Android SDK-local adb: ${ANDROID_ADB_BIN}."
  exit 2
fi
adb() {
  "${ANDROID_ADB_BIN}" "$@"
}

e2e_require curl
e2e_require lsof
e2e_require node
e2e_require npx
e2e_require shasum
e2e_require unzip
e2e_require uv
[[ -x "${E2E_MAESTRO_BIN}" ]] || { e2e_log "Maestro not executable: ${E2E_MAESTRO_BIN}"; exit 1; }
e2e_require_maestro_version
e2e_generate_credential

ANDROID_TEMPLATE_AVD_NAME="${ANDROID_TEMPLATE_AVD_NAME:-${1:-Medium_Phone_API_36.1}}"
ANDROID_TEMPLATE_AVD_HOME="${ANDROID_TEMPLATE_AVD_HOME:-${HOME}/.android/avd}"
ANDROID_AVD_NAME=""
ANDROID_AVD_ROOT=""
ANDROID_AVD_ROOT_OWNED="false"
ANDROID_AVD_HOME=""
ANDROID_ACTIVE_AVD_PATH=""
ANDROID_DEVICE_ORIGIN=""
ANDROID_DEVICE_OWNED="false"
ANDROID_AVDMANAGER_BIN=""
ANDROID_EMULATOR_BIN=""
ANDROID_EMULATOR_ROOT=""
ANDROID_SERIAL=""
E2E_ANDROID_MEMORY_MB="${E2E_ANDROID_MEMORY_MB:-4096}"
E2E_ANDROID_CORES="${E2E_ANDROID_CORES:-4}"
E2E_EMULATOR_PID=""
E2E_EMULATOR_PROCESS_START=""
E2E_DJANGO_ALLOWED_HOSTS="localhost,127.0.0.1,10.0.2.2"
export E2E_DJANGO_ALLOWED_HOSTS

E2E_BASE_APP_ID="$(e2e_app_id android)"
E2E_APP_ID="${E2E_BASE_APP_ID}.e2e"
if [[ ! "${E2E_BASE_APP_ID}" =~ ^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$ ]]; then
  e2e_log "Invalid base Android application ID: ${E2E_BASE_APP_ID}."
  exit 2
fi
export E2E_APP_ID
E2E_RUN_MODE="full"
e2e_initialize_run_metadata android "${E2E_APP_ID}"

android_ini_value() {
  local file="$1"
  local key="$2"
  awk -v wanted="${key}" '
    index($0, wanted "=") == 1 {
      value = substr($0, length(wanted) + 2)
      sub(/\r$/, "", value)
      print value
      exit
    }
  ' "${file}"
}

resolve_avdmanager() {
  local candidate=""
  if [[ -n "${ANDROID_AVDMANAGER_BIN_OVERRIDE:-}" ]]; then
    candidate="${ANDROID_AVDMANAGER_BIN_OVERRIDE}"
  elif [[ -x "${ANDROID_SDK_ROOT_EFFECTIVE}/cmdline-tools/latest/bin/avdmanager" ]]; then
    candidate="${ANDROID_SDK_ROOT_EFFECTIVE}/cmdline-tools/latest/bin/avdmanager"
  fi
  if [[ -z "${candidate}" ]] || [[ ! -x "${candidate}" ]]; then
    e2e_log "Missing Android SDK-local Command-line Tools: ${ANDROID_SDK_ROOT_EFFECTIVE}/cmdline-tools/latest/bin/avdmanager was not found. Full release evidence requires a fresh runner-owned AVD and will not reuse, copy, modify, or delete template ${ANDROID_TEMPLATE_AVD_NAME}. Install cmdline-tools;latest into the effective SDK root or set ANDROID_AVDMANAGER_BIN_OVERRIDE to an exact compatible executable."
    return 2
  fi
  printf '%s' "${candidate}"
}

create_owned_android_avd() {
  local template_ini="${ANDROID_TEMPLATE_AVD_HOME}/${ANDROID_TEMPLATE_AVD_NAME}.ini"
  local template_path
  local template_config
  local template_image_rel
  local template_device_profile
  local template_display_name
  local system_image_package
  local image_part_1 image_part_2 image_part_3 image_part_4 image_extra
  local temp_base
  local created_ini
  local created_config
  local created_path
  local created_image_rel
  local created_device_profile
  local system_image_revision
  local platform_revision
  local command_line_tools_root
  local command_line_tools_revision

  ANDROID_AVDMANAGER_BIN="$(resolve_avdmanager)" || return $?
  command_line_tools_root="$(cd "$(dirname "${ANDROID_AVDMANAGER_BIN}")/.." && pwd -P)"
  command_line_tools_revision="$(android_ini_value "${command_line_tools_root}/source.properties" Pkg.Revision)"
  if [[ -z "${command_line_tools_revision}" ]]; then
    e2e_log "Could not resolve Android command-line tools revision for ${ANDROID_AVDMANAGER_BIN}."
    return 2
  fi
  ANDROID_EMULATOR_BIN="${ANDROID_SDK_ROOT_EFFECTIVE}/emulator/emulator"
  if [[ ! -x "${ANDROID_EMULATOR_BIN}" ]]; then
    e2e_log "Missing executable Android emulator."
    return 2
  fi
  ANDROID_EMULATOR_ROOT="$(cd "$(dirname "${ANDROID_EMULATOR_BIN}")" && pwd -P)"
  ANDROID_EMULATOR_BIN="${ANDROID_EMULATOR_ROOT}/$(basename "${ANDROID_EMULATOR_BIN}")"
  if [[ ! "${ANDROID_TEMPLATE_AVD_NAME}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    e2e_log "Invalid exact Android template AVD name: ${ANDROID_TEMPLATE_AVD_NAME}."
    return 2
  fi
  if [[ ! -f "${template_ini}" ]]; then
    e2e_log "Template AVD descriptor does not exist: ${template_ini}."
    return 2
  fi
  template_path="$(android_ini_value "${template_ini}" path)"
  if [[ -z "${template_path}" ]] || [[ ! -d "${template_path}" ]]; then
    e2e_log "Template AVD path is missing or unavailable: ${template_path:-unknown}."
    return 2
  fi
  template_path="$(cd "${template_path}" && pwd -P)"
  template_config="${template_path}/config.ini"
  if [[ ! -f "${template_config}" ]]; then
    e2e_log "Template AVD has no config.ini: ${template_config}."
    return 2
  fi

  template_image_rel="$(android_ini_value "${template_config}" image.sysdir.1)"
  template_image_rel="${template_image_rel%/}"
  template_device_profile="$(android_ini_value "${template_config}" hw.device.name)"
  template_display_name="$(android_ini_value "${template_config}" avd.ini.displayname)"
  IFS='/' read -r image_part_1 image_part_2 image_part_3 image_part_4 image_extra <<<"${template_image_rel}"
  if [[ "${image_part_1}" != "system-images" ]] \
    || [[ -z "${image_part_2}" ]] \
    || [[ -z "${image_part_3}" ]] \
    || [[ -z "${image_part_4}" ]] \
    || [[ -n "${image_extra}" ]]; then
    e2e_log "Unsupported template system-image path: ${template_image_rel}."
    return 2
  fi
  if [[ ! "${template_device_profile}" =~ ^[A-Za-z0-9._-]+$ ]]; then
    e2e_log "Invalid template hardware profile: ${template_device_profile}."
    return 2
  fi
  if [[ ! -d "${ANDROID_SDK_ROOT_EFFECTIVE}/${template_image_rel}" ]]; then
    e2e_log "Template system image is not installed: ${ANDROID_SDK_ROOT_EFFECTIVE}/${template_image_rel}."
    return 2
  fi
  if [[ ! -d "${ANDROID_SDK_ROOT_EFFECTIVE}/platforms/${image_part_2}" ]]; then
    e2e_log "Android SDK platform ${image_part_2} is required by avdmanager but is not installed. Install platforms;${image_part_2} with the current SDK manager."
    return 2
  fi

  system_image_package="${image_part_1};${image_part_2};${image_part_3};${image_part_4}"
  system_image_revision="$(android_ini_value "${ANDROID_SDK_ROOT_EFFECTIVE}/${template_image_rel}/source.properties" Pkg.Revision)"
  platform_revision="$(android_ini_value "${ANDROID_SDK_ROOT_EFFECTIVE}/platforms/${image_part_2}/source.properties" Pkg.Revision)"
  if [[ -z "${system_image_revision}" ]] || [[ -z "${platform_revision}" ]]; then
    e2e_log "Could not resolve the installed Android system-image and platform revisions."
    return 2
  fi
  temp_base="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
  ANDROID_AVD_ROOT="$(mktemp -d "${temp_base}/hlasimse-e2e-avd.XXXXXX")"
  chmod 700 "${ANDROID_AVD_ROOT}"
  ANDROID_AVD_ROOT_OWNED="true"
  ANDROID_AVD_HOME="${ANDROID_AVD_ROOT}/avd"
  mkdir -m 700 "${ANDROID_AVD_HOME}"
  export ANDROID_AVD_HOME
  ANDROID_AVD_NAME="Hlasimse_E2E_$(date -u +%Y%m%dT%H%M%SZ)_$$"
  ANDROID_ACTIVE_AVD_PATH="${ANDROID_AVD_HOME}/${ANDROID_AVD_NAME}.avd"
  printf '%s\n' "${ANDROID_AVD_NAME}" >"${ANDROID_AVD_ROOT}/.hlasimse-runner-owned-avd"
  chmod 600 "${ANDROID_AVD_ROOT}/.hlasimse-runner-owned-avd"

  if ! printf 'no\n' | ANDROID_HOME="${ANDROID_SDK_ROOT_EFFECTIVE}" \
    ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT_EFFECTIVE}" \
    "${ANDROID_AVDMANAGER_BIN}" create avd \
      --force \
      --name "${ANDROID_AVD_NAME}" \
      --package "${system_image_package}" \
      --device "${template_device_profile}" \
      --path "${ANDROID_ACTIVE_AVD_PATH}" \
      >"${E2E_ARTIFACT_DIR}/android-avd-create.log" 2>&1; then
    e2e_log "avdmanager failed to create the isolated AVD; see android-avd-create.log."
    return 1
  fi

  created_ini="${ANDROID_AVD_HOME}/${ANDROID_AVD_NAME}.ini"
  created_config="${ANDROID_ACTIVE_AVD_PATH}/config.ini"
  if [[ ! -f "${created_ini}" ]] || [[ ! -f "${created_config}" ]]; then
    e2e_log "avdmanager did not create the exact expected AVD descriptor and config."
    return 1
  fi
  created_path="$(android_ini_value "${created_ini}" path)"
  if [[ -z "${created_path}" ]] || [[ ! -d "${created_path}" ]]; then
    e2e_log "Runner-created AVD descriptor has no valid path."
    return 1
  fi
  created_path="$(cd "${created_path}" && pwd -P)"
  created_image_rel="$(android_ini_value "${created_config}" image.sysdir.1)"
  created_image_rel="${created_image_rel%/}"
  created_device_profile="$(android_ini_value "${created_config}" hw.device.name)"
  if [[ "${created_path}" != "${ANDROID_ACTIVE_AVD_PATH}" ]] \
    || [[ "${created_path}" == "${template_path}" ]] \
    || [[ "${created_image_rel}" != "${template_image_rel}" ]] \
    || [[ "${created_device_profile}" != "${template_device_profile}" ]]; then
    e2e_log "Fresh AVD does not match the exact template image/device identity."
    return 1
  fi

  ANDROID_DEVICE_ORIGIN="fresh-runner-created"
  ANDROID_DEVICE_OWNED="true"
  e2e_record_property device_origin "${ANDROID_DEVICE_ORIGIN}"
  e2e_record_property device_owned "${ANDROID_DEVICE_OWNED}"
  e2e_record_property device_type_identifier "${template_device_profile}"
  e2e_record_property template_device_id "${ANDROID_TEMPLATE_AVD_NAME}"
  e2e_record_property template_device_name "${template_display_name:-${ANDROID_TEMPLATE_AVD_NAME}}"
  e2e_record_property android_avd "${ANDROID_AVD_NAME}"
  e2e_record_property android_device_profile "${template_device_profile}"
  e2e_record_property android_system_image_package "${system_image_package}"
  e2e_record_property android_system_image_revision "${system_image_revision}"
  e2e_record_property android_platform_package "platforms;${image_part_2}"
  e2e_record_property android_platform_revision "${platform_revision}"
  e2e_record_property android_command_line_tools_revision "${command_line_tools_revision}"
}

android_detected_avd_name() {
  local serial="$1"
  local detected_avd
  detected_avd="$(adb -s "${serial}" shell getprop ro.kernel.qemu.avd_name 2>/dev/null | tr -d '\r')"
  if [[ -z "${detected_avd}" ]]; then
    detected_avd="$(adb -s "${serial}" shell getprop ro.boot.qemu.avd_name 2>/dev/null | tr -d '\r')"
  fi
  printf '%s' "${detected_avd}"
}

find_android_serial() {
  local serial
  local state
  local detected_avd
  while read -r serial state; do
    [[ "$serial" == emulator-* && "$state" == "device" ]] || continue
    detected_avd="$(android_detected_avd_name "${serial}")"
    if [[ "$detected_avd" == "${ANDROID_AVD_NAME}" ]]; then
      printf '%s' "$serial"
      return 0
    fi
  done < <(adb devices | tail -n +2)
  return 1
}

android_package_uid() {
  adb -s "${ANDROID_SERIAL}" shell pm list packages -U "${E2E_APP_ID}" \
    | awk -v expected="package:${E2E_APP_ID}" '
        $1 == expected && $2 ~ /^uid:[0-9]+\r?$/ {
          sub(/^uid:/, "", $2)
          gsub(/\r/, "", $2)
          print $2
        }
      '
}

android_launcher_component() {
  adb -s "${ANDROID_SERIAL}" shell cmd package resolve-activity --brief \
    -a android.intent.action.MAIN -c android.intent.category.LAUNCHER "${E2E_APP_ID}" \
    | tr -d '\r' | tail -n 1
}

android_input_text() {
  local value="$1"
  local label="$2"
  local encoded
  local allowed_pattern='^[A-Za-z0-9@._+ -]+$'
  if [[ -z "${value}" ]] || [[ ! "${value}" =~ ${allowed_pattern} ]]; then
    e2e_log "Refusing unsupported ${label} characters for deterministic Android input injection."
    return 1
  fi
  encoded="${value// /%s}"
  adb -s "${ANDROID_SERIAL}" shell input text "${encoded}"
}

find_android_apksigner() {
  local sdk_root
  local candidate
  sdk_root="${ANDROID_SDK_ROOT_EFFECTIVE}"
  if [[ -z "${sdk_root}" ]] || [[ ! -d "${sdk_root}/build-tools" ]]; then
    return 1
  fi
  candidate="$(find "${sdk_root}/build-tools" -type f -name apksigner -perm -u+x | sort | tail -n 1)"
  [[ -n "${candidate}" ]] || return 1
  printf '%s' "${candidate}"
}

find_android_aapt2() {
  local candidate
  if [[ ! -d "${ANDROID_SDK_ROOT_EFFECTIVE}/build-tools" ]]; then
    return 1
  fi
  candidate="$(find "${ANDROID_SDK_ROOT_EFFECTIVE}/build-tools" -type f -name aapt2 -perm -u+x | sort | tail -n 1)"
  [[ -n "${candidate}" ]] || return 1
  printf '%s' "${candidate}"
}

owned_android_emulator_pid_matches() {
  local process_start
  local process_command
  if [[ ! "${E2E_EMULATOR_PID}" =~ ^[0-9]+$ ]] \
    || [[ -z "${E2E_EMULATOR_PROCESS_START}" ]] \
    || [[ -z "${ANDROID_AVD_NAME}" ]] \
    || [[ -z "${ANDROID_EMULATOR_BIN}" ]] \
    || [[ -z "${ANDROID_EMULATOR_ROOT}" ]]; then
    return 1
  fi
  process_start="$(ps -p "${E2E_EMULATOR_PID}" -o lstart= 2>/dev/null | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  process_command="$(ps -p "${E2E_EMULATOR_PID}" -o command= 2>/dev/null)"
  [[ "${process_start}" == "${E2E_EMULATOR_PROCESS_START}" ]] \
    && { [[ "${process_command}" == "${ANDROID_EMULATOR_BIN} "* ]] \
      || [[ "${process_command}" == "${ANDROID_EMULATOR_ROOT}/qemu/"* ]]; } \
    && [[ "${process_command}" == *"-avd ${ANDROID_AVD_NAME}"* ]]
}

stop_owned_android_emulator() {
  local detected_avd=""
  local attempt
  [[ "${ANDROID_DEVICE_OWNED}" == "true" ]] || return 0
  if [[ -z "${E2E_EMULATOR_PID}" ]] || ! kill -0 "${E2E_EMULATOR_PID}" 2>/dev/null; then
    return 0
  fi
  if ! owned_android_emulator_pid_matches; then
    e2e_log "Refusing process cleanup: PID ${E2E_EMULATOR_PID} no longer has the exact runner-owned AVD identity."
    return 1
  fi
  if [[ -n "${ANDROID_SERIAL}" ]] \
    && [[ "$(adb -s "${ANDROID_SERIAL}" get-state 2>/dev/null || true)" == "device" ]]; then
    detected_avd="$(android_detected_avd_name "${ANDROID_SERIAL}")"
    if [[ "${detected_avd}" == "${ANDROID_AVD_NAME}" ]]; then
      adb -s "${ANDROID_SERIAL}" emu kill >/dev/null 2>&1 || true
    else
      e2e_log "Refusing adb cleanup: serial ${ANDROID_SERIAL} no longer identifies owned AVD ${ANDROID_AVD_NAME}."
    fi
  fi
  for ((attempt = 0; attempt < 20; attempt += 1)); do
    if [[ -z "${E2E_EMULATOR_PID}" ]] || ! kill -0 "${E2E_EMULATOR_PID}" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if [[ -n "${E2E_EMULATOR_PID}" ]] && kill -0 "${E2E_EMULATOR_PID}" 2>/dev/null; then
    if ! owned_android_emulator_pid_matches; then
      e2e_log "Refusing TERM: owned emulator PID identity changed."
      return 1
    fi
    kill "${E2E_EMULATOR_PID}" 2>/dev/null || true
    for ((attempt = 0; attempt < 10; attempt += 1)); do
      kill -0 "${E2E_EMULATOR_PID}" 2>/dev/null || break
      sleep 1
    done
  fi
  if [[ -n "${E2E_EMULATOR_PID}" ]] && kill -0 "${E2E_EMULATOR_PID}" 2>/dev/null; then
    if ! owned_android_emulator_pid_matches; then
      e2e_log "Refusing KILL: owned emulator PID identity changed."
      return 1
    fi
    kill -KILL "${E2E_EMULATOR_PID}" 2>/dev/null || true
    sleep 1
  fi
  if [[ -n "${E2E_EMULATOR_PID}" ]] && kill -0 "${E2E_EMULATOR_PID}" 2>/dev/null; then
    e2e_log "Owned emulator process ${E2E_EMULATOR_PID} did not terminate."
    return 1
  fi
  if [[ -n "${E2E_EMULATOR_PID}" ]]; then
    wait "${E2E_EMULATOR_PID}" 2>/dev/null || true
  fi
}

delete_owned_android_avd_home() {
  local temp_base
  local sentinel_value
  [[ "${ANDROID_AVD_ROOT_OWNED}" == "true" ]] || return 0
  temp_base="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
  if [[ -z "${ANDROID_AVD_ROOT}" ]] \
    || [[ ! -d "${ANDROID_AVD_ROOT}" ]] \
    || [[ -L "${ANDROID_AVD_ROOT}" ]] \
    || [[ ! -f "${ANDROID_AVD_ROOT}/.hlasimse-runner-owned-avd" ]]; then
    e2e_log "Refusing AVD cleanup: exact runner-owned root or sentinel is missing."
    return 1
  fi
  case "${ANDROID_AVD_ROOT}" in
    "${temp_base}"/hlasimse-e2e-avd.*) ;;
    *)
      e2e_log "Refusing AVD cleanup outside the exact mktemp namespace: ${ANDROID_AVD_ROOT}."
      return 1
      ;;
  esac
  sentinel_value="$(cat "${ANDROID_AVD_ROOT}/.hlasimse-runner-owned-avd")"
  if [[ "${sentinel_value}" != "${ANDROID_AVD_NAME}" ]]; then
    e2e_log "Refusing AVD cleanup: ownership sentinel does not match ${ANDROID_AVD_NAME}."
    return 1
  fi
  if [[ "${ANDROID_AVD_ROOT}" == "${ANDROID_TEMPLATE_AVD_HOME}" ]] \
    || [[ "${ANDROID_ACTIVE_AVD_PATH}" == "${HOME}/.android/avd/"* ]]; then
    e2e_log "Refusing AVD cleanup because the target overlaps the user's persistent AVD home."
    return 1
  fi
  rm -rf -- "${ANDROID_AVD_ROOT}"
  [[ ! -e "${ANDROID_AVD_ROOT}" ]]
}

android_cleanup() {
  local exit_code="$1"
  local cleanup_status
  local device_cleanup_completed="true"
  local emulator_stopped="true"

  trap - EXIT
  set +e
  if [[ "${ANDROID_DEVICE_OWNED}" == "true" ]] \
    && [[ -n "${ANDROID_SERIAL}" ]] \
    && [[ "$(adb -s "${ANDROID_SERIAL}" get-state 2>/dev/null || true)" == "device" ]] \
    && [[ "$(android_detected_avd_name "${ANDROID_SERIAL}")" == "${ANDROID_AVD_NAME}" ]]; then
    adb -s "${ANDROID_SERIAL}" logcat -d >"${E2E_ARTIFACT_DIR}/android-logcat.log" 2>&1 || true
  fi
  if ! stop_owned_android_emulator; then
    device_cleanup_completed="false"
    emulator_stopped="false"
    exit_code=1
  fi
  if [[ "${emulator_stopped}" == "true" ]] && ! delete_owned_android_avd_home; then
    device_cleanup_completed="false"
    exit_code=1
  fi
  if [[ "${E2E_METADATA_INITIALIZED}" == "true" ]]; then
    e2e_record_property device_cleanup_completed "${device_cleanup_completed}"
  fi
  e2e_cleanup "$exit_code"
  cleanup_status=$?
  exit "$cleanup_status"
}
trap 'android_cleanup "$?"' EXIT

if [[ -n "${ANDROID_SERIAL_OVERRIDE:-}" ]]; then
  e2e_log "Full Android release evidence refuses an externally supplied serial; a fresh runner-owned AVD is mandatory."
  exit 2
fi
create_owned_android_avd
if [[ "${E2E_RUN_MODE}" == "full" \
  && "${ANDROID_DEVICE_OWNED}" == "true" \
  && "${ANDROID_DEVICE_ORIGIN}" == "fresh-runner-created" ]]; then
  e2e_record_property release_evidence_eligible true
else
  e2e_record_property release_evidence_eligible false
fi
"${ANDROID_EMULATOR_BIN}" \
  -avd "${ANDROID_AVD_NAME}" \
  -wipe-data \
  -no-snapshot \
  -no-window \
  -gpu swiftshader_indirect \
  -no-audio \
  -no-boot-anim \
  -memory "${E2E_ANDROID_MEMORY_MB}" \
  -cores "${E2E_ANDROID_CORES}" \
  >"${E2E_ARTIFACT_DIR}/android-emulator.log" 2>&1 &
E2E_EMULATOR_PID=$!
E2E_EMULATOR_PROCESS_START="$(ps -p "${E2E_EMULATOR_PID}" -o lstart= 2>/dev/null \
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [[ -z "${E2E_EMULATOR_PROCESS_START}" ]] || ! owned_android_emulator_pid_matches; then
  e2e_log "Could not establish the exact runner-owned Android emulator process identity."
  exit 2
fi
for _ in {1..180}; do
  ANDROID_SERIAL="$(find_android_serial || true)"
  [[ -n "${ANDROID_SERIAL}" ]] && break
  if ! kill -0 "${E2E_EMULATOR_PID}" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ -z "${ANDROID_SERIAL}" ]]; then
  e2e_log "No Android emulator became available for AVD ${ANDROID_AVD_NAME}."
  exit 2
fi

adb -s "${ANDROID_SERIAL}" wait-for-device
for _ in {1..120}; do
  [[ "$(adb -s "${ANDROID_SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] && break
  sleep 1
done
if [[ "$(adb -s "${ANDROID_SERIAL}" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != "1" ]]; then
  e2e_log "Android emulator ${ANDROID_SERIAL} did not finish booting."
  exit 2
fi
ANDROID_DETECTED_AVD="$(android_detected_avd_name "${ANDROID_SERIAL}")"
if [[ "${ANDROID_DETECTED_AVD}" != "${ANDROID_AVD_NAME}" ]]; then
  e2e_log "Resolved emulator serial does not belong to the runner-created AVD (${ANDROID_DETECTED_AVD:-missing} != ${ANDROID_AVD_NAME})."
  exit 2
fi

ANDROID_MEMORY_KB="$(adb -s "${ANDROID_SERIAL}" shell cat /proc/meminfo 2>/dev/null \
  | awk '/^MemTotal:/ {print $2; exit}' | tr -d '\r' || true)"
ANDROID_CORE_COUNT="$(adb -s "${ANDROID_SERIAL}" shell cat /proc/cpuinfo 2>/dev/null \
  | awk '/^processor[[:space:]]*:/ {count += 1} END {if (count) print count}' | tr -d '\r' || true)"
ANDROID_MIN_MEMORY_KB="$((E2E_ANDROID_MEMORY_MB * 900))"
if [[ ! "${ANDROID_MEMORY_KB}" =~ ^[0-9]+$ ]] || ((ANDROID_MEMORY_KB < ANDROID_MIN_MEMORY_KB)); then
  e2e_log "Android emulator has ${ANDROID_MEMORY_KB:-unknown} KiB RAM; the release journey requires about ${E2E_ANDROID_MEMORY_MB} MB."
  exit 2
fi
if [[ ! "${ANDROID_CORE_COUNT}" =~ ^[0-9]+$ ]] || ((ANDROID_CORE_COUNT < E2E_ANDROID_CORES)); then
  e2e_log "Android emulator has ${ANDROID_CORE_COUNT:-unknown} cores; the release journey requires ${E2E_ANDROID_CORES}."
  exit 2
fi
e2e_log "Android emulator resources: ${ANDROID_MEMORY_KB} KiB RAM, ${ANDROID_CORE_COUNT} cores."
adb -s "${ANDROID_SERIAL}" logcat -c

ANDROID_DEVICE_NAME="$(adb -s "${ANDROID_SERIAL}" shell getprop ro.product.model | tr -d '\r')"
ANDROID_OS_VERSION="$(adb -s "${ANDROID_SERIAL}" shell getprop ro.build.version.release | tr -d '\r')"
ANDROID_API_LEVEL="$(adb -s "${ANDROID_SERIAL}" shell getprop ro.build.version.sdk | tr -d '\r')"
ANDROID_BUILD_FINGERPRINT="$(adb -s "${ANDROID_SERIAL}" shell getprop ro.build.fingerprint | tr -d '\r')"
if [[ -z "${ANDROID_DEVICE_NAME}" ]] || [[ ! "${ANDROID_API_LEVEL}" =~ ^[0-9]+$ ]] \
  || [[ -z "${ANDROID_BUILD_FINGERPRINT}" ]]; then
  e2e_log "Could not resolve fail-closed Android device metadata."
  exit 2
fi
e2e_record_property device_id "${ANDROID_SERIAL}"
e2e_record_property device_name "${ANDROID_DEVICE_NAME}"
e2e_record_property os_name "Android"
e2e_record_property os_version "${ANDROID_OS_VERSION}"
e2e_record_property api_level "${ANDROID_API_LEVEL}"
e2e_record_property android_build_fingerprint "${ANDROID_BUILD_FINGERPRINT}"
ANDROID_APKSIGNER_BIN="$(find_android_apksigner || true)"
if [[ ! -x "${ANDROID_APKSIGNER_BIN}" ]]; then
  e2e_log "Could not find an executable Android apksigner for release evidence."
  exit 2
fi
ANDROID_AAPT2_BIN="$(find_android_aapt2 || true)"
if [[ ! -x "${ANDROID_AAPT2_BIN}" ]]; then
  e2e_log "Could not find an executable Android aapt2 for release evidence."
  exit 2
fi
ANDROID_BUILD_TOOLS_DIR="$(cd "$(dirname "${ANDROID_AAPT2_BIN}")" && pwd -P)"
if [[ "$(cd "$(dirname "${ANDROID_APKSIGNER_BIN}")" && pwd -P)" != "${ANDROID_BUILD_TOOLS_DIR}" ]]; then
  e2e_log "Android aapt2 and apksigner resolved from different build-tools installations."
  exit 2
fi
ANDROID_BUILD_TOOLS_REVISION="$(android_ini_value "${ANDROID_BUILD_TOOLS_DIR}/source.properties" Pkg.Revision)"
ANDROID_ADB_VERSION="$(adb version | awk '/Android Debug Bridge version/ {print $5; exit}')"
ANDROID_EMULATOR_VERSION="$("${ANDROID_EMULATOR_BIN}" -version 2>/dev/null \
  | awk '/Android emulator version/ {print $4; exit}')"
if [[ -z "${ANDROID_BUILD_TOOLS_REVISION}" ]] \
  || [[ ! "${ANDROID_ADB_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || [[ ! "${ANDROID_EMULATOR_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  e2e_log "Could not resolve the exact Android SDK-local toolchain revisions."
  exit 2
fi
e2e_record_property android_sdk_toolchain_origin "single-effective-sdk-root"
e2e_record_property android_build_tools_revision "${ANDROID_BUILD_TOOLS_REVISION}"
e2e_record_property android_adb_version "${ANDROID_ADB_VERSION}"
e2e_record_property android_emulator_version "${ANDROID_EMULATOR_VERSION}"
e2e_record_property emulator_display_mode "headless-software-gpu"
e2e_log "Android AVD: ${ANDROID_AVD_NAME}; serial: ${ANDROID_SERIAL}; app ID: ${E2E_APP_ID}"
e2e_log "Artifact directory: ${E2E_ARTIFACT_DIR}"
e2e_prepare_backend

(
  cd "${E2E_ROOT_DIR}/apps/mobile"
  mkdir -p android
  touch android/.hlasimse-prebuild-stale-sentinel
  NODE_PATH="${E2E_NODE_PATH}" EXPO_NO_TELEMETRY=1 \
    npx expo prebuild --platform android --no-install
  if [[ -e android/.hlasimse-prebuild-stale-sentinel ]]; then
    e2e_log "Expo prebuild did not clear the previous ignored Android project; source provenance is invalid."
    exit 2
  fi
  if [[ "$(grep -c 'HLASIMSE_E2E_BUILD_TYPE' android/app/build.gradle)" -ne 1 ]]; then
    e2e_log "Generated Android Gradle project does not contain exactly one E2E build type."
    exit 2
  fi
  if ! grep -Fq 'android:usesCleartextTraffic="true"' android/app/src/e2e/AndroidManifest.xml; then
    e2e_log "Generated Android E2E manifest is missing its local-only cleartext override."
    exit 2
  fi
  if grep -Fq 'android:usesCleartextTraffic="true"' android/app/src/main/AndroidManifest.xml; then
    e2e_log "Generated Android production manifest unexpectedly permits cleartext traffic."
    exit 2
  fi
  cd android
  NODE_PATH="${E2E_NODE_PATH}" NODE_ENV=production \
    EXPO_PUBLIC_API_URL="https://release-manifest.invalid" EXPO_NO_TELEMETRY=1 \
    ./gradlew :app:processReleaseManifest --no-daemon
  NODE_PATH="${E2E_NODE_PATH}" NODE_ENV=production \
    EXPO_PUBLIC_API_URL="http://10.0.2.2:8000" EXPO_NO_TELEMETRY=1 \
    ./gradlew :app:assembleE2e --no-daemon
) 2>&1 | tee "${E2E_ARTIFACT_DIR}/android-build.log"
e2e_record_property native_project_origin "expo-prebuild-cleared"
e2e_record_property expo_prebuild_version "$(node -p 'require("expo/package.json").version')"

ANDROID_APK_PATH="${E2E_ROOT_DIR}/apps/mobile/android/app/build/outputs/apk/e2e/app-e2e.apk"
ANDROID_E2E_MERGED_MANIFEST="${E2E_ROOT_DIR}/apps/mobile/android/app/build/intermediates/merged_manifests/e2e/processE2eManifest/AndroidManifest.xml"
ANDROID_RELEASE_MERGED_MANIFEST="${E2E_ROOT_DIR}/apps/mobile/android/app/build/intermediates/merged_manifests/release/processReleaseManifest/AndroidManifest.xml"
if [[ ! -f "${ANDROID_APK_PATH}" ]]; then
  e2e_log "Android E2E release-derived APK not found after build: ${ANDROID_APK_PATH}"
  exit 2
fi
if [[ ! -f "${ANDROID_E2E_MERGED_MANIFEST}" ]] \
  || [[ ! -f "${ANDROID_RELEASE_MERGED_MANIFEST}" ]]; then
  e2e_log "Could not locate both E2E and production merged Android manifests."
  exit 2
fi
if ! grep -Fq 'android:usesCleartextTraffic="true"' "${ANDROID_E2E_MERGED_MANIFEST}"; then
  e2e_log "Merged Android E2E manifest does not permit the local backend."
  exit 2
fi
if grep -Fq 'android:usesCleartextTraffic="true"' "${ANDROID_RELEASE_MERGED_MANIFEST}"; then
  e2e_log "Merged Android production manifest unexpectedly permits cleartext traffic."
  exit 2
fi
if ! grep -Fq "package=\"${E2E_BASE_APP_ID}\"" "${ANDROID_RELEASE_MERGED_MANIFEST}"; then
  e2e_log "Merged Android production manifest does not retain the base application ID."
  exit 2
fi
unzip -Z1 "${ANDROID_APK_PATH}" >"${E2E_ARTIFACT_DIR}/android-apk-entries.txt"
if ! grep -Fxq 'assets/index.android.bundle' "${E2E_ARTIFACT_DIR}/android-apk-entries.txt"; then
  e2e_log "Android E2E APK has no embedded JavaScript bundle."
  exit 2
fi
"${ANDROID_AAPT2_BIN}" dump xmltree "${ANDROID_APK_PATH}" --file AndroidManifest.xml \
  >"${E2E_ARTIFACT_DIR}/android-apk-manifest.txt"
if ! grep -Eq 'usesCleartextTraffic[^=]*=true' "${E2E_ARTIFACT_DIR}/android-apk-manifest.txt"; then
  e2e_log "Packaged Android E2E APK does not permit its local backend."
  exit 2
fi
if ! grep -Fq "package=\"${E2E_APP_ID}\"" "${E2E_ARTIFACT_DIR}/android-apk-manifest.txt"; then
  e2e_log "Packaged Android E2E APK does not use its isolated .e2e application ID."
  exit 2
fi
if grep -Eq 'debuggable[^=]*=true' "${E2E_ARTIFACT_DIR}/android-apk-manifest.txt"; then
  e2e_log "Android E2E APK is debuggable; release-derived evidence is invalid."
  exit 2
fi
ANDROID_APK_SHA256="$(shasum -a 256 "${ANDROID_APK_PATH}" | awk '{print $1}')"
"${ANDROID_APKSIGNER_BIN}" verify --print-certs "${ANDROID_APK_PATH}" \
  | tee "${E2E_ARTIFACT_DIR}/android-apk-signature.txt"
ANDROID_SIGNER_CERT_SHA256="$(
  awk -F': ' '/Signer #1 certificate SHA-256 digest:/ {print $2; exit}' \
    "${E2E_ARTIFACT_DIR}/android-apk-signature.txt"
)"
ANDROID_SIGNER_CERT_SHA256_LOWER="$(
  printf '%s' "${ANDROID_SIGNER_CERT_SHA256}" | tr '[:upper:]' '[:lower:]'
)"
if [[ ! "${ANDROID_APK_SHA256}" =~ ^[0-9a-f]{64}$ ]] \
  || [[ ! "${ANDROID_SIGNER_CERT_SHA256}" =~ ^[0-9a-fA-F]{64}$ ]]; then
  e2e_log "Could not resolve fail-closed APK digest and signing-certificate metadata."
  exit 2
fi
if adb -s "${ANDROID_SERIAL}" shell pm path "${E2E_APP_ID}" 2>/dev/null | grep -q '^package:'; then
  e2e_log "Fresh runner-owned AVD already contains ${E2E_APP_ID}; clean-install evidence is invalid."
  exit 2
fi
e2e_record_property android_package_present_before_install "false"
adb -s "${ANDROID_SERIAL}" install "${ANDROID_APK_PATH}" \
  | tee "${E2E_ARTIFACT_DIR}/android-package-initial-install.log"
ANDROID_INSTALLED_UID="$(android_package_uid)"
if [[ ! "${ANDROID_INSTALLED_UID}" =~ ^[0-9]+$ ]]; then
  e2e_log "Could not resolve installed Android package UID after build."
  exit 2
fi
ANDROID_FIRST_INSTALL_TIME="$(adb -s "${ANDROID_SERIAL}" shell dumpsys package "${E2E_APP_ID}" \
  | awk -F= '/firstInstallTime=/ {sub(/\r$/, "", $2); print $2; exit}')"
if [[ -z "${ANDROID_FIRST_INSTALL_TIME}" ]]; then
  e2e_log "Could not resolve firstInstallTime after the fresh package install."
  exit 2
fi
e2e_record_property apk_sha256 "${ANDROID_APK_SHA256}"
e2e_record_property apk_signer_cert_sha256 "${ANDROID_SIGNER_CERT_SHA256_LOWER}"
e2e_record_property android_package_uid "${ANDROID_INSTALLED_UID}"
e2e_record_property production_app_id "${E2E_BASE_APP_ID}"
e2e_record_property build_variant "e2e-release-derived"
e2e_record_property js_bundle_mode "embedded"
e2e_record_property signing_authority "debug-test-only"
e2e_record_property production_cleartext_allowed "false"
e2e_record_property initial_install_mode "fresh-package-install"
e2e_record_property update_artifact_relation "same-built-apk-reinstall-not-n-minus-one"
e2e_record_property n_minus_one_coverage "false"
e2e_record_property store_signed_update_coverage "false"
e2e_record_property android_first_install_time "${ANDROID_FIRST_INSTALL_TIME}"
ANDROID_LAUNCHER_COMPONENT="$(android_launcher_component)"
if [[ ! "${ANDROID_LAUNCHER_COMPONENT}" =~ ^${E2E_APP_ID}/ ]]; then
  e2e_log "Could not resolve the exact Android launcher component: ${ANDROID_LAUNCHER_COMPONENT:-missing}."
  exit 2
fi
e2e_record_property android_launcher_component "${ANDROID_LAUNCHER_COMPONENT}"

e2e_run_flow "${ANDROID_SERIAL}" 00a_android_guardian_onboarding_focus_email
android_input_text "${E2E_GUARDIAN_EMAIL}" "guardian email"
e2e_run_flow "${ANDROID_SERIAL}" 00b_android_guardian_focus_password
android_input_text "${E2E_RUN_CREDENTIAL}" "generated credential"
e2e_run_flow "${ANDROID_SERIAL}" 00c_android_guardian_after_login

e2e_run_flow "${ANDROID_SERIAL}" 06_android_prepare_location_denial 02_android_prepare_upgrade_login
android_input_text "${E2E_OWNER_EMAIL}" "owner email"
e2e_run_flow "${ANDROID_SERIAL}" 06a_android_focus_owner_password 02a_android_focus_upgrade_password
android_input_text "${E2E_RUN_CREDENTIAL}" "generated credential"
e2e_run_flow "${ANDROID_SERIAL}" 06b_android_submit_location_owner 02b_android_submit_upgrade_owner
e2e_run_flow "${ANDROID_SERIAL}" 03a_android_upgrade_sentinel_focus_name
android_input_text "E2E update sentinel" "upgrade sentinel name"
e2e_run_flow "${ANDROID_SERIAL}" 03b_android_upgrade_sentinel_after_name

ANDROID_UID_BEFORE="$(android_package_uid)"
if [[ ! "${ANDROID_UID_BEFORE}" =~ ^[0-9]+$ ]]; then
  e2e_log "Could not resolve Android package UID before the in-place update."
  exit 2
fi
if [[ "${ANDROID_UID_BEFORE}" != "${ANDROID_INSTALLED_UID}" ]]; then
  e2e_log "Android package UID changed before the explicit in-place update (${ANDROID_INSTALLED_UID} -> ${ANDROID_UID_BEFORE})."
  exit 1
fi
adb -s "${ANDROID_SERIAL}" shell dumpsys package "${E2E_APP_ID}" \
  >"${E2E_ARTIFACT_DIR}/android-package-before-update.txt"
e2e_log "Installing the freshly built APK as an in-place package update; application data must remain intact."
adb -s "${ANDROID_SERIAL}" install -r "${ANDROID_APK_PATH}" \
  | tee "${E2E_ARTIFACT_DIR}/android-package-update.log"
ANDROID_UID_AFTER="$(android_package_uid)"
adb -s "${ANDROID_SERIAL}" shell dumpsys package "${E2E_APP_ID}" \
  >"${E2E_ARTIFACT_DIR}/android-package-after-update.txt"
if [[ "${ANDROID_UID_AFTER}" != "${ANDROID_UID_BEFORE}" ]]; then
  e2e_log "Android package UID changed during update (${ANDROID_UID_BEFORE} -> ${ANDROID_UID_AFTER}); app data preservation is unproven."
  exit 1
fi
ANDROID_FIRST_INSTALL_TIME_AFTER="$(awk -F= '/firstInstallTime=/ {sub(/\r$/, "", $2); print $2; exit}' \
  "${E2E_ARTIFACT_DIR}/android-package-after-update.txt")"
if [[ "${ANDROID_FIRST_INSTALL_TIME_AFTER}" != "${ANDROID_FIRST_INSTALL_TIME}" ]]; then
  e2e_log "Android firstInstallTime changed during the same-package update; upgrade evidence is invalid."
  exit 1
fi
e2e_run_flow "${ANDROID_SERIAL}" 05_android_update_preserves_state

e2e_run_flow "${ANDROID_SERIAL}" 06_android_prepare_location_denial
android_input_text "${E2E_OWNER_EMAIL}" "owner email"
e2e_run_flow "${ANDROID_SERIAL}" 06a_android_focus_owner_password
android_input_text "${E2E_RUN_CREDENTIAL}" "generated credential"
e2e_run_flow "${ANDROID_SERIAL}" 06b_android_submit_location_owner
for permission in android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION; do
  adb -s "${ANDROID_SERIAL}" shell pm revoke "${E2E_APP_ID}" "${permission}"
  adb -s "${ANDROID_SERIAL}" shell pm clear-permission-flags \
    "${E2E_APP_ID}" "${permission}" user-set user-fixed
done
adb -s "${ANDROID_SERIAL}" shell dumpsys package "${E2E_APP_ID}" \
  >"${E2E_ARTIFACT_DIR}/android-package-after-location-reset.txt"
for permission in android.permission.ACCESS_FINE_LOCATION android.permission.ACCESS_COARSE_LOCATION; do
  permission_state="$(grep -F "${permission}:" \
    "${E2E_ARTIFACT_DIR}/android-package-after-location-reset.txt" | tail -n 1)"
  if [[ "${permission_state}" != *"granted=false"* ]] \
    || [[ "${permission_state}" == *"USER_SET"* ]] \
    || [[ "${permission_state}" == *"USER_FIXED"* ]]; then
    e2e_log "Location permission reset is not a fresh, revocable denial precondition: ${permission_state:-missing}."
    exit 2
  fi
done
adb -s "${ANDROID_SERIAL}" shell am force-stop "${E2E_APP_ID}"
adb -s "${ANDROID_SERIAL}" shell am start -W \
  -n "${ANDROID_LAUNCHER_COMPONENT}" \
  | tee "${E2E_ARTIFACT_DIR}/android-location-relaunch.log"
ANDROID_OWNER_CHECKIN_COUNT_BEFORE="$(
  cd "${E2E_ROOT_DIR}/apps/server"
  uv run python manage.py shell --verbosity 0 -c '
from core.models import CheckIn

print(CheckIn.objects.filter(profile__owner__email="e2e.owner@hlasimse.invalid").count())
'
)"
if [[ ! "${ANDROID_OWNER_CHECKIN_COUNT_BEFORE}" =~ ^[0-9]+$ ]]; then
  e2e_log "Could not establish the owner check-in count before location denial."
  exit 2
fi
e2e_run_flow "${ANDROID_SERIAL}" 07_android_location_denied
(
  cd "${E2E_ROOT_DIR}/apps/server"
  E2E_CHECKIN_COUNT_BEFORE="${ANDROID_OWNER_CHECKIN_COUNT_BEFORE}" uv run python manage.py shell --verbosity 0 -c '
import os

from core.models import CheckIn

owner_check_ins = CheckIn.objects.filter(profile__owner__email="e2e.owner@hlasimse.invalid")
count_before = int(os.environ["E2E_CHECKIN_COUNT_BEFORE"])
count_after = owner_check_ins.count()
assert count_after == count_before + 1, (
    f"Android location-denial flow created {count_after - count_before} check-ins instead of exactly one"
)
check_in = owner_check_ins.order_by("-accepted_at").first()
assert check_in is not None, "Android location-denial flow did not create a check-in"
assert check_in.latitude is None, "Denied location unexpectedly stored latitude"
assert check_in.longitude is None, "Denied location unexpectedly stored longitude"
assert check_in.location_accuracy_meters is None, "Denied location unexpectedly stored accuracy"
print(
    f"check_in_count_before={count_before} check_in_count_after={count_after} "
    f"latest_check_in={check_in.id} accepted_without_location=true"
)
'
) | tee "${E2E_ARTIFACT_DIR}/backend/android-location-denial-assertion.log"

e2e_run_flow "${ANDROID_SERIAL}" 10_owner_online_core
e2e_run_flow "${ANDROID_SERIAL}" 15a_android_profile_focus_name
android_input_text "E2E Druhy profil" "profile name"
e2e_run_flow "${ANDROID_SERIAL}" 15b_android_profile_after_name

e2e_log "Stopping only the owned backend PID for the deterministic API-outage check."
e2e_stop_backend
e2e_run_flow "${ANDROID_SERIAL}" 20_owner_offline_queue
e2e_start_backend
e2e_run_flow "${ANDROID_SERIAL}" 30_owner_offline_sync

e2e_run_flow "${ANDROID_SERIAL}" 40_owner_export
e2e_run_flow "${ANDROID_SERIAL}" 90a_android_delete_focus_password
android_input_text "${E2E_RUN_CREDENTIAL}" "account deletion credential"
e2e_run_flow "${ANDROID_SERIAL}" 90b_android_delete_after_password
e2e_seed_dataset free-boundaries boundary-seed.json
e2e_run_flow "${ANDROID_SERIAL}" 95a_android_boundaries_focus_email
android_input_text "${E2E_OWNER_EMAIL}" "boundary owner email"
e2e_run_flow "${ANDROID_SERIAL}" 95b_android_boundaries_focus_password
android_input_text "${E2E_RUN_CREDENTIAL}" "boundary owner credential"
e2e_run_flow "${ANDROID_SERIAL}" 95c_android_boundaries_after_login
e2e_seed_dataset cleanup-only cleanup.json
node "${E2E_ROOT_DIR}/scripts/e2e/assert-junit-evidence.mjs" "${E2E_ARTIFACT_DIR}" \
  00a_android_guardian_onboarding_focus_email \
  00b_android_guardian_focus_password \
  00c_android_guardian_after_login \
  02_android_prepare_upgrade_login \
  02a_android_focus_upgrade_password \
  02b_android_submit_upgrade_owner \
  03a_android_upgrade_sentinel_focus_name \
  03b_android_upgrade_sentinel_after_name \
  05_android_update_preserves_state \
  06_android_prepare_location_denial \
  06a_android_focus_owner_password \
  06b_android_submit_location_owner \
  07_android_location_denied \
  10_owner_online_core \
  15a_android_profile_focus_name \
  15b_android_profile_after_name \
  20_owner_offline_queue \
  30_owner_offline_sync \
  40_owner_export \
  90a_android_delete_focus_password \
  90b_android_delete_after_password \
  95a_android_boundaries_focus_email \
  95b_android_boundaries_focus_password \
  95c_android_boundaries_after_login \
  | tee "${E2E_ARTIFACT_DIR}/backend/android-junit-evidence.json"
E2E_JOURNEY_COMPLETED="true"
