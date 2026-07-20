import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const ROOT = new URL("../", import.meta.url);
const SCAN_ROOTS = [
  "apps/mobile/app",
  "apps/mobile/components",
  "apps/mobile/constants",
  "apps/mobile/hooks",
  "apps/mobile/lib",
  "apps/mobile/stores",
  "apps/mobile/utils",
  "apps/mobile/app.json",
  "apps/mobile/package.json",
  "apps/server/config",
  "apps/server/core",
  "apps/server/static",
  "apps/server/templates",
  "apps/server/pyproject.toml",
];
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".py",
  ".toml",
  ".ts",
  ".tsx",
]);
const SKIP_PARTS = new Set(["__pycache__", "migrations", "tests", "__tests__"]);
const RULES = [
  {
    label: "Supabase runtime client or configuration",
    pattern: /@supabase\/supabase-js|EXPO_PUBLIC_SUPABASE|createClient\([^)]*supabase/giu,
  },
  {
    label: "billing, paywall, or paid-tier runtime",
    pattern:
      /revenuecat|react-native-purchases|@revenuecat|Purchases\.|usePremiumStore|<Paywall|showPaywall|isPremium|PREMIUM_ENTITLEMENT|Hlásím se Premium|aktivní předplatné|upgradovat|obnovit nákup/giu,
  },
  {
    label: "SMS feature claim or integration",
    pattern: /\bSMS\b|twilio/giu,
  },
  {
    label: "unverifiable instant-alert claim",
    pattern: /okamžitě\s+(?:se\s+)?(?:dozv|upozorn)|(?:garantovan|zaručen)[^\n.]{0,50}(?:doruč|upozorn)/giu,
  },
  {
    label: "misleading offline-success claim",
    pattern: /(?:check[- ]?in|hlášení)[^\n.]{0,40}funguje\s+offline|offline\s+(?:check[- ]?in|hlášení)[^\n.]{0,40}(?:hotov|potvrzen)/giu,
  },
  {
    label: "push receipt misrepresented as device delivery",
    pattern: /Doručeno alespoň na jedno zařízení|Poskytovatel potvrdil doručení|Receipt potvrdil/giu,
  },
];

async function collect(path) {
  const url = new URL(path, ROOT);
  const entries = await readdir(url, { withFileTypes: true }).catch(() => null);
  if (entries === null) return [url];

  const files = [];
  for (const entry of entries) {
    if (SKIP_PARTS.has(entry.name)) continue;
    const child = join(url.pathname, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(child)));
    else if (TEXT_EXTENSIONS.has(extname(entry.name))) files.push(new URL(`file://${child}`));
  }
  return files;
}

const failures = [];
for (const root of SCAN_ROOTS) {
  for (const file of await collect(root)) {
    const source = await readFile(file, "utf8");
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of source.matchAll(rule.pattern)) {
        const line = source.slice(0, match.index).split("\n").length;
        failures.push(
          `${relative(new URL(".", ROOT).pathname, file.pathname)}:${line}: ${rule.label}: ${JSON.stringify(match[0])}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error("Public product contract violations:\n" + failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Public product contract scan passed.");
}
