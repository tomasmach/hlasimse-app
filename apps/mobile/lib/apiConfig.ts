const DEVELOPMENT_DEFAULT = "http://127.0.0.1:8000";
const ANDROID_EMULATOR_E2E_URL = "http://10.0.2.2:8000";
const LOCAL_DEVELOPMENT_URL = /^http:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2)(:\d+)?$/;

type ApiConfigInput = {
  configuredBaseUrl?: string;
  isDevelopment: boolean;
  isAndroidE2E: boolean;
};

export function resolveApiBaseUrl({
  configuredBaseUrl,
  isDevelopment,
  isAndroidE2E,
}: ApiConfigInput): string {
  const baseUrl = configuredBaseUrl?.trim().replace(/\/$/, "")
    || (isDevelopment ? DEVELOPMENT_DEFAULT : "");

  if (!baseUrl) {
    throw new Error("EXPO_PUBLIC_API_URL is required outside development.");
  }
  if (baseUrl.startsWith("https://")) {
    return baseUrl;
  }
  if (isDevelopment) {
    if (!LOCAL_DEVELOPMENT_URL.test(baseUrl)) {
      throw new Error("Insecure API URLs are allowed only for local development hosts.");
    }
    return baseUrl;
  }
  if (
    isAndroidE2E
    && baseUrl === ANDROID_EMULATOR_E2E_URL
  ) {
    return baseUrl;
  }
  throw new Error("EXPO_PUBLIC_API_URL must use HTTPS in production.");
}
