import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function argumentsMap(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    assert(key?.startsWith("--") && value, `Invalid argument near ${key ?? "end"}`);
    result[key.slice(2)] = value;
  }
  return result;
}

function withoutXmlComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, "");
}

export function androidManifestFacts(xml) {
  const clean = withoutXmlComments(xml);
  const manifest = clean.match(/<manifest\b([^>]*)>/)?.[1] ?? "";
  const attr = (name, source = manifest) =>
    source.match(new RegExp(`(?:android:)?${name}="([^"]+)"`))?.[1];
  const permissions = [...clean.matchAll(/<uses-permission\b[^>]*android:name="([^"]+)"[^>]*>/g)]
    .map((match) => match[1])
    .sort();
  const sdk = clean.match(/<uses-sdk\b([^>]*)>/)?.[1] ?? "";
  return {
    applicationId: attr("package"),
    versionCode: attr("versionCode"),
    versionName: attr("versionName"),
    minSdk: attr("minSdkVersion", sdk),
    targetSdk: attr("targetSdkVersion", sdk),
    permissions,
  };
}

function readPlist(file) {
  return JSON.parse(execFileSync("plutil", ["-convert", "json", "-o", "-", file], { encoding: "utf8" }));
}

function projectSetting(project, name) {
  return [...project.matchAll(new RegExp(`${name} = ([^;]+);`, "g"))].map((match) =>
    match[1].replace(/^"|"$/g, ""),
  );
}

function isPlaceholderIdentity(value) {
  return /(^|\.)anonymous(\.|$)|placeholder|example/i.test(value ?? "");
}

function collectPrivacyTypes(entries, key) {
  return (entries ?? []).map((entry) => entry[key]).sort();
}

function normalizedCollectedData(entries) {
  return (entries ?? [])
    .map((entry) => ({
      type: entry.NSPrivacyCollectedDataType,
      linked: entry.NSPrivacyCollectedDataTypeLinked,
      tracking: entry.NSPrivacyCollectedDataTypeTracking,
      purposes: [...(entry.NSPrivacyCollectedDataTypePurposes ?? [])].sort(),
    }))
    .sort((left, right) => left.type.localeCompare(right.type));
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  assert(["android", "ios"].includes(args.platform), "--platform must be android or ios");
  assert(args.evidence, "--evidence is required");

  const appConfig = JSON.parse(await readFile(args.config ?? "apps/mobile/app.json", "utf8"));
  const policy = JSON.parse(await readFile(args.policy ?? "scripts/release/native-release-policy.json", "utf8"));
  const expo = appConfig.expo;
  const errors = [];
  const check = (condition, message) => {
    if (!condition) errors.push(message);
  };
  let evidence;

  if (args.platform === "android") {
    assert(args.manifest && args.artifact, "Android audit requires --manifest and --artifact");
    assert(/^[a-f0-9]{64}$/.test(args["bundle-manifest-sha256"] ?? ""), "Android audit requires the SHA-256 of the compiled AAB base manifest");
    const facts = androidManifestFacts(await readFile(args.manifest, "utf8"));
    const expectedPermissions = policy.androidPermissionAllowlist
      .map((permission) => permission.replace("${applicationId}", expo.android.package))
      .sort();
    const artifactStats = await stat(args.artifact);
    const certificate = execFileSync("keytool", ["-printcert", "-jarfile", args.artifact], {
      encoding: "utf8",
    });

    check(facts.applicationId === expo.android.package, "AAB applicationId differs from app.json");
    check(facts.versionName === expo.version, "AAB versionName differs from app.json");
    check(facts.versionCode === String(expo.android.versionCode), "AAB versionCode differs from app.json");
    check(facts.minSdk === policy.androidMinSdk, "Android minSdk differs from the reviewed release policy");
    check(facts.targetSdk === policy.androidTargetSdk, "Android targetSdk differs from the reviewed release policy");
    check(!isPlaceholderIdentity(facts.applicationId), "Android applicationId is still a placeholder");
    check(JSON.stringify(facts.permissions) === JSON.stringify(expectedPermissions), "Android permissions differ from the exact reviewed allowlist");
    check(artifactStats.size > 0, "Android AAB is empty");
    check(/CN=Android Debug/i.test(certificate), "Candidate AAB must be explicitly test-signed with the Android debug certificate");

    evidence = {
      platform: "android",
      artifact: path.resolve(args.artifact),
      artifactBytes: artifactStats.size,
      sha256: await sha256(args.artifact),
      compiledBaseManifestSha256: args["bundle-manifest-sha256"],
      manifestEvidence: "Gradle merged release manifest plus the hash of the non-empty compiled AAB base manifest",
      identity: facts,
      signing: "test-signed-android-debug-certificate-not-publishable",
      candidateGatePassed: errors.length === 0,
      releaseEligible: false,
      publicationBlockers: [
        "Final upload-key/store signing and Play closed-track installation are not verified",
      ],
      errors,
    };
  } else {
    assert(args.privacy && args.info && args.project, "iOS audit requires --privacy, --info and --project");
    const privacy = readPlist(args.privacy);
    const info = readPlist(args.info);
    const project = await readFile(args.project, "utf8");
    const bundleIds = projectSetting(project, "PRODUCT_BUNDLE_IDENTIFIER");
    const buildNumbers = projectSetting(project, "CURRENT_PROJECT_VERSION");
    const configuredCollectedEntries = normalizedCollectedData(expo.ios.privacyManifests.NSPrivacyCollectedDataTypes);
    const generatedCollectedEntries = normalizedCollectedData(privacy.NSPrivacyCollectedDataTypes);
    const generatedCollected = collectPrivacyTypes(
      privacy.NSPrivacyCollectedDataTypes,
      "NSPrivacyCollectedDataType",
    );
    const accessed = collectPrivacyTypes(
      privacy.NSPrivacyAccessedAPITypes,
      "NSPrivacyAccessedAPIType",
    );
    const generatedUsageDescriptions = Object.keys(info)
      .filter((key) => /^NS.+UsageDescription$/.test(key))
      .sort();

    check(bundleIds.length > 0 && bundleIds.every((value) => value === expo.ios.bundleIdentifier), "Generated Xcode bundle identifier differs from app.json");
    check(buildNumbers.length > 0 && buildNumbers.every((value) => value === expo.ios.buildNumber), "Generated Xcode build number differs from app.json");
    check(info.CFBundleShortVersionString === expo.version, "Generated iOS version differs from app.json");
    check(info.CFBundleVersion === expo.ios.buildNumber, "Generated iOS build number differs from app.json");
    check(!isPlaceholderIdentity(expo.ios.bundleIdentifier), "iOS bundle identifier is still a placeholder");
    check(privacy.NSPrivacyTracking === false, "Generated iOS privacy manifest must explicitly disable tracking");
    check(JSON.stringify(generatedCollectedEntries) === JSON.stringify(configuredCollectedEntries), "Generated iOS collected-data declarations differ from app.json");
    check(JSON.stringify(privacy.NSPrivacyTrackingDomains ?? []) === "[]", "Generated iOS privacy manifest must not declare tracking domains");
    check(JSON.stringify(accessed) === JSON.stringify([...policy.iosAppTargetAccessedApiAllowlist].sort()), "Generated iOS app-target accessed-API declarations differ from the reviewed allowlist");
    check(info.NSAppTransportSecurity?.NSAllowsArbitraryLoads === false, "Generated iOS config must disable arbitrary network loads");
    check(info.NSAppTransportSecurity?.NSAllowsLocalNetworking === false, "Generated iOS config must disable local networking");
    check(
      JSON.stringify(generatedUsageDescriptions) ===
        JSON.stringify([...policy.iosUsageDescriptionAllowlist].sort()),
      "Generated iOS usage descriptions differ from the exact reviewed allowlist",
    );

    evidence = {
      platform: "ios",
      artifact: args.archive ? path.resolve(args.archive) : null,
      identity: {
        bundleIdentifier: expo.ios.bundleIdentifier,
        version: info.CFBundleShortVersionString,
        buildNumber: info.CFBundleVersion,
      },
      privacy: {
        tracking: privacy.NSPrivacyTracking,
        collectedDataTypes: generatedCollected,
        accessedApiTypes: accessed,
        usageDescriptions: generatedUsageDescriptions,
      },
      signing: args.archive ? "unsigned-archive-config-inspection-only" : "generated-native-config-only",
      candidateGatePassed: errors.length === 0,
      releaseEligible: false,
      publicationBlockers: [
        "Distribution-signed archive, TestFlight installation, and aggregated Xcode privacy report are not verified",
      ],
      errors,
    };
  }

  await writeFile(args.evidence, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  if (errors.length > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
