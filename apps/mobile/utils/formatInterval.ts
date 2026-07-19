/**
 * Formats an interval in hours into a Czech-localized human-readable string.
 * Handles proper Czech plural forms for both hours and days.
 */
export function formatInterval(hours: number): string {
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    if (days === 1) return "1 den";
    if (days >= 2 && days <= 4) return `${days} dny`;
    return `${days} dnů`;
  }
  if (hours === 1) return "1 hodinu";
  if (hours >= 2 && hours <= 4) return `${hours} hodiny`;
  return `${hours} hodin`;
}
