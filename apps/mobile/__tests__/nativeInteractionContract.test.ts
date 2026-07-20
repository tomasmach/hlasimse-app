declare const __dirname: string;
declare function require(moduleName: string): any;

const { readFileSync } = require("fs") as {
  readFileSync: (path: string, encoding: string) => string;
};
const { resolve } = require("path") as {
  resolve: (...paths: string[]) => string;
};

const mobileRoot = resolve(__dirname, "..");
const interactionFiles = [
  "components/auth/AuthButton.tsx",
  "components/navigation/FloatingTabBar.tsx",
  "components/ui/GradientButton.tsx",
  "components/GuardianCard.tsx",
  "app/(onboarding)/demo.tsx",
];

it("keeps native press targets stable for critical actions and navigation", () => {
  for (const path of interactionFiles) {
    const source = readFileSync(resolve(mobileRoot, path), "utf8");
    expect(source).not.toContain("Animated.createAnimatedComponent(Pressable)");
    expect(source).not.toContain("onPressIn");
    expect(source).not.toContain("onPressOut");
  }
});

it("keeps the incident acknowledgement above the floating tab bar", () => {
  const source = readFileSync(resolve(mobileRoot, "app/(tabs)/incident/[id].tsx"), "utf8");
  expect(source).toContain('contentContainerClassName="px-5 pb-36"');
});

it("exposes the server-confirmed check-in overlay as one dismiss action", () => {
  const source = readFileSync(resolve(mobileRoot, "components/SuccessOverlay.tsx"), "utf8");
  expect(source).toContain('testID="checkin-success-overlay"');
  expect(source).toContain('accessibilityLabel="Check-in potvrzen serverem. Klepnutím zavřete."');
});

it("keeps check-in queueing available from the last confirmed offline profile", () => {
  const source = readFileSync(resolve(mobileRoot, "app/(tabs)/index.tsx"), "utf8");
  expect(source).toContain("if (isCheckingIn) return;");
  expect(source).toContain("disabled={profile.is_paused || !profile.enabled}");
  expect(source).toContain("serverový termín se nezmění, dokud požadavek nepřijme");
});

it("reloads safety history whenever its tab regains focus", () => {
  const source = readFileSync(resolve(mobileRoot, "app/(tabs)/activity.tsx"), "utf8");
  expect(source).toContain("useFocusEffect(");
  expect(source).toContain("void load();");
});

it("returns settings-only account screens to settings instead of tab history", () => {
  const tabLayout = readFileSync(resolve(mobileRoot, "app/(tabs)/_layout.tsx"), "utf8");
  expect(tabLayout).toContain('backBehavior="history"');
  expect(tabLayout).toMatch(/name="delete-account"[\s\S]*?headerShown: false/);
  for (const path of ["app/(tabs)/data-export.tsx", "app/(tabs)/delete-account.tsx"]) {
    const source = readFileSync(resolve(mobileRoot, path), "utf8");
    expect(source).toContain('onBack={() => router.replace("/(tabs)/settings")}');
  }
  const deletion = readFileSync(resolve(mobileRoot, "app/(tabs)/delete-account.tsx"), "utf8");
  expect(deletion).toContain('{ text: "Ano, smazat účet", style: "destructive"');
});
