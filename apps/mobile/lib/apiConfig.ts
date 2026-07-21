const DEVELOPMENT_DEFAULT = "http://127.0.0.1:8000";
const ANDROID_EMULATOR_E2E_URL = "http://10.0.2.2:8000";
const IOS_SIMULATOR_E2E_URL = "http://127.0.0.1:8000";
const LOCAL_DEVELOPMENT_URL = /^http:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2)(:\d+)?$/;

type ApiConfigInput = {
  configuredBaseUrl?: string;
  isDevelopment: boolean;
  isAndroidE2E: boolean;
  isIosE2E: boolean;
};

export function resolveApiBaseUrl({
  configuredBaseUrl,
  isDevelopment,
  isAndroidE2E,
  isIosE2E,
}: ApiConfigInput): string {
  if (isAndroidE2E && isIosE2E) {
    throw new Error("Conflicting native E2E application identity.");
  }
  if (isAndroidE2E) {
    return ANDROID_EMULATOR_E2E_URL;
  }
  if (isIosE2E) {
    return IOS_SIMULATOR_E2E_URL;
  }

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
  throw new Error("EXPO_PUBLIC_API_URL must use HTTPS in production.");
}
