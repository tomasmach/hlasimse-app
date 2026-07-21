import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";

const EXPECTED_APPLICATION_ID = "cz.tomasmach.hlasimse";
const EXPECTED_API_URL = "https://www.hlasimse.cz";

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateStaticEasConfig(appConfig, easConfig) {
  const expo = appConfig.expo;
  const production = easConfig.build?.production;
  const submit = easConfig.submit?.production;

  assert.equal(expo.ios?.bundleIdentifier, EXPECTED_APPLICATION_ID);
  assert.equal(expo.android?.package, EXPECTED_APPLICATION_ID);
  assert.match(expo.extra?.eas?.projectId ?? "", /^[0-9a-f-]{36}$/i);
  assert.equal(easConfig.cli?.requireCommit, true);
  assert.equal(easConfig.cli?.appVersionSource, "remote");
  assert.match(easConfig.cli?.version ?? "", /^\d+\.\d+\.\d+$/);
  assert.equal(production?.environment, "production");
  assert.equal(production?.autoIncrement, true);
  assert.equal(production?.env?.EXPO_PUBLIC_API_URL, EXPECTED_API_URL);
  assert.equal(production?.android?.buildType, "app-bundle");
  assert.equal(submit?.android?.track, "internal");
  assert.equal(submit?.android?.releaseStatus, "draft");
  assert.deepEqual(submit?.ios, {});

  const apiUrl = new URL(production.env.EXPO_PUBLIC_API_URL);
  assert.equal(apiUrl.protocol, "https:");
  assert(!/(^|\.)invalid$|localhost|127\.0\.0\.1/.test(apiUrl.hostname));

  return {
    applicationId: EXPECTED_APPLICATION_ID,
    apiUrl: apiUrl.origin,
    easCliVersion: easConfig.cli.version,
    initialAndroidTrack: submit.android.track,
    initialAndroidReleaseStatus: submit.android.releaseStatus,
  };
}

export function validateGoogleServicesConfig(document, expectedApplicationId = EXPECTED_APPLICATION_ID) {
  const projectInfo = document.project_info;
  assert(nonEmptyString(projectInfo?.project_id), "Firebase project_id is required");
  assert.match(String(projectInfo?.project_number ?? ""), /^\d+$/, "Firebase project_number is required");

  const clients = (document.client ?? []).filter(
    (client) => client.client_info?.android_client_info?.package_name === expectedApplicationId,
  );
  assert.equal(clients.length, 1, `Firebase config must contain exactly one ${expectedApplicationId} client`);
  assert.match(
    clients[0].client_info?.mobilesdk_app_id ?? "",
    /^1:\d+:android:[0-9a-f]+$/i,
    "Firebase mobilesdk_app_id is invalid",
  );
  assert(
    (clients[0].api_key ?? []).some((entry) => nonEmptyString(entry.current_key)),
    "Firebase Android client requires an API key",
  );

  return {
    applicationId: expectedApplicationId,
    projectId: projectInfo.project_id,
    projectNumber: String(projectInfo.project_number),
    mobileSdkAppId: clients[0].client_info.mobilesdk_app_id,
  };
}

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

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  const appConfig = JSON.parse(await readFile(args.app ?? "apps/mobile/app.json", "utf8"));
  const easConfig = JSON.parse(await readFile(args.eas ?? "apps/mobile/eas.json", "utf8"));
  const evidence = { static: validateStaticEasConfig(appConfig, easConfig) };

  if (args.firebase) {
    evidence.firebase = validateGoogleServicesConfig(
      JSON.parse(await readFile(args.firebase, "utf8")),
    );
  }

  console.log(JSON.stringify(evidence, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
