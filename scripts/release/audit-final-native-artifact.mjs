import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { androidManifestFacts } from "./audit-native-candidate.mjs";

const PLACEHOLDER_IDENTITY = /(^|\.)anonymous(\.|$)|placeholder|example/i;
const HEX_SHA256 = /^[a-f0-9]{64}$/;

export function argumentsMap(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(key?.startsWith("--") && value, `Invalid argument near ${key ?? "end"}`);
    result[key.slice(2)] = value;
  }
  return result;
}

export function createCommandAdapter(run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return {
    status: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}) {
  return {
    run,
    mustRun(command, args, options = {}) {
      const result = run(command, args, options);
      if (result.error || result.status !== 0) {
        const detail = (result.stderr || result.stdout || result.error?.message || "no output").trim();
        throw new Error(`${command} failed: ${detail}`);
      }
      return result;
    },
  };
}

export function normalizeSha256Fingerprint(value) {
  return normalizeSha256(value, "Expected certificate SHA-256");
}

export function normalizeSha256(value, label = "Expected SHA-256") {
  const normalized = String(value ?? "").toLowerCase().replace(/^sha-?256\s*:?\s*/i, "").replace(/[^a-f0-9]/g, "");
  assert(HEX_SHA256.test(normalized), `${label} must contain exactly 64 hexadecimal characters`);
  return normalized;
}

export function parseKeytoolCertificate(output) {
  const fingerprint = output.match(/SHA\s*256\s*:\s*([A-Fa-f0-9: -]{64,})/i)?.[1];
  assert(fingerprint, "keytool output does not contain a SHA-256 certificate fingerprint");
  return {
    sha256: normalizeSha256Fingerprint(fingerprint),
    owner: output.match(/^(?:Owner|Subject):\s*(.+)$/im)?.[1]?.trim() ?? null,
    issuer: output.match(/^Issuer:\s*(.+)$/im)?.[1]?.trim() ?? null,
  };
}

export function assertJarsignerVerified(output) {
  assert(/jar verified\./i.test(output), "jarsigner did not report a verified archive");
  assert(!/jar is unsigned|unsigned entries|not signed/i.test(output), "jarsigner reported unsigned content");
}

function expectedAndroidPermissions(policy, applicationId) {
  return policy.androidPermissionAllowlist
    .map((permission) => permission.replace("${applicationId}", applicationId))
    .sort();
}

export function bundletoolManifestCommand(bundletool, artifact) {
  return {
    command: "java",
    args: [
      "-jar",
      bundletool,
      "dump",
      "manifest",
      `--bundle=${artifact}`,
      "--module=base",
    ],
  };
}

export function validateAndroidArtifactFacts({ facts, certificate, expectedCertificateSha256, expo, policy }) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const expectedFingerprint = normalizeSha256Fingerprint(expectedCertificateSha256);
  const expectedPermissions = expectedAndroidPermissions(policy, expo.android.package);

  check(!PLACEHOLDER_IDENTITY.test(expo.android.package), "Android application ID is still a placeholder");
  check(facts.applicationId === expo.android.package, "AAB application ID differs from app.json");
  check(facts.versionName === expo.version, "AAB versionName differs from app.json");
  check(facts.versionCode === String(expo.android.versionCode), "AAB versionCode differs from app.json");
  check(facts.minSdk === policy.androidMinSdk, "AAB minSdk differs from native release policy");
  check(facts.targetSdk === policy.androidTargetSdk, "AAB targetSdk differs from native release policy");
  check(
    JSON.stringify(facts.permissions) === JSON.stringify(expectedPermissions),
    "AAB permissions differ from the exact native release policy allowlist",
  );
  check(certificate.sha256 === expectedFingerprint, "AAB signing certificate SHA-256 differs from the explicit expected upload certificate");
  check(!/android debug/i.test(`${certificate.owner ?? ""} ${certificate.issuer ?? ""}`), "AAB is signed with an Android debug certificate");
  return errors;
}

export function parseCodesignDetails(output) {
  return {
    identifier: output.match(/^Identifier=(.+)$/m)?.[1]?.trim() ?? null,
    teamIdentifier: output.match(/^TeamIdentifier=(.+)$/m)?.[1]?.trim() ?? null,
    authorities: [...output.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1].trim()),
    signature: output.match(/^Signature=(.+)$/m)?.[1]?.trim() ?? null,
  };
}

function normalizeCollectedData(entries = []) {
  return entries
    .map((entry) => ({
      type: entry.NSPrivacyCollectedDataType,
      linked: entry.NSPrivacyCollectedDataTypeLinked,
      tracking: entry.NSPrivacyCollectedDataTypeTracking,
      purposes: [...(entry.NSPrivacyCollectedDataTypePurposes ?? [])].sort(),
    }))
    .sort((left, right) => String(left.type).localeCompare(String(right.type)));
}

function normalizeAccessedApis(entries = []) {
  return entries
    .map((entry) => ({
      type: entry.NSPrivacyAccessedAPIType,
      reasons: [...(entry.NSPrivacyAccessedAPITypeReasons ?? [])].sort(),
    }))
    .sort((left, right) => String(left.type).localeCompare(String(right.type)));
}

export function validatePrivacyManifest(actual, configured) {
  const errors = [];
  if (actual.NSPrivacyTracking !== configured.NSPrivacyTracking) {
    errors.push("App privacy tracking declaration differs from app.json");
  }
  if (JSON.stringify(actual.NSPrivacyTrackingDomains ?? []) !== JSON.stringify(configured.NSPrivacyTrackingDomains ?? [])) {
    errors.push("App privacy tracking domains differ from app.json");
  }
  if (JSON.stringify(normalizeCollectedData(actual.NSPrivacyCollectedDataTypes)) !== JSON.stringify(normalizeCollectedData(configured.NSPrivacyCollectedDataTypes))) {
    errors.push("App privacy collected-data declarations differ from app.json");
  }
  if (JSON.stringify(normalizeAccessedApis(actual.NSPrivacyAccessedAPITypes)) !== JSON.stringify(normalizeAccessedApis(configured.NSPrivacyAccessedAPITypes))) {
    errors.push("App privacy accessed-API reasons differ from app.json");
  }
  return errors;
}

export function validateIosArtifactFacts({
  info,
  entitlements,
  provisioning,
  codesign,
  privacy,
  expectedTeamId,
  expo,
  now = new Date(),
}) {
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const teamId = String(expectedTeamId ?? "").trim();
  check(/^[A-Z0-9]{10}$/.test(teamId), "Expected Apple Team ID must be 10 uppercase letters or digits");
  check(!PLACEHOLDER_IDENTITY.test(expo.ios.bundleIdentifier), "iOS bundle identifier is still a placeholder");
  check(info.CFBundleIdentifier === expo.ios.bundleIdentifier, "Signed app bundle identifier differs from app.json");
  check(info.CFBundleShortVersionString === expo.version, "Signed app version differs from app.json");
  check(String(info.CFBundleVersion) === String(expo.ios.buildNumber), "Signed app build number differs from app.json");
  check(codesign.identifier === expo.ios.bundleIdentifier, "codesign identifier differs from app.json");
  check(codesign.teamIdentifier === teamId, "codesign TeamIdentifier differs from the explicit expected Team ID");
  check(codesign.authorities.length > 0, "Signed app has no certificate authority chain");
  check(!codesign.authorities.some((authority) => /apple development|iphone developer/i.test(authority)), "Signed app uses a development certificate");
  check(!/adhoc/i.test(codesign.signature ?? ""), "Signed app uses an ad-hoc signature");

  const applicationIdentifier = `${teamId}.${expo.ios.bundleIdentifier}`;
  check(entitlements["com.apple.developer.team-identifier"] === teamId, "Signed entitlements Team ID differs from expected Team ID");
  check(entitlements["application-identifier"] === applicationIdentifier, "Signed application-identifier entitlement is invalid");
  check(entitlements["aps-environment"] === "production", "Signed app must use the production APNs environment");
  check(entitlements["get-task-allow"] !== true, "Signed app enables get-task-allow");

  check(Array.isArray(provisioning.TeamIdentifier) && provisioning.TeamIdentifier.includes(teamId), "Provisioning profile TeamIdentifier differs from expected Team ID");
  check(provisioning.Entitlements?.["application-identifier"] === applicationIdentifier, "Provisioning profile application identifier is invalid");
  check(provisioning.Entitlements?.["aps-environment"] === "production", "Provisioning profile must use the production APNs environment");
  check(provisioning.Entitlements?.["get-task-allow"] !== true, "Provisioning profile enables get-task-allow");
  check(!Array.isArray(provisioning.ProvisionedDevices), "Provisioning profile is device-bound instead of App Store distribution");
  check(provisioning.ProvisionsAllDevices !== true, "Provisioning profile is an enterprise profile");
  const expiration = new Date(provisioning.ExpirationDate);
  check(!Number.isNaN(expiration.valueOf()) && expiration > now, "Provisioning profile is expired or has no valid expiration date");
  errors.push(...validatePrivacyManifest(privacy, expo.ios.privacyManifests ?? {}));
  return errors;
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function hashTree(root) {
  const hash = createHash("sha256");
  let bytes = 0;
  async function visit(directory, relative = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      const metadata = await lstat(absolute);
      if (entry.isDirectory()) {
        hash.update(`d\0${childRelative}\0${metadata.mode & 0o777}\0`);
        await visit(absolute, childRelative);
      } else if (entry.isSymbolicLink()) {
        hash.update(`l\0${childRelative}\0${await readlink(absolute)}\0`);
      } else if (entry.isFile()) {
        const contents = await readFile(absolute);
        hash.update(`f\0${childRelative}\0${metadata.mode & 0o777}\0${contents.length}\0`);
        hash.update(contents);
        bytes += contents.length;
      }
    }
  }
  await visit(root);
  return { sha256: hash.digest("hex"), bytes };
}

function jsonFromPlistFile(adapter, file) {
  const result = adapter.mustRun("plutil", ["-convert", "json", "-o", "-", file]);
  return JSON.parse(result.stdout);
}

function jsonFromPlistText(adapter, value) {
  const start = value.indexOf("<?xml");
  const end = value.lastIndexOf("</plist>");
  assert(start >= 0 && end >= start, "Command output does not contain an XML property list");
  const plist = value.slice(start, end + "</plist>".length);
  const result = adapter.mustRun("plutil", ["-convert", "json", "-o", "-", "-"], { input: plist });
  return JSON.parse(result.stdout);
}

async function singleAppIn(directory) {
  const apps = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.join(directory, entry.name));
  assert.equal(apps.length, 1, `Expected exactly one .app in ${directory}`);
  return apps[0];
}

async function locateIosApp(artifact, adapter) {
  const metadata = await stat(artifact);
  if (metadata.isDirectory()) {
    assert(artifact.endsWith(".xcarchive"), "iOS artifact directory must be an .xcarchive");
    return {
      app: await singleAppIn(path.join(artifact, "Products", "Applications")),
      cleanup: async () => {},
      artifactIdentity: await hashTree(artifact),
      artifactKind: "xcarchive-tree",
    };
  }
  assert(artifact.endsWith(".ipa"), "iOS artifact file must be an .ipa");
  const temporary = await mkdtemp(path.join(tmpdir(), "hlasimse-final-ios-audit-"));
  try {
    adapter.mustRun("unzip", ["-qq", artifact, "-d", temporary]);
    return {
      app: await singleAppIn(path.join(temporary, "Payload")),
      cleanup: async () => rm(temporary, { recursive: true, force: true }),
      artifactIdentity: { sha256: await sha256File(artifact), bytes: metadata.size },
      artifactKind: "ipa",
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function auditAndroid({
  artifact,
  bundletool,
  expectedBundletoolSha256,
  expectedCertificateSha256,
  expo,
  policy,
  adapter,
}) {
  assert(artifact.endsWith(".aab"), "Android artifact must be an .aab");
  const metadata = await stat(artifact);
  assert(metadata.isFile() && metadata.size > 0, "Android AAB must be a non-empty file");
  assert(bundletool.endsWith(".jar"), "--bundletool must point to a bundletool-all JAR");
  const bundletoolMetadata = await stat(bundletool);
  assert(bundletoolMetadata.isFile() && bundletoolMetadata.size > 0, "bundletool JAR must be a non-empty file");
  const bundletoolSha256 = await sha256File(bundletool);
  assert.equal(
    bundletoolSha256,
    normalizeSha256(expectedBundletoolSha256, "Expected bundletool SHA-256"),
    "bundletool JAR SHA-256 differs from the independently supplied expected digest",
  );
  const jarsigner = adapter.mustRun("jarsigner", ["-verify", "-verbose", "-certs", artifact]);
  assertJarsignerVerified(`${jarsigner.stdout}\n${jarsigner.stderr}`);
  const keytool = adapter.mustRun("keytool", [
    "-J-Duser.language=en",
    "-J-Duser.country=US",
    "-printcert",
    "-jarfile",
    artifact,
  ]);
  const certificate = parseKeytoolCertificate(`${keytool.stdout}\n${keytool.stderr}`);
  const manifestCommand = bundletoolManifestCommand(bundletool, artifact);
  const manifestResult = adapter.mustRun(manifestCommand.command, manifestCommand.args);
  const facts = androidManifestFacts(manifestResult.stdout);
  const errors = validateAndroidArtifactFacts({
    facts,
    certificate,
    expectedCertificateSha256,
    expo,
    policy,
  });
  return {
    platform: "android",
    artifact: path.resolve(artifact),
    artifactKind: "aab",
    artifactBytes: metadata.size,
    sha256: await sha256File(artifact),
    identity: facts,
    signing: {
      verified: true,
      certificateSha256: certificate.sha256,
      certificateOwner: certificate.owner,
      certificateIssuer: certificate.issuer,
    },
    manifestExtractionTool: {
      kind: "bundletool-all-jar",
      path: path.resolve(bundletool),
      sha256: bundletoolSha256,
      bytes: bundletoolMetadata.size,
    },
    errors,
  };
}

async function auditIos({ artifact, expectedTeamId, expo, adapter }) {
  assert(process.platform === "darwin", "iOS signed-artifact audit must run on macOS");
  const located = await locateIosApp(artifact, adapter);
  try {
    adapter.mustRun("codesign", ["--verify", "--deep", "--strict", "--verbose=2", located.app]);
    const detailResult = adapter.mustRun("codesign", ["-d", "--verbose=4", located.app]);
    const codesign = parseCodesignDetails(`${detailResult.stdout}\n${detailResult.stderr}`);
    const entitlementResult = adapter.mustRun("codesign", ["-d", "--entitlements", ":-", located.app]);
    const entitlements = jsonFromPlistText(adapter, `${entitlementResult.stdout}\n${entitlementResult.stderr}`);
    const info = jsonFromPlistFile(adapter, path.join(located.app, "Info.plist"));
    const privacyPath = path.join(located.app, "PrivacyInfo.xcprivacy");
    const privacy = jsonFromPlistFile(adapter, privacyPath);
    const provisionPath = path.join(located.app, "embedded.mobileprovision");
    const provisionResult = adapter.mustRun("security", ["cms", "-D", "-i", provisionPath]);
    const provisioning = jsonFromPlistText(adapter, provisionResult.stdout);
    const errors = validateIosArtifactFacts({
      info,
      entitlements,
      provisioning,
      codesign,
      privacy,
      expectedTeamId,
      expo,
    });
    return {
      platform: "ios",
      artifact: path.resolve(artifact),
      artifactKind: located.artifactKind,
      artifactBytes: located.artifactIdentity.bytes,
      sha256: located.artifactIdentity.sha256,
      appBundleSha256: (await hashTree(located.app)).sha256,
      identity: {
        bundleIdentifier: info.CFBundleIdentifier,
        version: info.CFBundleShortVersionString,
        buildNumber: String(info.CFBundleVersion),
        teamIdentifier: codesign.teamIdentifier,
      },
      signing: {
        verified: true,
        authorities: codesign.authorities,
        provisioningUuid: provisioning.UUID ?? null,
        provisioningExpiration: provisioning.ExpirationDate ?? null,
        apsEnvironment: entitlements["aps-environment"] ?? null,
      },
      privacyManifestSha256: await sha256File(privacyPath),
      errors,
    };
  } finally {
    await located.cleanup();
  }
}

async function writeEvidence(file, evidence) {
  await mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await writeFile(file, `${JSON.stringify(evidence, null, 2)}\n`);
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  assert(["android", "ios"].includes(args.platform), "--platform must be android or ios");
  assert(args.artifact, "--artifact is required");
  assert(args.evidence, "--evidence is required");
  if (args.platform === "android") {
    assert(args.bundletool, "Android requires --bundletool");
    assert(args["expected-bundletool-sha256"], "Android requires --expected-bundletool-sha256");
    assert(args["expected-certificate-sha256"], "Android requires --expected-certificate-sha256");
  }
  if (args.platform === "ios") assert(args["expected-team-id"], "iOS requires --expected-team-id");

  const appConfig = JSON.parse(await readFile(args.config ?? "apps/mobile/app.json", "utf8"));
  const policy = JSON.parse(await readFile(args.policy ?? "scripts/release/native-release-policy.json", "utf8"));
  const adapter = createCommandAdapter();
  let evidence;
  try {
    evidence = args.platform === "android"
      ? await auditAndroid({
        artifact: args.artifact,
        bundletool: args.bundletool,
        expectedBundletoolSha256: args["expected-bundletool-sha256"],
        expectedCertificateSha256: args["expected-certificate-sha256"],
        expo: appConfig.expo,
        policy,
        adapter,
      })
      : await auditIos({
        artifact: args.artifact,
        expectedTeamId: args["expected-team-id"],
        expo: appConfig.expo,
        adapter,
      });
  } catch (error) {
    evidence = {
      platform: args.platform,
      artifact: path.resolve(args.artifact),
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  evidence.schemaVersion = 1;
  evidence.scope = "final-signed-native-artifact-audit-only";
  evidence.artifactAuditPassed = evidence.errors.length === 0;
  evidence.releaseEligible = false;
  evidence.releaseEligibilityReason = "Passing this audit does not satisfy store-track, physical-device, legal, migration, or operational release gates.";
  await writeEvidence(args.evidence, evidence);
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.artifactAuditPassed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
