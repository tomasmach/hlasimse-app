import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const REQUIRED_SCREENSHOTS = [
  "check-in",
  "profiles",
  "offline-pending",
  "guardians",
  "missed-deadline-incident",
  "history-statistics",
  "settings-data-controls",
];

const PLACEHOLDER = /\bDRAFT\b|\bTODO\b|\bTBD\b|placeholder|<[^>]+>|\.invalid\b|com\.anonymous\b|localhost/i;
const PUBLIC_CONTENT_PLACEHOLDER = /\bDRAFT\b|\bTODO\b|\bTBD\b|placeholder|\.invalid\b|com\.anonymous\b|localhost/i;
const RELEASE_BLOCKER = /blokuje veřejné vydání|legal-release-blocker/i;
const PUBLIC_URL_FIELDS = [
  "marketingUrl",
  "supportUrl",
  "privacyUrl",
  "termsUrl",
  "accountDeletionUrl",
];

function pngDimensions(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function validHttpsUrl(value) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      !PLACEHOLDER.test(value)
    );
  } catch {
    return false;
  }
}

export async function validateStoreReleasePack({
  pack,
  appConfig,
  storeDir,
  markdownFiles = [],
  verifyLive = false,
  fetchImpl = globalThis.fetch,
}) {
  const errors = [];
  const add = (condition, message) => {
    if (!condition) errors.push(message);
  };
  const expo = appConfig.expo;

  add(pack.status === "READY", "release-pack status must be READY");
  add(pack.application?.version === expo.version, "release-pack version must match app.json");
  add(pack.application?.iosBundleIdentifier === expo.ios.bundleIdentifier, "iOS bundle identifier must match app.json");
  add(pack.application?.iosBuildNumber === expo.ios.buildNumber, "iOS build number must match app.json");
  add(pack.application?.androidApplicationId === expo.android.package, "Android applicationId must match app.json");
  add(pack.application?.androidVersionCode === expo.android.versionCode, "Android versionCode must match app.json");
  add(!PLACEHOLDER.test(JSON.stringify(pack.application ?? {})), "application identity/version contains a placeholder");

  for (const field of PUBLIC_URL_FIELDS) {
    add(validHttpsUrl(pack.legal?.[field]), `${field} must be a finalized HTTPS URL`);
  }
  const legalOrigins = new Set();
  for (const field of PUBLIC_URL_FIELDS) {
    try {
      legalOrigins.add(new URL(pack.legal?.[field]).origin);
    } catch {
      // The absolute-HTTPS validation above already reports the malformed URL.
    }
  }
  add(legalOrigins.size === 1, "all public and legal URLs must use one production origin");
  for (const [field, expectedPath] of Object.entries({
    supportUrl: "/podpora/",
    privacyUrl: "/ochrana-soukromi/",
    termsUrl: "/obchodni-podminky/",
    accountDeletionUrl: "/ucet/smazat/",
  })) {
    try {
      add(new URL(pack.legal?.[field]).pathname === expectedPath, `${field} must use ${expectedPath}`);
    } catch {
      // The absolute-HTTPS validation above already reports the malformed URL.
    }
  }
  add(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pack.legal?.supportEmail ?? "") && !PLACEHOLDER.test(pack.legal?.supportEmail ?? ""),
    "supportEmail must be a finalized email address",
  );

  if (pack.status === "READY") {
    add(verifyLive, "READY release pack requires live public URL verification");
    add(typeof fetchImpl === "function", "live public URL verification requires fetch support");
    if (verifyLive && typeof fetchImpl === "function") {
      for (const field of PUBLIC_URL_FIELDS) {
        const url = pack.legal?.[field];
        if (!validHttpsUrl(url)) continue;
        try {
          const response = await fetchImpl(url, {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
            headers: { Accept: "text/html" },
          });
          add(response.ok, `${field} must return HTTP 2xx without redirects`);
          if (!response.ok) continue;
          const contentType = response.headers?.get?.("content-type") ?? "";
          const body = await response.text();
          add(contentType.toLowerCase().includes("text/html"), `${field} must serve HTML`);
          add(body.trim().length >= 200, `${field} must serve substantive public content`);
          add(
            !PUBLIC_CONTENT_PLACEHOLDER.test(body) && !RELEASE_BLOCKER.test(body),
            `${field} must not expose draft or release-blocker content`,
          );
        } catch {
          errors.push(`${field} live verification failed or redirected`);
        }
      }
    }
  }

  for (const [approval, status] of Object.entries(pack.approvals ?? {})) {
    add(status === "READY", `${approval} approval must be READY`);
  }
  for (const required of ["metadata", "privacyAndDataSafety", "contentRating", "reviewNotes"]) {
    add(Object.hasOwn(pack.approvals ?? {}, required), `${required} approval is missing`);
  }

  for (const platform of ["ios", "android"]) {
    const entries = pack.screenshots?.[platform] ?? [];
    add(
      JSON.stringify(entries.map((entry) => entry.key).sort()) === JSON.stringify([...REQUIRED_SCREENSHOTS].sort()),
      `${platform} screenshots must contain exactly the seven required scenes`,
    );
    for (const entry of entries) {
      const relative = entry.path ?? "";
      const absolute = path.resolve(storeDir, relative);
      add(absolute.startsWith(`${path.resolve(storeDir)}${path.sep}`), `${platform} screenshot path escapes docs/store`);
      try {
        const dimensions = pngDimensions(await readFile(absolute));
        add(Boolean(dimensions), `${platform} screenshot ${relative} must be a valid PNG`);
        if (dimensions) {
          add(dimensions.height > dimensions.width, `${platform} screenshot ${relative} must be portrait`);
          add(dimensions.width >= 1000 && dimensions.height >= 1800, `${platform} screenshot ${relative} is below the minimum review resolution`);
        }
      } catch {
        errors.push(`${platform} screenshot is missing: ${relative}`);
      }
    }
  }

  const featureRelative = pack.screenshots?.androidFeatureGraphic ?? "";
  try {
    const dimensions = pngDimensions(await readFile(path.resolve(storeDir, featureRelative)));
    add(dimensions?.width === 1024 && dimensions?.height === 500, "Android feature graphic must be a 1024x500 PNG");
  } catch {
    errors.push(`Android feature graphic is missing: ${featureRelative}`);
  }

  for (const markdownFile of markdownFiles) {
    const contents = await readFile(markdownFile, "utf8");
    add(!PLACEHOLDER.test(contents), `${path.basename(markdownFile)} still contains DRAFT or placeholder content`);
  }
  return { ok: errors.length === 0, errors };
}

async function cli() {
  const args = Object.fromEntries(
    process.argv.slice(2).reduce((pairs, value, index, values) => {
      if (index % 2 === 0) pairs.push([value.replace(/^--/, ""), values[index + 1]]);
      return pairs;
    }, []),
  );
  const packPath = path.resolve(args.pack ?? "docs/store/release-pack.json");
  const storeDir = path.dirname(packPath);
  const pack = JSON.parse(await readFile(packPath, "utf8"));
  const appConfig = JSON.parse(await readFile(args.config ?? "apps/mobile/app.json", "utf8"));
  const markdownFiles = (await readdir(storeDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(storeDir, entry.name));
  const result = await validateStoreReleasePack({
    pack,
    appConfig,
    storeDir,
    markdownFiles,
    verifyLive: true,
  });
  if (args.evidence) {
    await writeFile(args.evidence, `${JSON.stringify(result, null, 2)}\n`);
  }
  if (!result.ok) {
    console.error("Store release pack is not publishable:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Store release pack is READY and complete.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await cli();
