import type { SpellEffect, SpellRevival } from "../src/schemas.js";

/**
 * What each SRD 5.2.1 spell that brings back the dead, or keeps a corpse for it, does to the creature it touches, read
 * from its text and reviewed. The server checks the cast's target against it before anything is spent and returns the
 * creature to life as it resolves (`apps/server/src/resolution/revival.ts`). Death from old age and a missing head are
 * the GM's.
 */

const DAY = 24 * 60;
const YEAR = 365 * DAY;

const SPELL_REVIVALS: Readonly<Record<string, SpellRevival>> = {
  // "You touch a creature that has died within the last minute. That creature revives with 1 Hit Point."
  revivify: { hitPoints: "one", withinMinutes: 1 },
  // "... if it has been dead no longer than 10 days and it wasn't Undead when it died. The creature returns to life with
  // 1 Hit Point. This spell also neutralizes any poisons that affected the creature at the time of death."
  "raise-dead": { hitPoints: "one", withinMinutes: 10 * DAY, notUndead: true, endsPoison: true },
  // "... dead for no more than a century, didn't die of old age, and wasn't Undead when it died. The creature returns to
  // life with all its Hit Points ... Casting this spell to revive a creature that has been dead for 365 days or longer
  // taxes you."
  resurrection: {
    hitPoints: "all",
    withinMinutes: 100 * YEAR,
    notUndead: true,
    endsPoison: true,
    taxesCasterAfterMinutes: 365 * DAY
  },
  // "... dead for no longer than 200 years ... revived with all its Hit Points ... neutralizes any poison, cures all
  // magical contagions, and lifts any curses ... The spell can provide a new body if the original no longer exists."
  "true-resurrection": {
    hitPoints: "all",
    withinMinutes: 200 * YEAR,
    newBody: true,
    endsPoison: true,
    endsCurses: true
  },
  // "If the creature has been dead no longer than 10 days, the spell forms a new body for it." The text names no Hit
  // Points; a body made whole has all of them.
  reincarnate: { hitPoints: "all", withinMinutes: 10 * DAY, rollsSpecies: true }
};

/** Gentle Repose: "You touch a corpse ... days spent under the influence of this spell don't count against the time
 *  limit of spells such as Raise Dead." Its 10 days ride an effect on the corpse. */
const GENTLE_REPOSE: Partial<SpellEffect> = {
  reposes: true,
  targets: { count: 1 },
  grant: {
    name: "Gentle Repose",
    tags: ["gentle-repose"],
    target: "target",
    duration: { type: "manual" },
    modifiers: [],
    onEnd: [],
    voidWhileIncapacitated: false,
    concentration: false
  }
};

/** The death and revival fields of one spell's cast model, merged over the rest of it. */
export function spellDeathFor(id: string): Partial<SpellEffect> {
  if (id === "gentle-repose") return structuredClone(GENTLE_REPOSE);
  const revives = SPELL_REVIVALS[id];
  return revives ? { revives: { ...revives } } : {};
}

/** The reviewed ids, so a test can check every row still names a real spell. */
export const SPELL_DEATH_IDS: readonly string[] = [...Object.keys(SPELL_REVIVALS), "gentle-repose"];
