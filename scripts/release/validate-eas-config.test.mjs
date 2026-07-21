import assert from "node:assert/strict";
import test from "node:test";

import {
  validateGoogleServicesConfig,
  validateStaticEasConfig,
} from "./validate-eas-config.mjs";

const app = {
  expo: {
    ios: { bundleIdentifier: "cz.tomasmach.hlasimse" },
    android: { package: "cz.tomasmach.hlasimse" },
    extra: { eas: { projectId: "3027c5db-2ddd-4a0a-a2e4-2c5470410438" } },
  },
};
const eas = {
  cli: { version: "21.0.2", requireCommit: true, appVersionSource: "remote" },
  build: {
    production: {
      environment: "production",
      autoIncrement: true,
      env: { EXPO_PUBLIC_API_URL: "https://www.hlasimse.cz" },
      android: { buildType: "app-bundle" },
    },
  },
  submit: {
    production: {
      android: { track: "internal", releaseStatus: "draft" },
      ios: {},
    },
  },
};

test("accepts the reviewed production EAS profile", () => {
  assert.deepEqual(validateStaticEasConfig(app, eas), {
    applicationId: "cz.tomasmach.hlasimse",
    apiUrl: "https://www.hlasimse.cz",
    easCliVersion: "21.0.2",
    initialAndroidTrack: "internal",
    initialAndroidReleaseStatus: "draft",
  });
});

test("rejects an unsafe production API endpoint", () => {
  const changed = structuredClone(eas);
  changed.build.production.env.EXPO_PUBLIC_API_URL = "https://release-audit.invalid";
  assert.throws(() => validateStaticEasConfig(app, changed));
});

test("accepts one matching Firebase Android application", () => {
  const facts = validateGoogleServicesConfig({
    project_info: { project_id: "hlasimse-production", project_number: "123456789" },
    client: [
      {
        client_info: {
          mobilesdk_app_id: "1:123456789:android:abcdef0123456789",
          android_client_info: { package_name: "cz.tomasmach.hlasimse" },
        },
        api_key: [{ current_key: "synthetic-test-key" }],
      },
    ],
  });
  assert.equal(facts.applicationId, "cz.tomasmach.hlasimse");
  assert.equal(facts.projectId, "hlasimse-production");
});

test("rejects Firebase config for another application", () => {
  assert.throws(() =>
    validateGoogleServicesConfig({
      project_info: { project_id: "wrong", project_number: "123" },
      client: [
        {
          client_info: {
            mobilesdk_app_id: "1:123:android:abcdef",
            android_client_info: { package_name: "cz.example.other" },
          },
          api_key: [{ current_key: "synthetic-test-key" }],
        },
      ],
    }),
  );
});
