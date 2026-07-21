import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";

declare const __dirname: string;
declare function require(moduleName: string): any;

const { readFileSync } = require("fs") as {
  readFileSync: (path: string, encoding: string) => string;
};
const { resolve } = require("path") as {
  resolve: (...paths: string[]) => string;
};

jest.mock("@/lib/api", () => ({ API_BASE_URL: "https://api.hlasim.se/api/v1" }));

import {
  derivePublicDocumentUrls,
  openPublicDocument,
  PRIVACY_POLICY_URL,
  SUPPORT_URL,
  TERMS_URL,
} from "@/lib/legal";

const openBrowser = WebBrowser.openBrowserAsync as jest.MockedFunction<
  typeof WebBrowser.openBrowserAsync
>;
const alert = Alert.alert as jest.MockedFunction<typeof Alert.alert>;

beforeEach(() => {
  jest.clearAllMocks();
});

it("derives every public document from the HTTPS API origin", () => {
  expect(derivePublicDocumentUrls("https://api.example.cz/api/v1/")).toEqual({
    privacyPolicy: "https://api.example.cz/ochrana-soukromi/",
    terms: "https://api.example.cz/obchodni-podminky/",
    support: "https://api.example.cz/podpora/",
  });
  expect(PRIVACY_POLICY_URL).toBe("https://api.hlasim.se/ochrana-soukromi/");
  expect(TERMS_URL).toBe("https://api.hlasim.se/obchodni-podminky/");
  expect(SUPPORT_URL).toBe("https://api.hlasim.se/podpora/");
});

it("rejects insecure public origins but preserves native local E2E routing", () => {
  expect(() => derivePublicDocumentUrls("http://api.example.cz/api/v1")).toThrow(
    "require an HTTPS API origin",
  );
  expect(derivePublicDocumentUrls("http://10.0.2.2:8000/api/v1").support).toBe(
    "http://10.0.2.2:8000/podpora/",
  );
});

it("opens a page sheet and reports browser failures without an unhandled rejection", async () => {
  await openPublicDocument(TERMS_URL);

  expect(openBrowser).toHaveBeenCalledWith(TERMS_URL, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
  });

  openBrowser.mockRejectedValueOnce(new Error("browser unavailable"));
  await expect(openPublicDocument(SUPPORT_URL)).resolves.toBeUndefined();
  expect(alert).toHaveBeenCalledWith(
    "Odkaz se nepodařilo otevřít",
    expect.stringContaining("112 nebo 155"),
  );
});

it("exposes all three Settings destinations as accessible links", () => {
  const source = readFileSync(resolve(__dirname, "../app/(tabs)/settings.tsx"), "utf8");

  for (const testID of [
    "settings-privacy-link",
    "settings-terms-link",
    "settings-support-link",
  ]) {
    expect(source).toContain(`testID="${testID}"`);
  }
  expect(source).toContain("Dokumenty a podpora");
  expect(source).toContain('accessibilityRole="header"');
  expect(source.match(/accessibilityRole="link"/g)).toHaveLength(3);
  expect(source).toContain("PRIVACY_POLICY_URL");
  expect(source).toContain("TERMS_URL");
  expect(source).toContain("SUPPORT_URL");
});
