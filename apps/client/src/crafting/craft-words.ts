/** Minutes of work as 8-hour days, to a tenth, as SRD 5.2.1 Crafting counts them. */
export const workDays = (minutes: number) => Math.round((minutes / 480) * 10) / 10;

/** A project's work in 8-hour days ("2.5 days"). */
export function daysWords(minutes: number): string {
  const days = workDays(minutes);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Copper as coins: "25 GP", "7 GP 5 SP", "4 CP". */
export function coinWords(cp: number): string {
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const copper = cp % 10;
  const parts = [gp > 0 ? `${gp} GP` : "", sp > 0 ? `${sp} SP` : "", copper > 0 ? `${copper} CP` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "0 GP";
}
