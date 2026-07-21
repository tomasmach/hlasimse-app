declare const __dirname: string;
declare function require(moduleName: string): any;

const { readFileSync } = require("fs") as {
  readFileSync: (path: string, encoding: string) => string;
};
const { resolve } = require("path") as {
  resolve: (...paths: string[]) => string;
};

const mobileRoot = resolve(__dirname, "..");
const repoRoot = resolve(mobileRoot, "../..");
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
  expect(source).toContain("Koordinace strážců");
  expect(source).toContain("incident-acknowledgement-");
  expect(source).toContain("Nepotvrzuje telefonát, zásah, doručení push ani bezpečí člověka");
  expect(source).not.toContain("{key}: {count}");
});

it("removes cached incident location before refreshing a resolved push", () => {
  const rootLayout = readFileSync(resolve(mobileRoot, "app/_layout.tsx"), "utf8");
  const productStore = readFileSync(resolve(mobileRoot, "stores/product.ts"), "utf8");
  expect(rootLayout).toContain('data.type !== "alert_resolved"');
  expect(rootLayout).toContain("invalidateAlert(destination.incidentId)");
  expect(productStore).toContain("const alertMutationRevisions = new Map<string, number>()");
  expect(productStore).toContain("last_known_location: null");
  expect(productStore).not.toContain("let alertMutationRevision = 0");
});

it("keeps server-confirmed check-in feedback visible until an explicit action", () => {
  const source = readFileSync(resolve(mobileRoot, "components/SuccessOverlay.tsx"), "utf8");
  expect(source).toContain("<Modal");
  expect(source).toContain('testID="checkin-success-overlay"');
  expect(source).toContain('testID="checkin-success-summary"');
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

it("targets the accessible server-confirmation summary by stable native id", () => {
  const flowPaths = [
    ".maestro/flows/07_android_location_denied.yaml",
    ".maestro/flows/10_owner_online_core.yaml",
    ".maestro/flows/50_ios_location_denied.yaml",
    ".maestro/flows/55_ios_upgrade_preserves_state.yaml",
  ];

  for (const path of flowPaths) {
    const source = readFileSync(resolve(repoRoot, path), "utf8");
    expect(source).toContain('id: "checkin-success-summary"');
    expect(source).not.toContain('assertVisible: "Check-in potvrzen serverem"');
  }
});

it("derives simulator HTTP access from the native E2E application identity", () => {
  const source = readFileSync(resolve(mobileRoot, "lib/api.ts"), "utf8");
  expect(source).toContain('Platform.OS === "android" && Application.applicationId?.endsWith(".e2e") === true');
  expect(source).toContain('Platform.OS === "ios" && Application.applicationId?.endsWith(".e2e") === true');
  expect(source).not.toContain("EXPO_PUBLIC_E2E");
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

it("keeps archived history selection separate from the operational check-in profile", () => {
  const activity = readFileSync(resolve(mobileRoot, "app/(tabs)/activity.tsx"), "utf8");
  const picker = readFileSync(
    resolve(mobileRoot, "components/product/ProfileTimelinePicker.tsx"),
    "utf8",
  );
  expect(activity).toContain("selectedTimelineProfileId");
  expect(activity).toContain("Pouze historie — profil je archivovaný");
  expect(activity).not.toContain("selectProfile(");
  expect(picker).toContain("timeline-profile-archived-");
  expect(picker).not.toContain("useCheckInStore");
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
  expect(source).toContain("pauseRequestForPreset(pauseDuration, customPauseUntil)");
  expect(source).toContain("Pauza začne až po potvrzení serverem");
  expect(source).toContain('value: "custom"');
  expect(source).toContain('testID="pause-custom-summary"');
  expect(source).toContain("updated.paused_until");
  expect(source).toContain("maximumDate={pickerMaximumDate}");
  expect(source).toContain('accessibilityLabel="Vlastní datum a čas konce pauzy"');
  expect(source).toContain('Časová zóna zařízení: {deviceTimeZone}');
  expect(source.indexOf("pauseRequestForPreset(pauseDuration, customPauseUntil)")).toBeLessThan(
    source.indexOf("setIsChangingPause(true)"),
  );
});

it("returns settings-only account screens to settings instead of tab history", () => {
  const tabLayout = readFileSync(resolve(mobileRoot, "app/(tabs)/_layout.tsx"), "utf8");
  expect(tabLayout).toContain('backBehavior="history"');
  expect(tabLayout).toMatch(/name="delete-account"[\s\S]*?headerShown: false/);
  expect(tabLayout).toMatch(/name="edit-name"[\s\S]*?headerShown: false/);
  for (const path of ["app/(tabs)/data-export.tsx", "app/(tabs)/delete-account.tsx", "app/(tabs)/edit-name.tsx"]) {
    const source = readFileSync(resolve(mobileRoot, path), "utf8");
    expect(source).toContain('onBack={() => router.replace("/(tabs)/settings")}');
  }
  const deletion = readFileSync(resolve(mobileRoot, "app/(tabs)/delete-account.tsx"), "utf8");
  expect(deletion).toContain('{ text: "Ano, smazat účet", style: "destructive"');
});

it("edits the server-confirmed account name while keeping email read-only", () => {
  const settings = readFileSync(resolve(mobileRoot, "app/(tabs)/settings.tsx"), "utf8");
  const editor = readFileSync(resolve(mobileRoot, "app/(tabs)/edit-name.tsx"), "utf8");
  expect(settings).toContain('testID="account-name-open"');
  expect(editor).toContain("updateAccountName({");
  expect(editor).toContain("replaceUserIfCurrent(confirmed)");
  expect(editor).toContain('testID="account-email-readonly"');
  expect(editor).toContain('accessibilityRole="text"');
  expect(editor).toContain('testID="account-name-submit"');
});
