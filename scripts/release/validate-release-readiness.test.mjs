import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { validateReleaseReadiness } from "./validate-release-readiness.mjs";

const digest = "12".repeat(32);
const commit = "a".repeat(40);
const tree = "b".repeat(40);
const releasePackBytes = Buffer.from("release-pack-fixture");
const runtimeContractBytes = Buffer.from("runtime-contract-fixture");
const appConfig = {
  expo: {
    version: "1.0.0",
    ios: { bundleIdentifier: "cz.tomasmach.hlasimse", buildNumber: "1" },
    android: { package: "cz.tomasmach.hlasimse", versionCode: 1 },
  },
};
const completed = { passed: true, completedAt: "2026-07-21T12:00:00Z", evidenceSha256: digest };
const mobileEvidence = (distribution) => ({
  artifactSha256: digest,
  signedArtifactAuditSha256: digest,
  storeBuildId: "store-build-1",
  distribution,
  physicalDevice: { model: "physical-device", os: "current-supported-os" },
  freshInstall: true,
  nMinusOneUpgrade: true,
  incidentPushReceived: true,
  pushReceiptReconciled: true,
  productionApiVerified: true,
});
const approval = { approved: true, approvedAt: "2026-07-21T12:00:00Z", evidenceSha256: digest };

function readyManifest() {
  return {
    schemaVersion: 1,
    status: "READY",
    application: {
      version: "1.0.0",
      iosBundleIdentifier: "cz.tomasmach.hlasimse",
      iosBuildNumber: "1",
      androidApplicationId: "cz.tomasmach.hlasimse",
      androidVersionCode: 1,
    },
    source: { commit, tree },
    server: {
      image: `ghcr.io/owner/repository/server@sha256:${digest}`,
      runtimeContractSha256: createHash("sha256").update(runtimeContractBytes).digest("hex"),
      runtimeGateSha256: digest,
      scanReportSha256: digest,
      releaseManifestSha256: digest,
      signatureBundleSha256: digest,
      attestationBundleSha256: digest,
      evidenceIndexSha256: digest,
      evidenceArtifactSha256: digest,
      migrationLeaf: "0014_release_contract.py",
    },
    publicContract: {
      origin: "https://www.hlasimse.cz",
      releasePackSha256: createHash("sha256").update(releasePackBytes).digest("hex"),
      termsDocumentSha256: digest,
      privacyDocumentSha256: digest,
    },
    migration: { disposition: "verified-no-production-data", evidenceSha256: digest },
    operations: {
      backupRestore: completed,
      pagingFireDrill: completed,
      smtpDelivery: completed,
      productionSoak: completed,
    },
    mobile: {
      ios: mobileEvidence("testflight"),
      android: mobileEvidence("play-closed"),
    },
    approvals: {
      engineering: approval,
      security: approval,
      legal: approval,
      operations: approval,
    },
  };
}

test("accepts a release bound to complete external evidence", () => {
  assert.deepEqual(validateReleaseReadiness({ manifest: readyManifest(), appConfig, releasePackBytes, runtimeContractBytes, currentCommit: commit, currentTree: tree }), { ok: true, errors: [] });
});

test("rejects draft, source drift, unresolved migration and missing device results", () => {
  const manifest = readyManifest();
  manifest.status = "DRAFT";
  manifest.source.commit = "c".repeat(40);
  manifest.migration.disposition = "UNDECIDED";
  manifest.mobile.android.incidentPushReceived = false;
  const result = validateReleaseReadiness({ manifest, appConfig, releasePackBytes, runtimeContractBytes, currentCommit: commit, currentTree: tree });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("status")));
  assert(result.errors.some((error) => error.includes("commit")));
  assert(result.errors.some((error) => error.includes("migration disposition")));
  assert(result.errors.some((error) => error.includes("incidentPushReceived")));
});

test("rejects release-pack drift and incomplete operations or approvals", () => {
  const manifest = readyManifest();
  manifest.publicContract.releasePackSha256 = digest;
  manifest.operations.backupRestore.passed = false;
  manifest.approvals.security.approved = false;
  const result = validateReleaseReadiness({ manifest, appConfig, releasePackBytes, runtimeContractBytes, currentCommit: commit, currentTree: tree });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("release-pack")));
  assert(result.errors.some((error) => error.includes("backupRestore")));
  assert(result.errors.some((error) => error.includes("security approval")));
});

test("rejects server evidence that is incomplete or detached from the runtime contract", () => {
  const manifest = readyManifest();
  manifest.server.runtimeContractSha256 = digest;
  manifest.server.scanReportSha256 = "<sha256>";
  manifest.server.signatureBundleSha256 = "0".repeat(64);
  const result = validateReleaseReadiness({ manifest, appConfig, releasePackBytes, runtimeContractBytes, currentCommit: commit, currentTree: tree });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("runtime-contract")));
  assert(result.errors.some((error) => error.includes("secret-scan")));
  assert(result.errors.some((error) => error.includes("signature evidence")));
});
