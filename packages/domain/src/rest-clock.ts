// Game time for rests and lasting effects, shared so the server's rules and the GM's rest panel read the same numbers.

/** SRD Resting: "After you finish a Long Rest, you must wait at least 16 hours before starting another one." */
export const LONG_REST_SPACING_HOURS = 16;

/** A round is 6 seconds: ten of them make a minute of game time. */
export const ROUNDS_PER_MINUTE = 10;

/** Hours until a creature may start another Long Rest; 0 when it may now. `lastLongRestAt` is the game hour its
 *  last one ended, null before its first. */
export function longRestWait(lastLongRestAt: number | null, clockHours: number): number {
  if (lastLongRestAt === null) return 0;
  return Math.max(0, lastLongRestAt + LONG_REST_SPACING_HOURS - clockHours);
}

/** "14:05": the clock's time of day. */
export function clockTimeLabel(clockHours: number, clockMinutes = 0): string {
  return `${String(clockHours % 24).padStart(2, "0")}:${String(clockMinutes).padStart(2, "0")}`;
}

/** "Day 3, 14:00": the clock as the table reads it, counted from midnight of day 1. */
export function gameClockLabel(clockHours: number, clockMinutes = 0): string {
  return `Day ${Math.floor(clockHours / 24) + 1}, ${clockTimeLabel(clockHours, clockMinutes)}`;
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/** A span of game time in words, its largest unit first: "45 minutes", "7 hours 30 minutes", "2 days 4 hours". */
export function gameTimeSpanLabel(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours > 0 ? `${plural(days, "day")} ${plural(hours, "hour")}` : plural(days, "day");
  if (hours > 0) return rest > 0 ? `${plural(hours, "hour")} ${plural(rest, "minute")}` : plural(hours, "hour");
  return plural(rest, "minute");
}

/** The same span short enough for a chip: "45 min", "7 h", "2 days". */
export function gameTimeSpanChip(minutes: number): string {
  if (minutes >= 1440) return plural(Math.floor(minutes / 1440), "day");
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h`;
  return `${minutes} min`;
}
