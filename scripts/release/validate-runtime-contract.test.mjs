import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateRuntimeContract } from "./validate-runtime-contract.mjs";

const contract = JSON.parse(
  await readFile(new URL("../../deploy/runtime-contract.json", import.meta.url), "utf8"),
);

function changed(mutator) {
  const copy = structuredClone(contract);
  mutator(copy);
  return copy;
}

function role(target, id) {
  return target.roles.find((candidate) => candidate.id === id);
}

test("repository runtime contract satisfies every deployment invariant", () => {
  assert.deepEqual(validateRuntimeContract(contract), { ok: true, errors: [] });
});

test("rejects a single web replica or failure domain", () => {
  const result = validateRuntimeContract(
    changed((target) => {
      role(target, "web").replicas.minimum = 1;
      role(target, "web").failureDomains.minimum = 1;
    }),
  );
  assert.equal(result.ok, false);
  assert(result.errors.includes("web requires at least two replicas"));
  assert(result.errors.includes("web replicas require at least two failure domains"));
});

test("rejects a combined or slow alert queue", () => {
  const result = validateRuntimeContract(
    changed((target) => {
      role(target, "alert-outbox").command = [
        "python",
        "manage.py",
        "process_outbox",
        "--watch",
        "--queue",
        "all",
        "--poll-interval",
        "2",
      ];
    }),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("dedicated alert queue")));
  assert(result.errors.some((error) => error.includes("combined queue")));
});

test("rejects missing roles, unsafe image settings and an unpaged monitor", () => {
  const result = validateRuntimeContract(
    changed((target) => {
      target.roles = target.roles.filter((candidate) => candidate.id !== "session-cleanup");
      target.image.terminationGraceSeconds = 10;
      target.image.readOnlyRootFilesystem = false;
      role(target, "delivery-monitor").health.externalPagingRequired = false;
    }),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("ten required roles")));
  assert(result.errors.some((error) => error.includes("read-only")));
  assert(result.errors.some((error) => error.includes("40 seconds")));
  assert(result.errors.some((error) => error.includes("external paging")));
});

test("rejects a continuously running or runtime-privileged migration", () => {
  const result = validateRuntimeContract(
    changed((target) => {
      role(target, "migration").runExactlyOncePerRelease = false;
      role(target, "migration").databaseCredentialClass = "runtime";
    }),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("database credential class")));
  assert(result.errors.some((error) => error.includes("exactly once per release")));
});

test("rejects provider credentials exposed to the wrong process", () => {
  const result = validateRuntimeContract(
    changed((target) => {
      role(target, "deadline-sweeper").requiredProviderSecretClasses = ["expo-push"];
      role(target, "alert-outbox").requiredProviderSecretClasses = ["smtp"];
      target.preflight.requiredProviderSecretClasses = ["smtp"];
    }),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("deadline-sweeper")));
  assert(result.errors.some((error) => error.includes("alert-outbox")));
  assert(result.errors.some((error) => error.includes("preflight")));
});

test("rejects unreviewed commands, missing replicas and detached heartbeat names", () => {
  const result = validateRuntimeContract(
    changed((target) => {
      role(target, "email-outbox").command.push("--unreviewed-option");
      role(target, "push-receipts").replicas.minimum = 0;
      role(target, "safety-reconciliation").health.workerName = "another_worker";
    }),
  );
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("email-outbox command")));
  assert(result.errors.some((error) => error.includes("push-receipts requires")));
  assert(result.errors.some((error) => error.includes("safety-reconciliation") && error.includes("heartbeat")));
});
