type HeroButtonAccessibilityOptions = {
  disabled: boolean;
  isLoading: boolean;
  showSuccess: boolean;
};

export function getHeroButtonAccessibility({
  disabled,
  isLoading,
  showSuccess,
}: HeroButtonAccessibilityOptions) {
  const isUnavailable = disabled || isLoading;

  return {
    label: isLoading ? "Odesílání hlášení" : "Odeslat hlášení",
    hint: isUnavailable
      ? undefined
      : "Odešle serveru potvrzení, že jste v pořádku.",
    state: {
      disabled: isUnavailable,
      busy: isLoading,
    },
    value: {
      text: showSuccess
        ? "Hlášení potvrzeno serverem"
        : isLoading
          ? "Probíhá odesílání"
          : "Připraveno k odeslání",
    },
  };
}
