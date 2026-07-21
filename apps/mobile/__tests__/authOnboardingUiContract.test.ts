declare const __dirname: string;
declare function require(moduleName: string): any;

const { readFileSync } = require("fs") as {
  readFileSync: (path: string, encoding: string) => string;
};
const { resolve } = require("path") as {
  resolve: (...paths: string[]) => string;
};

const mobileRoot = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(mobileRoot, path), "utf8");
const authFiles = [
  "app/(auth)/_layout.tsx",
  "app/(auth)/login.tsx",
  "app/(auth)/register.tsx",
  "app/(auth)/forgot-password.tsx",
  "app/(auth)/verify-email.tsx",
];
const onboardingFiles = [
  "app/(onboarding)/_layout.tsx",
  "app/(onboarding)/index.tsx",
  "app/(onboarding)/empathy.tsx",
  "app/(onboarding)/solution.tsx",
  "app/(onboarding)/demo.tsx",
  "app/(onboarding)/signup.tsx",
];

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => Number.parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

describe("auth and onboarding UI contract", () => {
  it("uses Satoshi and system reduced-motion handling throughout the flow", () => {
    const sources = [...authFiles, ...onboardingFiles].map(read).join("\n");

    expect(sources).not.toContain("font-lora");
    expect(sources).toContain("font-display");
    expect(sources).toContain("font-body");
    expect(sources).toMatch(/ReduceMotion\.System|useReducedMotion/);
  });

  it("keeps registration verification-only without automatic login", () => {
    for (const file of ["app/(auth)/register.tsx", "app/(onboarding)/signup.tsx"]) {
      const source = read(file);
      expect(source).toContain("await register(");
      expect(source).toContain("/(auth)/verify-email");
      expect(source).not.toMatch(/await login\(|setUser\(/);
    }

    const onboardingSignup = read("app/(onboarding)/signup.tsx");
    expect(onboardingSignup.indexOf("await register(")).toBeLessThan(
      onboardingSignup.indexOf("await completeOnboarding()"),
    );
  });

  it("requires the reusable accessible legal consent on both registration paths", () => {
    for (const file of ["app/(auth)/register.tsx", "app/(onboarding)/signup.tsx"]) {
      const source = read(file);
      expect(source).toContain("LegalConsent");
      expect(source).toContain("termsAccepted");
      expect(source).toContain("termsAccepted: true");
      expect(source).toContain("Před vytvořením účtu potvrďte podmínky");
    }

    const consent = read("components/auth/LegalConsent.tsx");
    expect(consent).toContain('accessibilityRole="checkbox"');
    expect(consent).toContain('accessibilityRole="link"');
    expect(consent).toContain("accessibilityState={{ checked, disabled }}");
    expect(consent).toContain("aria-describedby={error ? errorId : undefined}");
    expect(consent).toContain("nativeID={errorId}");
    expect(consent).toContain('className="mt-1 font-body text-sm leading-5 text-[#9E382E]"');
    expect(consent).toContain("min-h-[48px]");
  });

  it("does not turn password reset into an account enumeration oracle", () => {
    const source = read("app/(auth)/forgot-password.tsx");

    expect(source).toContain("Pokud účet pro zadanou adresu existuje");
    expect(source).toContain("neprozradíme, jestli je u nás registrovaná");
    expect(source).not.toContain("odeslán na {email}");
  });

  it("describes server confirmation, incidents and best-effort push without guarantees", () => {
    const sources = [...onboardingFiles, "constants/onboarding.ts"].map(read).join("\n");

    expect(sources).toContain("potvrzení serverem");
    expect(sources).toContain("doručení push nelze garantovat");
    expect(sources).toContain("není tísňová služba");
    expect(sources).not.toMatch(/Pokaždé|budou vědět|spustí se alarm|okamžitě/iu);
  });

  it("exposes stable controls and accessible field-error relationships", () => {
    const sources = [...authFiles, ...onboardingFiles].map(read).join("\n");
    const requiredTestIds = [
      "login-submit-button",
      "register-submit-button",
      "forgot-password-submit-button",
      "email-verification-resend-button",
      "onboarding-persona-continue-button",
      "onboarding-empathy-continue-button",
      "onboarding-solution-continue-button",
      "onboarding-demo-checkin-button",
      "onboarding-demo-continue-button",
      "onboarding-register-submit-button",
    ];

    for (const testID of requiredTestIds) expect(sources).toContain(`testID="${testID}"`);
    const input = read("components/auth/AuthInput.tsx");
    expect(input).toContain("aria-describedby");
    expect(input).toContain("nativeID={errorId}");
    expect(input).toContain('accessibilityLabel={passwordVisible ? "Skrýt heslo" : "Zobrazit heslo"}');
  });

  it("keeps primary button hit targets stable without press-time layout animation", () => {
    const button = read("components/auth/AuthButton.tsx");
    const persona = read("app/(onboarding)/index.tsx");

    expect(button).toContain("<Pressable");
    expect(button).not.toContain("Animated.createAnimatedComponent(Pressable)");
    expect(button).not.toContain("onPressIn");
    expect(button).not.toContain("onPressOut");
    expect(button).toContain('pointerEvents="none"');
    expect(persona.indexOf("await setPersona(selected)")).toBeLessThan(
      persona.indexOf('router.push("/(onboarding)/empathy")'),
    );
  });

  it("meets WCAG AA contrast for primary actions and inline action text", () => {
    expect(contrast("#FFF8F5", "#2D2926")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#9E382E", "#FFF8F5")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#6B625E", "#FFF8F5")).toBeGreaterThanOrEqual(4.5);

    const button = read("components/auth/AuthButton.tsx");
    expect(button).toContain("overflow-hidden rounded-[20px] bg-charcoal");
    expect(button).toContain("text-cream");
  });
});
