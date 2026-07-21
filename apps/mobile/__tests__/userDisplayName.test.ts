import { formatUserDisplayName } from "@/lib/userDisplayName";

describe("formatUserDisplayName", () => {
  it("does not append whitespace when the last name is empty", () => {
    expect(formatUserDisplayName({ first_name: "E2E Potvrzeno", last_name: "" })).toBe(
      "E2E Potvrzeno",
    );
  });

  it("normalizes both name parts", () => {
    expect(formatUserDisplayName({ first_name: "  Jana ", last_name: " Nováková  " })).toBe(
      "Jana Nováková",
    );
  });

  it("uses a stable fallback when no name is available", () => {
    expect(formatUserDisplayName(null)).toBe("Uživatel");
    expect(formatUserDisplayName({ first_name: " ", last_name: "" })).toBe("Uživatel");
  });
});
