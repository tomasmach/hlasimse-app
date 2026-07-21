import fs from "node:fs";
import path from "node:path";

const [artifactRoot, offlineQueueSource] = process.argv.slice(2);

function fail(message) {
  process.stderr.write(`[e2e] ${message}\n`);
  process.exit(1);
}

if (!artifactRoot || !offlineQueueSource) {
  fail("Usage: assert-at08-evidence.mjs <artifact-root> <offline-queue-source>");
}

function readJson(relativePath) {
  const absolutePath = path.join(artifactRoot, relativePath);
  if (!fs.existsSync(absolutePath)) fail(`Missing AT-08 evidence: ${absolutePath}`);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch {
    fail(`AT-08 evidence is not valid JSON: ${absolutePath}`);
  }
}

function requireEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function requireUuid(value, label) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? "")) {
    fail(`${label} is not a UUID.`);
  }
}

if (!fs.existsSync(offlineQueueSource)) fail(`Missing offline queue source: ${offlineQueueSource}`);
const queueSource = fs.readFileSync(offlineQueueSource, "utf8");
if (!/import\s+\*\s+as\s+SecureStore\s+from\s+["']expo-secure-store["']/.test(queueSource)) {
  fail("Offline queue does not import the native SecureStore API.");
}
for (const operation of ["getItemAsync", "setItemAsync", "deleteItemAsync"]) {
  if (!queueSource.includes(`SecureStore.${operation}`)) {
    fail(`Offline queue does not use SecureStore.${operation}.`);
  }
}
if (/AsyncStorage|expo-file-system|react-native-fs/.test(queueSource)) {
  fail("Offline queue references an unprotected general-purpose persistence API.");
}

const opened = readJson("backend/at08-incident-opened.json");
const resolved = readJson("backend/at08-incident-resolved.json");
requireEqual(opened.schema_version, 1, "Opened schema version");
requireEqual(resolved.schema_version, 1, "Resolved schema version");
requireEqual(opened.acceptance_test, "AT-08", "Opened acceptance test");
requireEqual(resolved.acceptance_test, "AT-08", "Resolved acceptance test");
requireEqual(opened.phase, "incident_opened_while_mobile_pending", "Opened phase");
requireEqual(resolved.phase, "exact_incident_resolved_after_api_restart", "Resolved phase");
requireEqual(opened.incident_status, "open", "Opened incident status");
requireEqual(resolved.incident_status, "resolved", "Resolved incident status");
requireEqual(opened.original_deadline_was_future, true, "Original future deadline proof");
requireEqual(opened.deadline_forced_past_for_e2e, true, "E2E deadline transition proof");
requireEqual(opened.production_interval_unchanged, true, "Production interval preservation");
requireEqual(opened.profile_interval_seconds, 3600, "Production minimum interval");
requireEqual(opened.server_queued_checkin_count, 0, "Pre-sync server queue result count");
requireEqual(opened.opened_audit_system_actor, true, "Opened audit system actor");
if (opened.scheduler_incidents_created < 1 || opened.scheduler_events_created < 1) {
  fail("Deadline scheduler did not report incident and outbox creation.");
}
requireEqual(resolved.submitted_from_queue, true, "Queued check-in provenance");
requireEqual(resolved.client_recorded_before_incident, true, "Offline-before-incident ordering");
requireEqual(resolved.server_accepted_after_incident, true, "Server acceptance ordering");
requireEqual(resolved.opened_outbox_preserved, true, "Opened outbox preservation");
requireEqual(resolved.owner_audit_actor_verified, true, "Owner audit actor chain");
requireEqual(resolved.audit_event_types, [
  "incident.opened",
  "incident.resolved",
  "checkin.confirmed",
], "Audit event set");
requireEqual(resolved.outbox_event_types, ["alert.opened", "alert.resolved"], "Outbox event set");
requireEqual(resolved.profile_id, opened.profile_id, "Profile identity");
requireEqual(resolved.incident_id, opened.incident_id, "Incident identity");
requireEqual(resolved.deadline_generation, opened.deadline_generation, "Deadline generation");
requireEqual(resolved.opened_audit_id, opened.opened_audit_id, "Opened audit identity");
requireEqual(resolved.opened_outbox_id, opened.opened_outbox_id, "Opened outbox identity");

for (const [label, value] of Object.entries({
  profile_id: opened.profile_id,
  incident_id: opened.incident_id,
  opened_audit_id: opened.opened_audit_id,
  opened_outbox_id: opened.opened_outbox_id,
  resolved_audit_id: resolved.resolved_audit_id,
  check_in_audit_id: resolved.check_in_audit_id,
  resolved_outbox_id: resolved.resolved_outbox_id,
  queued_check_in_id: resolved.queued_check_in_id,
})) {
  requireUuid(value, label);
}

const flowKeys = [
  "20_owner_offline_queue",
  "25_owner_offline_deadline_pending",
  "30_owner_offline_sync",
];
for (const flowKey of flowKeys) {
  const reportPath = path.join(artifactRoot, "maestro", flowKey, "report.xml");
  if (!fs.existsSync(reportPath)) fail(`Missing AT-08 UI evidence report for ${flowKey}.`);
}

process.stdout.write(`${JSON.stringify({
  acceptance_test: "AT-08",
  schema_version: 1,
  secure_storage_api: "expo-secure-store",
  general_purpose_plaintext_storage_absent: true,
  persistent_pending_ui_flow: "25_owner_offline_deadline_pending",
  profile_id: opened.profile_id,
  incident_id: opened.incident_id,
  queued_check_in_id: resolved.queued_check_in_id,
  audit_and_outbox_identity_verified: true,
  flow_keys: flowKeys,
})}\n`);
