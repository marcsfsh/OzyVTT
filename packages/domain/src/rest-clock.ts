// Game time for rests, shared so the server's 16-hour rule and the GM's rest panel read the same numbers.

/** SRD Resting: "After you finish a Long Rest, you must wait at least 16 hours before starting another one." */
export const LONG_REST_SPACING_HOURS = 16;

/** Hours until a creature may start another Long Rest; 0 when it may now. `lastLongRestAt` is the game hour its
 *  last one ended, null before its first. */
export function longRestWait(lastLongRestAt: number | null, clockHours: number): number {
  if (lastLongRestAt === null) return 0;
  return Math.max(0, lastLongRestAt + LONG_REST_SPACING_HOURS - clockHours);
}

/** "Day 3, 14:00": the clock as the table reads it, counting from midnight of day 1. */
export function gameClockLabel(clockHours: number): string {
  return `Day ${Math.floor(clockHours / 24) + 1}, ${String(clockHours % 24).padStart(2, "0")}:00`;
}
