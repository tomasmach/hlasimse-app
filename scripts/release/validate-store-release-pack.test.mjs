import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { validateStoreReleasePack } from "./validate-store-release-pack.mjs";

const scenes = [
  "check-in",
  "profiles",
  "offline-pending",
  "guardians",
  "missed-deadline-incident",
  "history-statistics",
  "settings-data-controls",
];

function png(width, height) {
  const value = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(value);
  value.write("IHDR", 12, "ascii");
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

async function fixture() {
  const storeDir = await mkdtemp(path.join(tmpdir(), "hlasimse-store-pack-"));
  const screenshots = {};
  for (const platform of ["ios", "android"]) {
    screenshots[platform] = [];
    for (const key of scenes) {
      const filename = `${platform}-${key}.png`;
      await writeFile(path.join(storeDir, filename), png(1200, 2400));
      screenshots[platform].push({ key, path: filename });
    }
  }
  await writeFile(path.join(storeDir, "feature.png"), png(1024, 500));
  const appConfig = {
    expo: {
      version: "1.2.3",
      ios: { bundleIdentifier: "cz.hlasimse.app", buildNumber: "17" },
      android: { package: "cz.hlasimse.app", versionCode: 17 },
    },
  };
  const pack = {
    status: "READY",
    application: {
      version: "1.2.3",
      iosBundleIdentifier: "cz.hlasimse.app",
      iosBuildNumber: "17",
      androidApplicationId: "cz.hlasimse.app",
      androidVersionCode: 17,
    },
    legal: {
      marketingUrl: "https://hlasim.se/",
      supportUrl: "https://hlasim.se/podpora/",
      privacyUrl: "https://hlasim.se/ochrana-soukromi/",
      termsUrl: "https://hlasim.se/obchodni-podminky/",
      accountDeletionUrl: "https://hlasim.se/ucet/smazat/",
      supportEmail: "podpora@hlasim.se",
    },
    approvals: {
      metadata: "READY",
      privacyAndDataSafety: "READY",
      contentRating: "READY",
      reviewNotes: "READY",
    },
    screenshots: { ...screenshots, androidFeatureGraphic: "feature.png" },
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html; charset=utf-8" },
    text: async () => `<!doctype html><html><body>${"Published content. ".repeat(30)}</body></html>`,
  });
  return { appConfig, pack, storeDir, verifyLive: true, fetchImpl };
}

test("accepts a complete finalized release pack", async () => {
  const data = await fixture();
  assert.deepEqual(await validateStoreReleasePack({ ...data }), { ok: true, errors: [] });
});

test("requires one clean production origin for public URLs", async () => {
  const data = await fixture();
  data.pack.legal.supportUrl = "https://support.hlasim.se/podpora/";
  data.pack.legal.privacyUrl = "https://user:secret@hlasim.se/ochrana-soukromi/";

  const result = await validateStoreReleasePack({ ...data });

  assert.equal(result.ok, false);
  assert(result.errors.includes("all public and legal URLs must use one production origin"));
  assert(result.errors.includes("privacyUrl must be a finalized HTTPS URL"));
});

test("READY pack rejects unavailable or draft legal pages", async () => {
  const data = await fixture();
  data.fetchImpl = async (url) => {
    if (url.endsWith("/ochrana-soukromi/")) {
      return {
        ok: false,
        status: 503,
        headers: { get: () => "text/html" },
        text: async () => "Blokuje veřejné vydání",
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => `<!doctype html><html><body>${"Published content. ".repeat(30)}</body></html>`,
    };
  };

  const result = await validateStoreReleasePack({ ...data });

  assert.equal(result.ok, false);
  assert(result.errors.includes("privacyUrl must return HTTP 2xx without redirects"));
});

test("rejects draft placeholders, identity drift and missing required assets", async () => {
  const data = await fixture();
  data.pack.status = "DRAFT";
  data.pack.application.androidApplicationId = "com.anonymous.hlasimse";
  data.pack.legal.privacyUrl = "https://<production-domain>/ochrana-soukromi/";
  data.pack.screenshots.ios.pop();
  data.pack.screenshots.androidFeatureGraphic = "missing.png";
  const result = await validateStoreReleasePack({ ...data });
  assert.equal(result.ok, false);
  assert(result.errors.some((error) => error.includes("status")));
  assert(result.errors.some((error) => error.includes("applicationId")));
  assert(result.errors.some((error) => error.includes("privacyUrl")));
  assert(result.errors.some((error) => error.includes("seven required")));
  assert(result.errors.some((error) => error.includes("feature graphic is missing")));
});
