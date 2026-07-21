import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const DEFAULT_MANIFEST = "scripts/public-contract-manifest.json";

export const RULES = [
  {
    label: "retired backend or billing brand",
    pattern:
      /\bsupabase(?:\b|_)|EXPO_PUBLIC_SUPABASE|\brevenuecat(?:\b|_)|\bpremium(?:\b|_)|react-native-purchases|@revenuecat|Purchases\.|usePremiumStore|isPremium|PREMIUM_ENTITLEMENT|showPaywall|<Paywall/giu,
  },
  {
    label: "paid feature call to action or runtime",
    pattern:
      /\bpaywall\b|\b(?:subscribe now|subscribe to (?:a )?(?:plan|premium)|upgrade now|buy now|purchase now|start (?:a )?(?:free )?trial)\b|\b(?:koupit|zakoupit|předplatit|zaplatit|objednat)\b|\baktiv(?:ovat|ujte|uj) předplatné|\bobnovit nákup|\bodemkn(?:out|ěte) (?:placené funkce|všechny funkce|premium)/giu,
  },
  {
    label: "SMS feature claim or integration",
    pattern: /\bSMS(?:\b|_)|\btwilio(?:\b|_)/giu,
  },
  {
    label: "unverifiable instant alert claim",
    pattern:
      /(?:okamžitě|ihned)\s+(?:upozorníme|upozorní|odešleme|doručíme|se\s+(?:dozví|dozvědí))|(?:strážc(?:e|i)|blízcí)[^\n.]{0,60}(?:okamžitě|ihned)[^\n.]{0,40}(?:upozorn|dozv|doruč)|(?:strážc(?:e|i)|blízcí)[^\n.]{0,60}(?:upozorn|dozv|doruč)[^\n.]{0,20}(?:okamžitě|ihned)|\binstant\s+(?:push|alert|notification|delivery)\b/giu,
  },
  {
    label: "unverifiable guaranteed delivery claim",
    pattern:
      /(?:garantovan[éýá]|zaručen[éýá])\s+(?:doručení|push|upozornění|notifikace)|\bguaranteed\s+(?:push|alert|notification|delivery)\b/giu,
  },
  {
    label: "misleading confirmed offline check-in claim",
    pattern:
      /(?:offline\s+(?:check[- ]?in|ohlášení|hlášení)|(?:check[- ]?in|ohlášení|hlášení)\s+offline)[^\n.]{0,50}\b(?:hotov|potvrzen|úspěšn|funguje)\w*\b|(?:check[- ]?in|ohlášení|hlášení)[^\n.]{0,40}\bfunguje\s+(?:i\s+)?(?:zcela\s+)?(?:bez internetu|offline)|\boffline check[- ]?in\s+(?:is\s+)?(?:complete|confirmed|successful|works)\b/giu,
  },
  {
    label: "push receipt misrepresented as device delivery",
    pattern: /Doručeno alespoň na jedno zařízení|Poskytovatel potvrdil doručení|Receipt potvrdil/giu,
  },
];

function normalizedPath(path) {
  return path.split(sep).join("/").replace(/^\.\//u, "");
}

function validateRelativePath(path, label) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    isAbsolute(path) ||
    normalizedPath(path).split("/").includes("..")
  ) {
    throw new Error(`${label} must be a non-empty repository-relative path`);
  }
  return normalizedPath(path).replace(/\/$/u, "");
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function scanSource(path, source) {
  const failures = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      failures.push({
        path,
        line: lineNumber(source, match.index),
        label: rule.label,
        match: match[0],
      });
    }
  }
  return failures;
}

async function gitTrackedFiles(rootPath) {
  const { stdout } = await execFileAsync("git", ["-C", rootPath, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split("\0").filter(Boolean).map(normalizedPath);
}

function loadExtensions(manifest) {
  if (!Array.isArray(manifest.text_extensions) || manifest.text_extensions.length === 0) {
    throw new Error("Manifest text_extensions must be a non-empty array");
  }
  return new Set(
    manifest.text_extensions.map((extension) => {
      if (typeof extension !== "string" || !/^\.[a-z0-9]+$/iu.test(extension)) {
        throw new Error(`Invalid text extension: ${JSON.stringify(extension)}`);
      }
      return extension.toLowerCase();
    }),
  );
}

function expandManifest(manifest, trackedFiles) {
  if (manifest.schema_version !== 1) throw new Error("Unsupported manifest schema_version");
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    throw new Error("Manifest artifacts must be a non-empty array");
  }
  const extensions = loadExtensions(manifest);
  const excludedSegments = new Set(manifest.excluded_segments ?? []);
  const tracked = new Set(trackedFiles);
  const selected = new Map();
  const ids = new Set();

  for (const artifact of manifest.artifacts) {
    if (typeof artifact.id !== "string" || artifact.id.length === 0 || ids.has(artifact.id)) {
      throw new Error(`Manifest artifact id is missing or duplicated: ${artifact.id}`);
    }
    ids.add(artifact.id);
    const path = validateRelativePath(artifact.path, `Artifact ${artifact.id} path`);
    const matches = artifact.recursive
      ? trackedFiles.filter((candidate) => {
          if (!candidate.startsWith(`${path}/`)) return false;
          if (candidate.split("/").some((part) => excludedSegments.has(part))) return false;
          return extensions.has(extname(candidate).toLowerCase());
        })
      : tracked.has(path)
        ? [path]
        : [];
    if (matches.length === 0) {
      throw new Error(`Artifact ${artifact.id} did not resolve to any tracked file: ${path}`);
    }
    for (const match of matches) {
      const artifactIds = selected.get(match) ?? [];
      artifactIds.push(artifact.id);
      selected.set(match, artifactIds);
    }
  }
  for (const candidate of manifest.optional_tracked_artifacts ?? []) {
    const path = validateRelativePath(candidate, "Optional tracked artifact");
    if (!tracked.has(path)) continue;
    if (!extensions.has(extname(path).toLowerCase())) {
      throw new Error(`Optional tracked artifact has an unsupported extension: ${path}`);
    }
    const artifactIds = selected.get(path) ?? [];
    artifactIds.push("optional-tracked-public-artifact");
    selected.set(path, artifactIds);
  }
  return selected;
}

export async function checkPublicContract({
  rootPath = REPOSITORY_ROOT,
  manifestPath = DEFAULT_MANIFEST,
  trackedFiles,
} = {}) {
  const absoluteRoot = resolve(rootPath);
  const relativeManifest = validateRelativePath(manifestPath, "Manifest path");
  const manifest = JSON.parse(await readFile(resolve(absoluteRoot, relativeManifest), "utf8"));
  const tracked = trackedFiles ?? (await gitTrackedFiles(absoluteRoot));
  const files = expandManifest(manifest, tracked.map(normalizedPath));
  const failures = [];
  for (const path of [...files.keys()].sort()) {
    const source = await readFile(resolve(absoluteRoot, path), "utf8");
    failures.push(...scanSource(path, source));
  }
  return { files, failures, manifestPath: relativeManifest };
}

function formatFailure(failure) {
  return `${failure.path}:${failure.line}: ${failure.label}: ${JSON.stringify(failure.match)}`;
}

async function main() {
  const manifestFlag = process.argv.indexOf("--manifest");
  const manifestPath = manifestFlag === -1 ? DEFAULT_MANIFEST : process.argv[manifestFlag + 1];
  if (!manifestPath) throw new Error("--manifest requires a repository-relative path");
  const result = await checkPublicContract({ manifestPath });
  if (result.failures.length > 0) {
    console.error(
      `AT-24 public product contract violations (${result.manifestPath}):\n` +
        result.failures.map(formatFailure).join("\n"),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `AT-24 public product contract scan passed for ${result.files.size} tracked artifacts ` +
      `from ${result.manifestPath}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`AT-24 public product contract scan failed: ${error.message}`);
    process.exitCode = 1;
  });
}
