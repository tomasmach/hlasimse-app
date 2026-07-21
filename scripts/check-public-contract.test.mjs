import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { checkPublicContract } from "./check-public-contract.mjs";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/public-contract/", import.meta.url));

test("safe public copy passes while tracked internal files outside the manifest stay excluded", async () => {
  const result = await checkPublicContract({
    rootPath: FIXTURE_ROOT,
    manifestPath: "positive-manifest.json",
    trackedFiles: ["positive.md"],
  });

  assert.equal(result.files.size, 1);
  assert.ok(result.files.has("positive.md"));
  assert.deepEqual(result.failures, []);
});

test("an optional public artifact is scanned as soon as it becomes tracked", async () => {
  const result = await checkPublicContract({
    rootPath: FIXTURE_ROOT,
    manifestPath: "positive-manifest.json",
    trackedFiles: ["positive.md", "negative.md"],
  });

  assert.ok(result.files.has("negative.md"));
  assert.ok(result.failures.length > 0);
});

test("each prohibited public claim fails with an actionable rule", async () => {
  const result = await checkPublicContract({
    rootPath: FIXTURE_ROOT,
    manifestPath: "negative-manifest.json",
    trackedFiles: ["negative.md"],
  });
  const labels = new Set(result.failures.map((failure) => failure.label));

  assert.deepEqual(labels, new Set([
    "retired backend or billing brand",
    "paid feature call to action or runtime",
    "SMS feature claim or integration",
    "unverifiable instant alert claim",
    "unverifiable guaranteed delivery claim",
    "misleading confirmed offline check-in claim",
    "push receipt misrepresented as device delivery",
  ]));
  assert.ok(result.failures.every((failure) => failure.path === "negative.md"));
  assert.ok(result.failures.every((failure) => failure.line > 0));
});

test("a manifest cannot silently name an untracked artifact", async () => {
  await assert.rejects(
    checkPublicContract({
      rootPath: FIXTURE_ROOT,
      manifestPath: "positive-manifest.json",
      trackedFiles: [],
    }),
    /did not resolve to any tracked file/u,
  );
});
