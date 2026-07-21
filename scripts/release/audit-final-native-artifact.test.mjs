import assert from "node:assert/strict";
import test from "node:test";

import {
  assertJarsignerVerified,
  bundletoolManifestCommand,
  createCommandAdapter,
  normalizeSha256,
  normalizeSha256Fingerprint,
  parseCodesignDetails,
  parseKeytoolCertificate,
  validateAndroidArtifactFacts,
  validateIosArtifactFacts,
  validatePrivacyManifest,
} from "./audit-final-native-artifact.mjs";

const fingerprint = "12".repeat(32);
const applicationId = "cz.tomasmach.hlasimse";
const teamId = "A1B2C3D4E5";
const iosPrivacy = {
  NSPrivacyTracking: false,
  NSPrivacyTrackingDomains: [],
  NSPrivacyCollectedDataTypes: [{
    NSPrivacyCollectedDataType: "NSPrivacyCollectedDataTypeEmailAddress",
    NSPrivacyCollectedDataTypeLinked: true,
    NSPrivacyCollectedDataTypeTracking: false,
    NSPrivacyCollectedDataTypePurposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"],
  }],
  NSPrivacyAccessedAPITypes: [],
};

test("normalizes an explicit colon-delimited certificate fingerprint", () => {
  assert.equal(normalizeSha256Fingerprint(`SHA256: ${fingerprint.match(/../g).join(":").toUpperCase()}`), fingerprint);
  assert.throws(() => normalizeSha256Fingerprint("12:34"), /exactly 64/);
});

test("normalizes an independently supplied bundletool digest", () => {
  assert.equal(normalizeSha256(`sha256:${fingerprint}`, "Expected bundletool SHA-256"), fingerprint);
  assert.throws(
    () => normalizeSha256("not-a-digest", "Expected bundletool SHA-256"),
    /Expected bundletool SHA-256 must contain exactly 64/,
  );
});

test("builds a bundletool manifest command with no shell interpolation", () => {
  assert.deepEqual(bundletoolManifestCommand("/tmp/bundle tool.jar", "/tmp/release app.aab"), {
    command: "java",
    args: [
      "-jar",
      "/tmp/bundle tool.jar",
      "dump",
      "manifest",
      "--bundle=/tmp/release app.aab",
      "--module=base",
    ],
  });
});

test("parses keytool certificate output without depending on a real keystore", () => {
  const parsed = parseKeytoolCertificate(`Owner: CN=Hlásím se Upload, O=Example\nIssuer: CN=Hlásím se Upload\nCertificate fingerprints:\n\t SHA256: ${fingerprint.match(/../g).join(":")}\n`);
  assert.deepEqual(parsed, {
    sha256: fingerprint,
    owner: "CN=Hlásím se Upload, O=Example",
    issuer: "CN=Hlásím se Upload",
  });
});

test("requires jarsigner to report a fully signed verified archive", () => {
  assert.doesNotThrow(() => assertJarsignerVerified("jar verified."));
  assert.throws(() => assertJarsignerVerified("jar verified.\nThis jar contains unsigned entries."), /unsigned content/);
  assert.throws(() => assertJarsignerVerified("jar is unsigned."), /verified archive/);
});

test("command adapter fails closed and preserves argument boundaries", () => {
  const calls = [];
  const adapter = createCommandAdapter((command, args) => {
    calls.push([command, args]);
    return { status: command === "ok" ? 0 : 9, stdout: "value", stderr: "failure" };
  });
  assert.equal(adapter.mustRun("ok", ["one value"]).stdout, "value");
  assert.deepEqual(calls[0], ["ok", ["one value"]]);
  assert.throws(() => adapter.mustRun("bad", []), /bad failed: failure/);
});

test("accepts exact Android identity, SDK, permissions and non-debug fingerprint", () => {
  const expo = { version: "1.2.3", android: { package: applicationId, versionCode: 42 } };
  const policy = {
    androidMinSdk: "24",
    androidTargetSdk: "36",
    androidPermissionAllowlist: ["android.permission.INTERNET", "${applicationId}.SIGNATURE_ONLY"],
  };
  const errors = validateAndroidArtifactFacts({
    facts: {
      applicationId,
      versionName: "1.2.3",
      versionCode: "42",
      minSdk: "24",
      targetSdk: "36",
      permissions: ["android.permission.INTERNET", `${applicationId}.SIGNATURE_ONLY`],
    },
    certificate: { sha256: fingerprint, owner: "CN=Hlásím se Upload", issuer: "CN=Hlásím se Upload" },
    expectedCertificateSha256: fingerprint,
    expo,
    policy,
  });
  assert.deepEqual(errors, []);
});

test("rejects Android debug signing and every material manifest mismatch", () => {
  const errors = validateAndroidArtifactFacts({
    facts: {
      applicationId: "wrong.app",
      versionName: "9.0.0",
      versionCode: "99",
      minSdk: "23",
      targetSdk: "35",
      permissions: ["android.permission.CAMERA"],
    },
    certificate: { sha256: "34".repeat(32), owner: "CN=Android Debug", issuer: "CN=Android Debug" },
    expectedCertificateSha256: fingerprint,
    expo: { version: "1.2.3", android: { package: applicationId, versionCode: 42 } },
    policy: { androidMinSdk: "24", androidTargetSdk: "36", androidPermissionAllowlist: ["android.permission.INTERNET"] },
  });
  assert.equal(errors.length, 8);
  assert(errors.some((error) => error.includes("debug certificate")));
  assert(errors.some((error) => error.includes("permissions")));
  assert(errors.some((error) => error.includes("certificate SHA-256")));
});

test("parses codesign identity and authority chain", () => {
  assert.deepEqual(parseCodesignDetails(`Executable=/tmp/App\nIdentifier=${applicationId}\nAuthority=Apple Distribution: Example\nAuthority=Apple Worldwide Developer Relations Certification Authority\nTeamIdentifier=${teamId}\n`), {
    identifier: applicationId,
    teamIdentifier: teamId,
    authorities: ["Apple Distribution: Example", "Apple Worldwide Developer Relations Certification Authority"],
    signature: null,
  });
});

function validIosFacts() {
  const appIdentifier = `${teamId}.${applicationId}`;
  return {
    info: { CFBundleIdentifier: applicationId, CFBundleShortVersionString: "1.2.3", CFBundleVersion: "42" },
    entitlements: {
      "application-identifier": appIdentifier,
      "com.apple.developer.team-identifier": teamId,
      "aps-environment": "production",
      "get-task-allow": false,
    },
    provisioning: {
      UUID: "fixture-profile",
      TeamIdentifier: [teamId],
      ExpirationDate: "2030-01-01T00:00:00.000Z",
      Entitlements: {
        "application-identifier": appIdentifier,
        "aps-environment": "production",
        "get-task-allow": false,
      },
    },
    codesign: {
      identifier: applicationId,
      teamIdentifier: teamId,
      authorities: ["Apple Distribution: Example", "Apple Worldwide Developer Relations Certification Authority"],
      signature: null,
    },
    privacy: iosPrivacy,
    expectedTeamId: teamId,
    expo: {
      version: "1.2.3",
      ios: { bundleIdentifier: applicationId, buildNumber: "42", privacyManifests: iosPrivacy },
    },
    now: new Date("2029-01-01T00:00:00.000Z"),
  };
}

test("accepts an App Store distribution iOS identity and exact privacy manifest", () => {
  assert.deepEqual(validateIosArtifactFacts(validIosFacts()), []);
});

test("rejects ad-hoc/development, device-bound, debug, expired and non-production APNs iOS artifacts", () => {
  const fixture = validIosFacts();
  fixture.codesign.signature = "adhoc";
  fixture.codesign.authorities = ["Apple Development: Example"];
  fixture.entitlements["get-task-allow"] = true;
  fixture.entitlements["aps-environment"] = "development";
  fixture.provisioning.ProvisionedDevices = ["device-1"];
  fixture.provisioning.ExpirationDate = "2020-01-01T00:00:00.000Z";
  fixture.provisioning.Entitlements["get-task-allow"] = true;
  fixture.provisioning.Entitlements["aps-environment"] = "development";
  const errors = validateIosArtifactFacts(fixture);
  assert(errors.some((error) => error.includes("development certificate")));
  assert(errors.some((error) => error.includes("ad-hoc")));
  assert(errors.some((error) => error.includes("device-bound")));
  assert(errors.some((error) => error.includes("expired")));
  assert.equal(errors.filter((error) => error.includes("production APNs")).length, 2);
  assert.equal(errors.filter((error) => error.includes("get-task-allow")).length, 2);
});

test("privacy validation compares purposes and accessed-API reason codes, not only category names", () => {
  const actual = structuredClone(iosPrivacy);
  actual.NSPrivacyCollectedDataTypes[0].NSPrivacyCollectedDataTypePurposes = ["NSPrivacyCollectedDataTypePurposeAnalytics"];
  actual.NSPrivacyAccessedAPITypes = [{
    NSPrivacyAccessedAPIType: "NSPrivacyAccessedAPICategoryUserDefaults",
    NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
  }];
  const errors = validatePrivacyManifest(actual, iosPrivacy);
  assert.deepEqual(errors, [
    "App privacy collected-data declarations differ from app.json",
    "App privacy accessed-API reasons differ from app.json",
  ]);
});
