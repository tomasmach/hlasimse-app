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
