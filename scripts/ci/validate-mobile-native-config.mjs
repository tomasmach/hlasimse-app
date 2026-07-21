import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appConfigUrl = new URL("../../apps/mobile/app.json", import.meta.url);
const appConfig = JSON.parse(await readFile(appConfigUrl, "utf8"));
const expo = appConfig.expo;

assert(expo?.ios, "app.json must define expo.ios");
assert(expo?.android, "app.json must define expo.android");

const expectedPrivacyTypes = [
  "NSPrivacyCollectedDataTypeName",
  "NSPrivacyCollectedDataTypeEmailAddress",
  "NSPrivacyCollectedDataTypePreciseLocation",
  "NSPrivacyCollectedDataTypeUserID",
  "NSPrivacyCollectedDataTypeDeviceID",
  "NSPrivacyCollectedDataTypeOtherUserContent",
  "NSPrivacyCollectedDataTypeProductInteraction",
];
const privacyManifests = expo.ios.privacyManifests;

assert.equal(
  privacyManifests?.NSPrivacyTracking,
  false,
  "iOS privacy manifest must explicitly disable tracking",
);
assert.deepEqual(
  privacyManifests.NSPrivacyCollectedDataTypes.map(
    (entry) => entry.NSPrivacyCollectedDataType,
  ),
  expectedPrivacyTypes,
  "iOS collected-data declarations must match the reviewed product data map",
);
for (const entry of privacyManifests.NSPrivacyCollectedDataTypes) {
  assert.equal(entry.NSPrivacyCollectedDataTypeLinked, true);
  assert.equal(entry.NSPrivacyCollectedDataTypeTracking, false);
  assert.deepEqual(entry.NSPrivacyCollectedDataTypePurposes, [
    "NSPrivacyCollectedDataTypePurposeAppFunctionality",
  ]);
}

const expectedBlockedPermissions = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];
assert.deepEqual(
  expo.android.blockedPermissions,
  expectedBlockedPermissions,
  "Android must keep unused overlay and legacy storage permissions blocked",
);

console.log(
  `Validated ${expectedPrivacyTypes.length} iOS privacy declarations and ${expectedBlockedPermissions.length} Android blocked permissions.`,
);
