import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_CONTRACT = "deploy/runtime-contract.json";

const REQUIRED_ROLES = new Set([
  "web",
  "deadline-sweeper",
  "alert-outbox",
  "email-outbox",
  "push-receipts",
  "safety-reconciliation",
  "safety-metrics",
  "session-cleanup",
  "delivery-monitor",
  "migration",
]);
const EXPECTED_PROVIDER_SECRETS = new Map([
  ["web", ["smtp"]],
  ["deadline-sweeper", []],
  ["alert-outbox", ["expo-push"]],
  ["email-outbox", ["smtp"]],
  ["push-receipts", ["expo-push"]],
  ["safety-reconciliation", []],
  ["safety-metrics", []],
  ["session-cleanup", []],
  ["delivery-monitor", []],
  ["migration", []],
]);
const EXPECTED_ROLE_KINDS = new Map([
  ["web", "service"],
  ["deadline-sweeper", "worker"],
  ["alert-outbox", "worker"],
  ["email-outbox", "worker"],
  ["push-receipts", "worker"],
  ["safety-reconciliation", "worker"],
  ["safety-metrics", "singleton-worker"],
  ["session-cleanup", "singleton-worker"],
  ["delivery-monitor", "monitor"],
  ["migration", "release-job"],
]);
const EXPECTED_ROLE_COMMANDS = new Map([
  ["web", ["gunicorn", "--config", "config/gunicorn.py", "config.wsgi:application"]],
  ["deadline-sweeper", ["python", "manage.py", "sweep_deadlines", "--watch", "--poll-interval", "15"]],
  ["alert-outbox", ["python", "manage.py", "process_outbox", "--watch", "--queue", "alert", "--poll-interval", "0.25"]],
  ["email-outbox", ["python", "manage.py", "process_outbox", "--watch", "--queue", "email", "--poll-interval", "2"]],
  ["push-receipts", ["python", "manage.py", "fetch_push_receipts", "--watch", "--poll-interval", "30", "--error-backoff", "30"]],
  ["safety-reconciliation", ["python", "manage.py", "reconcile_safety_state", "--repair", "--fail-on-gaps", "--watch", "--poll-interval", "60"]],
  ["safety-metrics", ["python", "manage.py", "emit_safety_metrics", "--watch", "--poll-interval", "30", "--heartbeat-max-age-seconds", "90"]],
  ["session-cleanup", ["python", "manage.py", "purge_expired_sessions", "--watch", "--batch-size", "1000", "--poll-interval", "86400"]],
  ["delivery-monitor", ["python", "manage.py", "check_delivery_health", "--watch", "--poll-interval", "30", "--heartbeat-max-age-seconds", "90"]],
]);
const EXPECTED_HEARTBEATS = new Map([
  ["deadline-sweeper", "deadline_sweeper"],
  ["alert-outbox", "outbox_alerts"],
  ["email-outbox", "outbox_email"],
  ["push-receipts", "push_receipts"],
  ["safety-reconciliation", "safety_reconciliation"],
]);

function sameValues(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function commandContains(role, ...tokens) {
  return tokens.every((token) => role.command?.includes(token));
}

export function validateRuntimeContract(contract) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };

  check(contract?.schemaVersion === 1, "schemaVersion must be 1");
  check(contract?.deploymentModel === "provider-neutral-oci", "deploymentModel must be provider-neutral-oci");
  check(contract?.configurationContract === "apps/server/.env.example", "configurationContract must reference the production environment contract");
  check(contract?.processRoleEnvironmentVariable === "HLASIMSE_PROCESS_ROLE", "process roles must be selected by HLASIMSE_PROCESS_ROLE");
  check(sameValues(contract?.providerSecretClasses ?? [], ["expo-push", "smtp"]), "provider secret classes must be exact");
  check(contract?.image?.referencePolicy === "digest-only", "release images must be selected by immutable digest");
  check(contract?.image?.runAsUser === "10001:10001", "image must run as UID/GID 10001:10001");
  check(contract?.image?.readOnlyRootFilesystem === true, "image root filesystem must be read-only");
  check(sameValues(contract?.image?.dropCapabilities ?? [], ["ALL"]), "all Linux capabilities must be dropped");
  check(contract?.image?.noNewPrivileges === true, "no-new-privileges must be enabled");
  check(contract?.image?.terminationGraceSeconds >= 40, "termination grace must be at least 40 seconds");
  check(sameValues(contract?.network?.publicRoles ?? [], ["web"]), "web must be the only public process role");
  check(contract?.network?.applicationPort === 8000, "the internal application port must be 8000");
  check(contract?.network?.tlsTerminatedAtTrustedProxy === true, "TLS must terminate at a trusted proxy");
  check(contract?.network?.directPublicApplicationPortForbidden === true, "direct public access to the application port must be forbidden");

  const roles = Array.isArray(contract?.roles) ? contract.roles : [];
  const roleIds = roles.map((role) => role?.id);
  check(new Set(roleIds).size === roleIds.length, "role ids must be unique");
  check(sameValues(roleIds, REQUIRED_ROLES), "the contract must contain exactly the ten required roles");
  const byId = new Map(roles.map((role) => [role.id, role]));

  for (const role of roles) {
    check(role.kind === EXPECTED_ROLE_KINDS.get(role.id), `${role.id} has the wrong process kind`);
    check(role.databaseCredentialClass === (role.id === "migration" ? "migration-owner" : "runtime"), `${role.id} has the wrong database credential class`);
    check(Boolean(role.health?.kind), `${role.id} must define a health contract`);
    check(role.processRole === role.id, `${role.id} must set its exact process role`);
    if (EXPECTED_ROLE_COMMANDS.has(role.id)) {
      check(
        JSON.stringify(role.command) === JSON.stringify(EXPECTED_ROLE_COMMANDS.get(role.id)),
        `${role.id} command differs from the reviewed production command`,
      );
    }
    check(
      sameValues(
        role.requiredProviderSecretClasses ?? [],
        EXPECTED_PROVIDER_SECRETS.get(role.id) ?? [],
      ),
      `${role.id} has the wrong provider secret exposure`,
    );
  }

  const web = byId.get("web") ?? {};
  check(web.kind === "service", "web must be a service");
  check(web.replicas?.minimum >= 2, "web requires at least two replicas");
  check(web.failureDomains?.minimum >= 2, "web replicas require at least two failure domains");
  check(web.health?.kind === "http" && web.health?.path === "/health/ready/", "web must use the readiness endpoint");
  check(commandContains(web, "gunicorn", "config.wsgi:application"), "web must run Gunicorn with the Django WSGI application");

  const sweeper = byId.get("deadline-sweeper") ?? {};
  check(commandContains(sweeper, "sweep_deadlines", "--watch"), "deadline-sweeper must run continuously");
  check(sweeper.replicas?.minimum >= 1, "deadline-sweeper requires at least one replica");

  for (const workerId of ["alert-outbox", "email-outbox", "push-receipts", "safety-reconciliation", "delivery-monitor"]) {
    check(byId.get(workerId)?.replicas?.minimum >= 1, `${workerId} requires at least one replica`);
  }

  for (const [roleId, workerName] of EXPECTED_HEARTBEATS) {
    const health = byId.get(roleId)?.health;
    check(
      health?.kind === "database-heartbeat"
        && health?.workerName === workerName
        && health?.maximumAgeSeconds === 90,
      `${roleId} must expose its exact 90-second database heartbeat contract`,
    );
  }

  const alertOutbox = byId.get("alert-outbox") ?? {};
  check(commandContains(alertOutbox, "process_outbox", "--watch", "--queue", "alert", "--poll-interval", "0.25"), "alert-outbox must use the dedicated alert queue and sub-second poll interval");
  check(!alertOutbox.command?.includes("all"), "alert-outbox must never use the combined queue");

  const emailOutbox = byId.get("email-outbox") ?? {};
  check(commandContains(emailOutbox, "process_outbox", "--watch", "--queue", "email"), "email-outbox must use the dedicated email queue");
  check(!emailOutbox.command?.includes("all"), "email-outbox must never use the combined queue");

  const receipts = byId.get("push-receipts") ?? {};
  check(commandContains(receipts, "fetch_push_receipts", "--watch"), "push-receipts must run continuously");

  const reconciliation = byId.get("safety-reconciliation") ?? {};
  check(commandContains(reconciliation, "reconcile_safety_state", "--repair", "--fail-on-gaps", "--watch"), "safety-reconciliation must repair deterministic gaps and fail visibly");

  for (const singletonId of ["safety-metrics", "session-cleanup", "migration"]) {
    check(byId.get(singletonId)?.replicas?.exactly === 1, `${singletonId} must run exactly once`);
  }
  check(byId.get("safety-metrics")?.health?.kind === "external-log-alert", "safety-metrics must use external log alerting");
  check(byId.get("session-cleanup")?.health?.kind === "process-and-exit-alert", "session-cleanup must alert on process exit");

  const monitor = byId.get("delivery-monitor") ?? {};
  check(commandContains(monitor, "check_delivery_health", "--watch"), "delivery-monitor must continuously check delivery health");
  check(monitor.health?.kind === "process-and-exit-alert", "delivery-monitor must alert on process exit");
  check(monitor.health?.externalPagingRequired === true, "delivery-monitor must feed external paging");

  const migration = byId.get("migration") ?? {};
  check(migration.kind === "release-job", "migration must be a release job");
  check(migration.health?.kind === "successful-completion", "migration must report successful completion");
  check(migration.runExactlyOncePerRelease === true, "migration must run exactly once per release");
  check(
    JSON.stringify(migration.commands) ===
      JSON.stringify([
        ["python", "manage.py", "migrate", "--noinput"],
        ["python", "manage.py", "createcachetable"],
      ]),
    "migration must apply schema changes and create the shared cache table",
  );

  const preflight = contract?.preflight ?? {};
  check(preflight.processRole === "preflight", "preflight must use the preflight process role");
  check(
    JSON.stringify(preflight.command) ===
      JSON.stringify(["python", "manage.py", "check", "--deploy"]),
    "preflight must run Django deployment checks",
  );
  check(preflight.databaseCredentialClass === "runtime", "preflight must not receive migration-owner credentials");
  check(
    sameValues(preflight.requiredProviderSecretClasses ?? [], ["expo-push", "smtp"]),
    "preflight must validate both provider credential classes",
  );
  check(preflight.runBeforeEveryRelease === true, "preflight must run before every release");

  return { ok: errors.length === 0, errors };
}

export async function loadAndValidateRuntimeContract(contractPath = DEFAULT_CONTRACT) {
  const absolutePath = path.resolve(REPOSITORY_ROOT, contractPath);
  const relativePath = path.relative(REPOSITORY_ROOT, absolutePath);
  assert(!relativePath.startsWith("..") && !path.isAbsolute(relativePath), "contract path must stay inside the repository");
  const contract = JSON.parse(await readFile(absolutePath, "utf8"));
  return validateRuntimeContract(contract);
}

async function main() {
  const contractFlag = process.argv.indexOf("--contract");
  const contractPath = contractFlag === -1 ? DEFAULT_CONTRACT : process.argv[contractFlag + 1];
  assert(contractPath, "--contract requires a repository-relative path");
  const result = await loadAndValidateRuntimeContract(contractPath);
  if (!result.ok) {
    console.error("Runtime contract is not deployment-ready:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Provider-neutral runtime contract passed all deployment safety invariants.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Runtime contract validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
