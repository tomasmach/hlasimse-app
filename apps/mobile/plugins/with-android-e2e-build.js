const fs = require("node:fs/promises");
const path = require("node:path");

const {
  withAppBuildGradle,
  withDangerousMod,
} = require("expo/config-plugins");

const BUILD_TYPE_MARKER = "HLASIMSE_E2E_BUILD_TYPE";
const BUILD_TYPES_END = "    }\n    packagingOptions {";
const E2E_BUILD_TYPE = `        // ${BUILD_TYPE_MARKER}: release-derived local simulator evidence only.
        e2e {
            initWith release
            applicationIdSuffix ".e2e"
            matchingFallbacks = ['release']
            signingConfig signingConfigs.debug
            debuggable false
        }
`;

const E2E_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- Local Django is HTTP-only; this override is confined to the e2e build type. -->
    <application android:usesCleartextTraffic="true" />
</manifest>
`;

function withE2EBuildType(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    if (gradleConfig.modResults.language !== "groovy") {
      throw new Error("Hlásím se Android E2E build requires a Groovy app build.gradle.");
    }

    const source = gradleConfig.modResults.contents;
    const markerCount = source.split(BUILD_TYPE_MARKER).length - 1;
    if (markerCount > 1) {
      throw new Error("Android app build.gradle contains duplicate Hlásím se E2E build types.");
    }
    if (markerCount === 1) {
      return gradleConfig;
    }
    const anchorIndex = source.indexOf(BUILD_TYPES_END);
    if (anchorIndex === -1) {
      throw new Error("Could not locate the Android buildTypes block for the E2E build type.");
    }

    gradleConfig.modResults.contents =
      source.slice(0, anchorIndex) + E2E_BUILD_TYPE + source.slice(anchorIndex);
    return gradleConfig;
  });
}

function withE2EManifest(config) {
  return withDangerousMod(config, [
    "android",
    async (dangerousConfig) => {
      const manifestPath = path.join(
        dangerousConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "e2e",
        "AndroidManifest.xml",
      );
      await fs.mkdir(path.dirname(manifestPath), { recursive: true });
      await fs.writeFile(manifestPath, E2E_MANIFEST, "utf8");
      return dangerousConfig;
    },
  ]);
}

module.exports = function withAndroidE2EBuild(config) {
  return withE2EManifest(withE2EBuildType(config));
};
