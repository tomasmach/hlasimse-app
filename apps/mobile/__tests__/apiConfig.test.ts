import { resolveApiBaseUrl } from "@/lib/apiConfig";

describe("resolveApiBaseUrl", () => {
  it("uses loopback by default only in development", () => {
    expect(resolveApiBaseUrl({ isDevelopment: true, isAndroidE2E: false, isIosE2E: false })).toBe("http://127.0.0.1:8000");
    expect(() => resolveApiBaseUrl({ isDevelopment: false, isAndroidE2E: false, isIosE2E: false })).toThrow(
      "EXPO_PUBLIC_API_URL is required outside development.",
    );
  });

  it("accepts HTTPS and normalizes one trailing slash", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: " https://api.hlasimse.test/ ",
      isDevelopment: false,
      isAndroidE2E: false,
      isIosE2E: false,
    })).toBe("https://api.hlasimse.test");
  });

  it("allows only local HTTP hosts in development", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: "http://localhost:8000",
      isDevelopment: true,
      isAndroidE2E: false,
      isIosE2E: false,
    })).toBe("http://localhost:8000");
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl: "http://api.example.test",
      isDevelopment: true,
      isAndroidE2E: false,
      isIosE2E: false,
    })).toThrow("Insecure API URLs are allowed only for local development hosts.");
  });

  it("selects the exact Android emulator bridge from native E2E identity", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: "https://release-manifest.invalid",
      isDevelopment: false,
      isAndroidE2E: true,
      isIosE2E: false,
    })).toBe("http://10.0.2.2:8000");
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl: "http://10.0.2.2:8000",
      isDevelopment: false,
      isAndroidE2E: false,
      isIosE2E: false,
    })).toThrow("EXPO_PUBLIC_API_URL must use HTTPS in production.");
  });

  it("selects the exact iOS loopback from native E2E identity with the production JS config", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: "https://release-manifest.invalid",
      isDevelopment: false,
      isAndroidE2E: false,
      isIosE2E: true,
    })).toBe("http://127.0.0.1:8000");
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl: "http://127.0.0.1:8000",
      isDevelopment: false,
      isAndroidE2E: false,
      isIosE2E: false,
    })).toThrow("EXPO_PUBLIC_API_URL must use HTTPS in production.");
  });

  it.each([
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://10.0.2.2:9000",
    "http://api.example.test",
  ])("rejects production HTTP without native E2E identity: %s", (configuredBaseUrl) => {
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl,
      isDevelopment: false,
      isAndroidE2E: false,
      isIosE2E: false,
    })).toThrow("EXPO_PUBLIC_API_URL must use HTTPS in production.");
  });

  it("rejects conflicting native E2E identities", () => {
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl: "https://release-manifest.invalid",
      isDevelopment: false,
      isAndroidE2E: true,
      isIosE2E: true,
    })).toThrow("Conflicting native E2E application identity.");
  });
});
