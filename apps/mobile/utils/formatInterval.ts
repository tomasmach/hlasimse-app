/**
 * Formats an interval in hours into a Czech-localized human-readable string.
 * Handles proper Czech plural forms for both hours and days.
 */
export function formatInterval(hours: number): string {
  const minutes = Math.round(hours * 60);
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    if (days === 1) return "1 den";
    if (days >= 2 && days <= 4) return `${days} dny`;
    return `${days} dnů`;
  }
  if (minutes % 60 === 0) {
    const wholeHours = minutes / 60;
    if (wholeHours === 1) return "1 hodinu";
    if (wholeHours >= 2 && wholeHours <= 4) return `${wholeHours} hodiny`;
    return `${wholeHours} hodin`;
  }
  if (minutes === 1) return "1 minutu";
  if (minutes >= 2 && minutes <= 4) return `${minutes} minuty`;
  return `${minutes} minut`;
}
