import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";

import { API_BASE_URL } from "@/lib/api";

const LOCAL_HTTP_HOSTS = new Set(["127.0.0.1", "localhost", "10.0.2.2"]);

export type PublicDocumentUrls = {
  privacyPolicy: string;
  terms: string;
  support: string;
};

export function derivePublicDocumentUrls(apiBaseUrl: string): PublicDocumentUrls {
  const parsed = new URL(apiBaseUrl);
  const secure = parsed.protocol === "https:";
  const localE2E = parsed.protocol === "http:" && LOCAL_HTTP_HOSTS.has(parsed.hostname);
  if (!secure && !localE2E) {
    throw new Error("Public document URLs require an HTTPS API origin.");
  }
  return {
    privacyPolicy: new URL("/ochrana-soukromi/", parsed.origin).toString(),
    terms: new URL("/obchodni-podminky/", parsed.origin).toString(),
    support: new URL("/podpora/", parsed.origin).toString(),
  };
}

const publicDocuments = derivePublicDocumentUrls(API_BASE_URL);
export const PRIVACY_POLICY_URL = publicDocuments.privacyPolicy;
export const TERMS_URL = publicDocuments.terms;
export const SUPPORT_URL = publicDocuments.support;

export async function openPublicDocument(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    });
  } catch {
    Alert.alert(
      "Odkaz se nepodařilo otevřít",
      "Zkontrolujte připojení a zkuste to znovu. V naléhavé situaci volejte 112 nebo 155.",
    );
  }
}
