import assert from "node:assert/strict";
import test from "node:test";

import { androidManifestFacts } from "./audit-native-candidate.mjs";

test("extracts Android identity and ignores permissions inside comments", () => {
  const facts = androidManifestFacts(`
    <manifest xmlns:android="http://schemas.android.com/apk/res/android"
      package="cz.hlasimse.app" android:versionCode="42" android:versionName="2.3.0">
      <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="36" />
      <!-- <uses-permission android:name="android.permission.CAMERA" /> -->
      <uses-permission android:name="android.permission.INTERNET" />
    </manifest>
  `);
  assert.deepEqual(facts, {
    applicationId: "cz.hlasimse.app",
    versionCode: "42",
    versionName: "2.3.0",
    minSdk: "24",
    targetSdk: "36",
    permissions: ["android.permission.INTERNET"],
  });
});
