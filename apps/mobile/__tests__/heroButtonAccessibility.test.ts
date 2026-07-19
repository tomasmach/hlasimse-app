import { getHeroButtonAccessibility } from "../components/heroButtonAccessibility";

describe("getHeroButtonAccessibility", () => {
  it("describes an actionable check-in button", () => {
    const accessibility = getHeroButtonAccessibility({
      disabled: false,
      isLoading: false,
      showSuccess: false,
    });

    expect(accessibility.label).toBe("Odeslat hlášení");
    expect(accessibility.hint).toContain("serveru");
    expect(accessibility.state).toEqual({ disabled: false, busy: false });
    expect(accessibility.value.text).toBe("Připraveno k odeslání");
  });

  it("announces loading and prevents another activation", () => {
    const accessibility = getHeroButtonAccessibility({
      disabled: false,
      isLoading: true,
      showSuccess: false,
    });

    expect(accessibility.label).toBe("Odesílání hlášení");
    expect(accessibility.hint).toBeUndefined();
    expect(accessibility.state).toEqual({ disabled: true, busy: true });
  });

  it("labels success specifically as server-confirmed", () => {
    const accessibility = getHeroButtonAccessibility({
      disabled: false,
      isLoading: false,
      showSuccess: true,
    });

    expect(accessibility.value.text).toBe("Hlášení potvrzeno serverem");
  });
});
