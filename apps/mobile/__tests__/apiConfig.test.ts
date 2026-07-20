import { resolveApiBaseUrl } from "@/lib/apiConfig";

describe("resolveApiBaseUrl", () => {
  it("uses loopback by default only in development", () => {
    expect(resolveApiBaseUrl({ isDevelopment: true, isAndroidE2E: false })).toBe("http://127.0.0.1:8000");
    expect(() => resolveApiBaseUrl({ isDevelopment: false, isAndroidE2E: false })).toThrow(
      "EXPO_PUBLIC_API_URL is required outside development.",
    );
  });

  it("accepts HTTPS and normalizes one trailing slash", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: " https://api.hlasimse.test/ ",
      isDevelopment: false,
      isAndroidE2E: false,
    })).toBe("https://api.hlasimse.test");
  });

  it("allows only local HTTP hosts in development", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: "http://localhost:8000",
      isDevelopment: true,
      isAndroidE2E: false,
    })).toBe("http://localhost:8000");
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl: "http://api.example.test",
      isDevelopment: true,
      isAndroidE2E: false,
    })).toThrow("Insecure API URLs are allowed only for local development hosts.");
  });

  it("allows the exact Android emulator bridge only for the native E2E application ID", () => {
    expect(resolveApiBaseUrl({
      configuredBaseUrl: "http://10.0.2.2:8000",
      isDevelopment: false,
      isAndroidE2E: true,
    })).toBe("http://10.0.2.2:8000");
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl: "http://10.0.2.2:8000",
      isDevelopment: false,
      isAndroidE2E: false,
    })).toThrow("EXPO_PUBLIC_API_URL must use HTTPS in production.");
  });

  it.each([
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://10.0.2.2:9000",
    "http://api.example.test",
  ])("rejects non-exact production HTTP even for the E2E application: %s", (configuredBaseUrl) => {
    expect(() => resolveApiBaseUrl({
      configuredBaseUrl,
      isDevelopment: false,
      isAndroidE2E: true,
    })).toThrow("EXPO_PUBLIC_API_URL must use HTTPS in production.");
  });
});
