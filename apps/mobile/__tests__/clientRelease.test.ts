import { Platform } from "react-native";
import {
  clientHeaders,
  compareSemVer,
  gateFromConfig,
  gateFromError,
  InvalidClientReleaseError,
  parseSemVer,
} from "@/lib/clientRelease";
import { checkClientRelease, supportsMobileReleaseGate } from "@/lib/clientGate";

const iosStore = "https://apps.apple.com/app/hlasim-se/id123456789";

beforeEach(() => {
  (Platform as { OS: string }).OS = "ios";
  jest.restoreAllMocks();
});

it("adds explicit native client, platform, version and build headers", () => {
  expect(clientHeaders()).toEqual({
    "X-Hlasimse-Client": "hlasimse-mobile",
    "X-Hlasimse-Platform": "ios",
    "X-Hlasimse-Version": "1.0.0",
    "X-Hlasimse-Build": "1",
  });
});

it("parses strict semver and compares numeric identifiers without precision loss", () => {
  expect(() => parseSemVer("01.0.0")).toThrow(InvalidClientReleaseError);
  expect(() => parseSemVer("1.0")).toThrow(InvalidClientReleaseError);
  expect(compareSemVer("999999999999999999999999.0.0", "1000000000000000000000000.0.0")).toBeLessThan(0);
  expect(compareSemVer(
    "1.0.0-999999999999999999999999",
    "1.0.0-1000000000000000000000000",
  )).toBeLessThan(0);
  expect(compareSemVer("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
});

it("requires an update when either the version or native build is below minimum", () => {
  const gate = gateFromConfig({
    client: "hlasimse-mobile",
    maintenance: false,
    platforms: {
      ios: { min_version: "1.0.0", min_build: 2, store_url: iosStore },
      android: {
        min_version: "1.0.0",
        min_build: 2,
        store_url: "https://play.google.com/store/apps/details?id=cz.hlasimse",
      },
    },
  });

  expect(gate).toEqual({
    kind: "update",
    detail: expect.any(String),
    minVersion: "1.0.0",
    minBuild: 2,
    storeUrl: iosStore,
  });
});

it("rejects untrusted store URLs from config and strips them from an error gate", () => {
  const config = {
    client: "hlasimse-mobile" as const,
    maintenance: false,
    platforms: {
      ios: { min_version: "2.0.0", min_build: 2, store_url: "https://attacker.test/app/id123" },
      android: {
        min_version: "2.0.0",
        min_build: 2,
        store_url: "https://play.google.com/store/apps/details?id=cz.hlasimse",
      },
    },
  };
  expect(() => gateFromConfig(config)).toThrow(InvalidClientReleaseError);
  expect(gateFromError(426, {
    code: "update_required",
    min_version: "2.0.0",
    min_build: 2,
    store_url: "https://user:secret@apps.apple.com/app/id123",
  })).toMatchObject({ kind: "update", storeUrl: null });
});

it("does not bootstrap the mobile release request during Expo web export", async () => {
  (Platform as { OS: string }).OS = "web";
  const fetchMock = jest.spyOn(globalThis, "fetch");

  expect(supportsMobileReleaseGate()).toBe(false);
  await expect(checkClientRelease()).resolves.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
