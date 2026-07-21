import Constants from "expo-constants";
import * as Application from "expo-application";
import { Platform } from "react-native";

export const MOBILE_CLIENT_ID = "hlasimse-mobile";

export type MobilePlatform = "ios" | "android";

export interface ClientMetadata {
  client: typeof MOBILE_CLIENT_ID;
  platform: MobilePlatform;
  version: string;
  build: string;
}

export interface ClientReleaseConfig {
  client: typeof MOBILE_CLIENT_ID;
  maintenance: boolean;
  platforms: Record<MobilePlatform, { min_version: string; min_build: number; store_url: string }>;
}

export type ClientGate =
  | { kind: "update"; detail: string; minVersion: string | null; minBuild: number | null; storeUrl: string | null }
  | { kind: "maintenance"; detail: string };

interface ParsedSemVer {
  core: [string, string, string];
  prerelease: string[];
}

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const BUILD_PATTERN = /^[1-9]\d*$/;

export class InvalidClientReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidClientReleaseError";
  }
}

export function parseSemVer(value: string): ParsedSemVer {
  const match = SEMVER_PATTERN.exec(value);
  if (!match) throw new InvalidClientReleaseError("Neplatná sémantická verze aplikace.");
  return {
    core: [match[1], match[2], match[3]],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareNumericStrings(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIdentifiers(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    return compareNumericStrings(left, right);
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left.localeCompare(right);
}

export function compareSemVer(left: string, right: string): number {
  const parsedLeft = parseSemVer(left);
  const parsedRight = parseSemVer(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = compareNumericStrings(parsedLeft.core[index], parsedRight.core[index]);
    if (difference) return difference;
  }
  if (!parsedLeft.prerelease.length && !parsedRight.prerelease.length) return 0;
  if (!parsedLeft.prerelease.length) return 1;
  if (!parsedRight.prerelease.length) return -1;
  const count = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftIdentifier = parsedLeft.prerelease[index];
    const rightIdentifier = parsedRight.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    const difference = compareIdentifiers(leftIdentifier, rightIdentifier);
    if (difference) return difference;
  }
  return 0;
}

export function getClientMetadata(): ClientMetadata {
  if (Platform.OS !== "ios" && Platform.OS !== "android") {
    throw new InvalidClientReleaseError("Nepodporovaná mobilní platforma.");
  }
  const platform: MobilePlatform = Platform.OS;
  const development = typeof __DEV__ !== "undefined" && __DEV__;
  const configuredBuild = platform === "ios"
    ? Constants.expoConfig?.ios?.buildNumber
    : Constants.expoConfig?.android?.versionCode;
  const version = Application.nativeApplicationVersion
    || (development ? Constants.expoConfig?.version : null);
  const build = Application.nativeBuildVersion
    || (development && configuredBuild != null ? String(configuredBuild) : null);
  if (!version || !build || !BUILD_PATTERN.test(build)) {
    throw new InvalidClientReleaseError("Nativní verzi nebo build aplikace nelze bezpečně ověřit.");
  }
  parseSemVer(version);
  return { client: MOBILE_CLIENT_ID, platform, version, build };
}

export function clientHeaders(): Record<string, string> {
  const metadata = getClientMetadata();
  return {
    "X-Hlasimse-Client": metadata.client,
    "X-Hlasimse-Platform": metadata.platform,
    "X-Hlasimse-Version": metadata.version,
    "X-Hlasimse-Build": metadata.build,
  };
}

function currentMobilePlatform(): MobilePlatform | null {
  return Platform.OS === "ios" || Platform.OS === "android" ? Platform.OS : null;
}

function safeStoreUrl(value: unknown, platform: MobilePlatform | null): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.port
      || !platform
    ) return null;
    if (platform === "ios") {
      const finalSegment = parsed.pathname.replace(/\/$/, "").split("/").pop() || "";
      if (
        parsed.hostname !== "apps.apple.com"
        || !parsed.pathname.includes("/app/")
        || !/^id\d+$/.test(finalSegment)
      ) return null;
    } else if (
      parsed.hostname !== "play.google.com"
      || parsed.pathname.replace(/\/$/, "") !== "/store/apps/details"
      || !parsed.searchParams.get("id")
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function gateFromError(status: number, body: unknown): ClientGate | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as Record<string, unknown>;
  if (status === 426 && payload.code === "update_required") {
    return {
      kind: "update",
      detail: typeof payload.detail === "string"
        ? payload.detail
        : "Tato verze aplikace už není bezpečně podporovaná.",
      minVersion: typeof payload.min_version === "string" ? payload.min_version : null,
      minBuild: typeof payload.min_build === "number" && Number.isSafeInteger(payload.min_build)
        ? payload.min_build
        : null,
      storeUrl: safeStoreUrl(payload.store_url, currentMobilePlatform()),
    };
  }
  if (status === 503 && payload.code === "maintenance") {
    return {
      kind: "maintenance",
      detail: typeof payload.detail === "string"
        ? payload.detail
        : "Služba je dočasně v údržbě. Zkuste to znovu později.",
    };
  }
  return null;
}

export function gateFromConfig(config: ClientReleaseConfig): ClientGate | null {
  const metadata = getClientMetadata();
  if (config.client !== MOBILE_CLIENT_ID || typeof config.maintenance !== "boolean") {
    throw new InvalidClientReleaseError("Server vrátil neplatnou konfiguraci mobilní aplikace.");
  }
  const release = config.platforms?.[metadata.platform];
  if (
    !release
    || !Number.isSafeInteger(release.min_build)
    || release.min_build <= 0
  ) {
    throw new InvalidClientReleaseError("Server neposkytl platnou konfiguraci vydání.");
  }
  parseSemVer(release.min_version);
  if (config.maintenance) {
    return {
      kind: "maintenance",
      detail: "Služba je dočasně v údržbě. Ohlášení nyní server nepotvrdí.",
    };
  }
  if (
    compareSemVer(metadata.version, release.min_version) < 0
    || Number(metadata.build) < release.min_build
  ) {
    const storeUrl = safeStoreUrl(release.store_url, metadata.platform);
    if (!storeUrl) {
      throw new InvalidClientReleaseError("Server neposkytl bezpečnou konfiguraci obchodu.");
    }
    return {
      kind: "update",
      detail: "Tato verze aplikace už není bezpečně podporovaná. Před dalším použitím ji aktualizujte.",
      minVersion: release.min_version,
      minBuild: release.min_build,
      storeUrl,
    };
  }
  return null;
}
