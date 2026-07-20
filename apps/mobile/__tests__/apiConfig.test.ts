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

  it("allows the exact Android emulator bridge only for the native E2E application ID", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: "http://10.0.2.2:8000",
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

  it("allows the exact iOS simulator loopback only for the native E2E application ID", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: "http://127.0.0.1:8000",
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
    ["http://localhost:8000", false, true],
    ["http://127.0.0.1:9000", false, true],
    ["http://10.0.2.2:8000", false, true],
    ["http://api.example.test", false, true],
    ["http://localhost:8000", true, false],
    ["http://127.0.0.1:8000", true, false],
    ["http://10.0.2.2:9000", true, false],
    ["http://api.example.test", true, false],
  ])("rejects non-exact production HTTP for native E2E targets: %s", (configuredBaseUrl, isAndroidE2E, isIosE2E) => {
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl,
      isDevelopment: false,
      isAndroidE2E,
      isIosE2E,
    })).toThrow("EXPO_PUBLIC_API_URL must use HTTPS in production.");
  });
});
