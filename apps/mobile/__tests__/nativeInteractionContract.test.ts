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

it("keeps server-confirmed check-in feedback visible until an explicit action", () => {
  const source = readFileSync(resolve(mobileRoot, "components/SuccessOverlay.tsx"), "utf8");
  expect(source).toContain("<Modal");
  expect(source).toContain('testID="checkin-success-overlay"');
  expect(source).toContain("accessibilityViewIsModal");
  expect(source).toContain("importantForAccessibility=\"yes\"");
  expect(source).toContain("accessible\n");
  expect(source).toContain('accessibilityRole="alert"');
  expect(source).toContain('accessibilityLiveRegion="assertive"');
  expect(source).toContain("Další termín za ${formatInterval(intervalHours)}");
  expect(source).toContain('testID="checkin-success-continue"');
  expect(source).toContain('accessibilityLabel="Pokračovat po potvrzeném check-inu"');
  expect(source.match(/setTimeout\(/g)).toHaveLength(3);
  expect(source).toContain("const circleTimer = setTimeout");
  expect(source).toContain("const checkmarkTimer = setTimeout");
  expect(source).toContain("const textTimer = setTimeout");
  expect(source).not.toContain("autoDismissTimer");
  expect(source).not.toContain("setTimeout(handleDismiss");
});

it("keeps check-in queueing available from the last confirmed offline profile", () => {
  const source = readFileSync(resolve(mobileRoot, "app/(tabs)/index.tsx"), "utf8");
  expect(source).toContain("if (isCheckingIn) return;");
  expect(source).toContain("disabled={profile.is_paused || !profile.enabled}");
  expect(source).toContain("serverový termín se nezmění, dokud požadavek nepřijme");
});

it("treats location as a one-attempt choice and shows the last confirmed check-in", () => {
  const source = readFileSync(resolve(mobileRoot, "app/(tabs)/index.tsx"), "utf8");
  expect(source).toContain("setIncludeLocation(false);\n    const feedback");
  expect(source).toContain("}, [store.profile?.id]);");
  expect(source).toContain("Poslední serverem potvrzené ohlášení");
  expect(source).toContain("formatLastCheckIn(profile.last_checked_in_at)");
});

it("keeps diagnostics read-only until location is chosen for a check-in", () => {
  const diagnostics = readFileSync(
    resolve(mobileRoot, "app/(tabs)/diagnostics.tsx"),
    "utf8",
  );
  const locationHook = readFileSync(resolve(mobileRoot, "hooks/useLocation.ts"), "utf8");

  expect(diagnostics).not.toContain("requestForegroundPermissionsAsync");
  expect(diagnostics).not.toContain('testID="location-permission-request"');
  expect(diagnostics).toContain("Diagnostika oprávnění pouze čte");
  expect(diagnostics).toContain("až po zapnutí polohy u konkrétního check-inu");
  expect(locationHook).toContain("requestForegroundPermissionsAsync");
});

it("reloads safety history whenever its tab regains focus", () => {
  const source = readFileSync(resolve(mobileRoot, "app/(tabs)/activity.tsx"), "utf8");
  expect(source).toContain("useFocusEffect(");
  expect(source).toContain("void load();");
});

it("offers owner-only location deletion without rendering coordinates", () => {
  const source = readFileSync(resolve(mobileRoot, "app/(tabs)/activity.tsx"), "utf8");
  expect(source).toContain("event.details.has_location");
  expect(source).toContain("checkin-location-delete-");
  expect(source).toContain("Souřadnice se zde nikdy nezobrazují");
  expect(source).toContain("Serverová data zůstala beze změny");
});

it("offers indefinite and scheduled pause choices before contacting the server", () => {
  const source = readFileSync(resolve(mobileRoot, "app/(tabs)/index.tsx"), "utf8");
  expect(source).toContain('testID={`pause-duration-${option.value}`}');
  expect(source).toContain('testID="pause-confirm"');
  expect(source).toContain("pauseRequestForPreset(pauseDuration)");
  expect(source).toContain("Pauza začne až po potvrzení serverem");
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
