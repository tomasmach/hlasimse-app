import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT = /^[a-f0-9]{40}$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const APP_ID = "cz.tomasmach.hlasimse";
const ORIGIN = "https://www.hlasimse.cz";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nonPlaceholderSha(value) {
  return SHA256.test(value ?? "") && !/^0{64}$/.test(value);
}

function completedEvidence(item) {
  return item?.passed === true
    && UTC_TIMESTAMP.test(item.completedAt ?? "")
    && nonPlaceholderSha(item.evidenceSha256);
}

export function validateReleaseReadiness({
  manifest,
  appConfig,
  releasePackBytes,
  runtimeContractBytes,
  currentCommit,
  currentTree,
}) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const expo = appConfig.expo;

  check(manifest.schemaVersion === 1, "schemaVersion must be 1");
  check(manifest.status === "READY", "status must be READY");
  check(manifest.application?.version === expo.version, "release version differs from app.json");
  check(manifest.application?.iosBundleIdentifier === APP_ID, "iOS bundle identifier is invalid");
  check(manifest.application?.iosBuildNumber === expo.ios.buildNumber, "iOS build number differs from app.json");
  check(manifest.application?.androidApplicationId === APP_ID, "Android application ID is invalid");
  check(manifest.application?.androidVersionCode === expo.android.versionCode, "Android version code differs from app.json");

  check(GIT_OBJECT.test(manifest.source?.commit ?? ""), "source commit must be an exact Git object ID");
  check(GIT_OBJECT.test(manifest.source?.tree ?? ""), "source tree must be an exact Git object ID");
  check(manifest.source?.commit === currentCommit, "source commit differs from the audited checkout");
  check(manifest.source?.tree === currentTree, "source tree differs from the audited checkout");
  check(/^ghcr\.io\/[a-z0-9._/-]+\/server@sha256:[a-f0-9]{64}$/.test(manifest.server?.image ?? ""), "server image must use an immutable GHCR digest");
  check(manifest.server?.runtimeContractSha256 === sha256(runtimeContractBytes), "runtime-contract SHA-256 differs from the tracked bytes");
  check(nonPlaceholderSha(manifest.server?.runtimeGateSha256), "server runtime-gate evidence is missing");
  check(nonPlaceholderSha(manifest.server?.scanReportSha256), "server vulnerability and secret-scan evidence is missing");
  check(nonPlaceholderSha(manifest.server?.releaseManifestSha256), "server release-manifest evidence is missing");
  check(nonPlaceholderSha(manifest.server?.signatureBundleSha256), "server signature evidence is missing");
  check(nonPlaceholderSha(manifest.server?.attestationBundleSha256), "server attestation evidence is missing");
  check(nonPlaceholderSha(manifest.server?.evidenceIndexSha256), "server evidence index is missing");
  check(nonPlaceholderSha(manifest.server?.evidenceArtifactSha256), "server evidence artifact is missing");
  check(/^\d{4}_[a-z0-9_]+\.py$/.test(manifest.server?.migrationLeaf ?? ""), "migration leaf is invalid");

  check(manifest.publicContract?.origin === ORIGIN, "public origin differs from the production contract");
  check(manifest.publicContract?.releasePackSha256 === sha256(releasePackBytes), "release-pack SHA-256 differs from the tracked bytes");
  check(nonPlaceholderSha(manifest.publicContract?.termsDocumentSha256), "terms document SHA-256 is missing");
  check(nonPlaceholderSha(manifest.publicContract?.privacyDocumentSha256), "privacy document SHA-256 is missing");
  check(["migrated", "verified-no-production-data"].includes(manifest.migration?.disposition), "Supabase migration disposition is unresolved");
  check(nonPlaceholderSha(manifest.migration?.evidenceSha256), "Supabase disposition evidence is missing");

  for (const key of ["backupRestore", "pagingFireDrill", "smtpDelivery", "productionSoak"]) {
    check(completedEvidence(manifest.operations?.[key]), `${key} evidence is incomplete`);
  }

  for (const [platform, distribution] of [["ios", "testflight"], ["android", "play-closed"]]) {
    const evidence = manifest.mobile?.[platform];
    check(evidence?.distribution === distribution, `${platform} distribution channel is invalid`);
    check(nonPlaceholderSha(evidence?.artifactSha256), `${platform} artifact SHA-256 is missing`);
    check(nonPlaceholderSha(evidence?.signedArtifactAuditSha256), `${platform} signed-artifact audit is missing`);
    check(typeof evidence?.storeBuildId === "string" && evidence.storeBuildId.trim().length > 0, `${platform} store build ID is missing`);
    check(typeof evidence?.physicalDevice?.model === "string" && evidence.physicalDevice.model.trim().length > 0, `${platform} physical device model is missing`);
    check(typeof evidence?.physicalDevice?.os === "string" && evidence.physicalDevice.os.trim().length > 0, `${platform} physical device OS is missing`);
    for (const result of ["freshInstall", "nMinusOneUpgrade", "incidentPushReceived", "pushReceiptReconciled", "productionApiVerified"]) {
      check(evidence?.[result] === true, `${platform} ${result} did not pass`);
    }
  }

  for (const role of ["engineering", "security", "legal", "operations"]) {
    const approval = manifest.approvals?.[role];
    check(approval?.approved === true, `${role} approval is missing`);
    check(UTC_TIMESTAMP.test(approval?.approvedAt ?? ""), `${role} approval timestamp is invalid`);
    check(nonPlaceholderSha(approval?.evidenceSha256), `${role} approval evidence is missing`);
  }

  return { ok: errors.length === 0, errors };
}

function argumentValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

async function main() {
  const manifestPath = argumentValue("--manifest", "docs/release/readiness-manifest.json");
  assert(manifestPath, "--manifest requires a path");
  const [manifestBytes, appBytes, releasePackBytes, runtimeContractBytes] = await Promise.all([
    readFile(manifestPath),
    readFile("apps/mobile/app.json"),
    readFile("docs/store/release-pack.json"),
    readFile("deploy/runtime-contract.json"),
  ]);
  const result = validateReleaseReadiness({
    manifest: JSON.parse(manifestBytes),
    appConfig: JSON.parse(appBytes),
    releasePackBytes,
    runtimeContractBytes,
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    currentTree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
  });
  if (!result.ok) {
    console.error("Release readiness manifest is not complete:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log("Release readiness manifest passed every repository and external-evidence gate.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
