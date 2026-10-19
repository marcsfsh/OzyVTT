/**
 * How a higher spell slot changes a spell's duration and its Concentration, read from each spell's higher-level text
 * (SRD 5.2.1) into rows the engine reads with the cast's level (`spellDurationAt`). The text prints these several ways
 * ("Your Concentration can last longer with a spell slot of level 5 (up to 10 minutes)", "The duration increases by 1
 * hour for each spell slot level above 3"), so the rows are reviewed here, and `test/spell-durations.test.ts` checks
 * every spell whose higher-level text speaks of its duration has them.
 */
import type { UpcastDuration } from "../src/schemas.js";

const held = (level: number, duration: string): UpcastDuration => ({ level, duration, concentration: true });
const free = (level: number, duration: string): UpcastDuration => ({ level, duration, concentration: false });

/** One row for each slot level from `from` to 9, `perSlot` units longer each level: "increases by 1 hour for each spell
 *  slot level above 3". */
const growing = (
  from: number,
  base: number,
  perSlot: number,
  unit: "hours",
  concentration: boolean
): UpcastDuration[] =>
  Array.from({ length: 10 - from }, (_, index) => ({
    level: from + index,
    duration: `${base + perSlot * (index + 1)} ${unit}`,
    concentration
  }));

const UPCAST_DURATIONS: Readonly<Record<string, readonly UpcastDuration[]>> = {
  // "The spell's duration increases by 48 hours for each spell slot level above 2."
  "animal-messenger": growing(3, 24, 48, "hours", false),
  // A level 4 slot holds Concentration up to 10 minutes; a level 5+ slot needs none and lasts 8 hours (5 and 6), 24
  // hours (7 and 8) or until dispelled (9).
  "bestow-curse": [held(4, "10 minutes"), free(5, "8 hours"), free(7, "24 hours"), free(9, "until dispelled")],
  "dominate-beast": [held(5, "10 minutes"), held(6, "1 hour"), held(7, "8 hours")],
  "dominate-monster": [held(9, "8 hours")],
  "dominate-person": [held(6, "10 minutes"), held(7, "1 hour"), held(8, "8 hours")],
  // "If you use a level 7 or 8 spell slot, the duration is 365 days. If you use a level 9 spell slot, the spell lasts
  // until it is ended by one of the spells mentioned above."
  geas: [free(7, "365 days"), free(9, "until dispelled")],
  hex: [held(2, "4 hours"), held(3, "8 hours"), held(5, "24 hours")],
  "hunters-mark": [held(3, "8 hours"), held(5, "24 hours")],
  // "The duration increases by 1 hour for each spell slot level above 3."
  "magic-circle": growing(4, 1, 1, "hours", false),
  // "The spell lasts until dispelled, without requiring Concentration, if cast with a level 4+ spell slot."
  "major-image": [free(4, "until dispelled")],
  "mass-suggestion": [free(7, "10 days"), free(8, "30 days"), free(9, "366 days")],
  "planar-binding": [free(6, "10 days"), free(7, "30 days"), free(8, "180 days"), free(9, "366 days")]
};

/** A spell's reviewed higher-slot durations, lowest slot first, or undefined when every slot lasts the same. */
export function upcastDurationsFor(id: string): UpcastDuration[] | undefined {
  const rows = UPCAST_DURATIONS[id];
  return rows ? rows.map((row) => ({ ...row })) : undefined;
}

/** The reviewed ids, so a test can check each still names a real spell. */
export const UPCAST_DURATION_IDS: readonly string[] = Object.keys(UPCAST_DURATIONS);
