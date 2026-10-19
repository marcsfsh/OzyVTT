import type { HitPointBand } from "@vtt/schemas";
import type { SpellEffect, SpellRevival } from "../src/schemas.js";

/**
 * What each SRD 5.2.1 spell that kills outright, brings back the dead or keeps a corpse for it does, read from its text
 * and reviewed. The server checks a revival's target before anything is spent and returns the creature to life as it
 * resolves (`apps/server/src/resolution/revival.ts`); a kill lands with the cast or its damage (`hit-points.ts`,
 * `resolution/kill.ts`, `fatal-saves.ts`). Death from old age and a missing head are the GM's.
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

/** Spells that kill outright or make the dead rise. */
const SPELL_KILLS: Readonly<Record<string, Partial<SpellEffect>>> = {
  // "If this damage reduces it to 0 Hit Points, it and everything nonmagical it is wearing and carrying are
  // disintegrated into gray dust. The target can be revived only by a True Resurrection or a Wish spell."
  disintegrate: { drain: { killsAtZero: { cause: "Disintegrate", bodyGone: true } } },
  // "If the target has 100 Hit Points or fewer, it dies. Otherwise, it takes 12d12 Psychic damage."
  "power-word-kill": { killsAtHitPoints: 100 },
  // "A Humanoid killed by this spell rises at the start of your next turn as a Zombie ... that follows your verbal
  // orders."
  "finger-of-death": { drain: { slainRise: { monsterId: "zombie", creatureTypes: ["humanoid"] } } }
};

/** Divine Word: "On a failed save, a target that has 50 Hit Points or fewer suffers an effect based on its current Hit
 *  Points ... Regardless of its Hit Points, a Celestial, an Elemental, a Fey, or a Fiend target that fails its save is
 *  forced back to its plane of origin ... and can't return to the current plane for 24 hours." */
const DIVINE_WORD: Readonly<{ failureByHitPoints: HitPointBand[]; failureBanishes: string[] }> = {
  failureByHitPoints: [
    { atOrBelow: 20, dies: true },
    {
      atOrBelow: 30,
      conditions: ["blinded", "deafened", "stunned"],
      duration: { type: "minutes", minutes: 60 }
    },
    { atOrBelow: 40, conditions: ["blinded", "deafened"], duration: { type: "rounds", rounds: 100 } },
    { atOrBelow: 50, conditions: ["deafened"], duration: { type: "rounds", rounds: 10 } }
  ],
  failureBanishes: ["celestial", "elemental", "fey", "fiend"]
};

/** The death and revival fields of one spell's cast model, merged over the rest of it. */
export function spellDeathFor(id: string): Partial<SpellEffect> {
  if (id === "gentle-repose") return structuredClone(GENTLE_REPOSE);
  const revives = SPELL_REVIVALS[id];
  if (revives) return { revives: { ...revives } };
  return structuredClone(SPELL_KILLS[id] ?? {});
}

/** The death fields of one spell's save, merged over the rest of it. */
export function spellDeathSaveFor(id: string): Partial<typeof DIVINE_WORD> {
  return id === "divine-word" ? structuredClone(DIVINE_WORD) : {};
}

/** The reviewed ids, so a test can check every row still names a real spell. */
export const SPELL_DEATH_IDS: readonly string[] = [
  ...Object.keys(SPELL_REVIVALS),
  ...Object.keys(SPELL_KILLS),
  "gentle-repose",
  "divine-word"
];
