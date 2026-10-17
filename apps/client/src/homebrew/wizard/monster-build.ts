/**
 * A homebrew monster's stat-block numbers, kept the way the SRD's bundled stat blocks keep them, so the sheet, the
 * bestiary and the rules engine read a homebrew creature exactly as they read an SRD one:
 *
 * - Challenge rating, XP and Proficiency Bonus go together (`proficiencyBonusForChallenge`, checked against every
 *   SRD stat block).
 * - Hit Points are a die per size and Constitution once per die (`monsterHitPoints`, checked the same way).
 * - Saving throws and skills are printed totals in the `open5e.srd-2024` bag (`savingThrows`, `skills`), which is
 *   what `saveModifierFor` and `statBlockSkill` read. Which ones are proficient is read back from those totals, so a
 *   change of score or CR keeps them proficient and moves their numbers.
 * - Speeds and senses are the bag's `speeds` and `senses` ("darkvision 60 ft."), which movement and sight read.
 *
 * Pure functions over the record, so the record is the only place an answer is kept.
 */

import { SRD_SKILL_ABILITY } from "@vtt/content-srd-5.2.1/schemas";
import {
  HIT_DIE_BY_SIZE,
  experienceForChallenge,
  monsterHitPoints,
  proficiencyBonusForChallenge,
  type CreatureSize
} from "@vtt/rules-5e";
import type { Draft } from "../schema";

export const STATBLOCK = "open5e.srd-2024";
export const ABILITY_IDS = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityId = (typeof ABILITY_IDS)[number];

export const ABILITY_NAMES: Readonly<Record<AbilityId, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

export const modifierOf = (score: number) => Math.floor((score - 10) / 2);
export const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;

type Bag = Record<string, unknown>;

export const statblockOf = (draft: Draft): Bag =>
  ((draft.extensions as Record<string, unknown> | undefined)?.[STATBLOCK] as Bag | undefined) ?? {};

/** The record with keys of the stat-block bag replaced; `undefined` removes one. */
export function withStatblock(draft: Draft, patch: Readonly<Record<string, unknown>>): Draft {
  const bag: Bag = { ...statblockOf(draft) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete bag[key];
    else bag[key] = value;
  }
  return { ...draft, extensions: { ...((draft.extensions as Bag | undefined) ?? {}), [STATBLOCK]: bag } };
}

export function scoresOf(draft: Draft): Record<AbilityId, number> {
  const held = (draft.abilityScores as Partial<Record<AbilityId, number>> | undefined) ?? {};
  return Object.fromEntries(ABILITY_IDS.map((ability) => [ability, held[ability] ?? 10])) as Record<AbilityId, number>;
}

export const proficiencyOf = (draft: Draft) =>
  typeof draft.proficiencyBonus === "number" ? draft.proficiencyBonus : 2;

export const challengeOf = (draft: Draft): number | null => {
  const rating = statblockOf(draft).challengeRating;
  return typeof rating === "number" ? rating : null;
};

export const sizeOf = (draft: Draft): CreatureSize =>
  typeof draft.size === "string" && draft.size in HIT_DIE_BY_SIZE ? (draft.size as CreatureSize) : "medium";

/* ------------------------------------------------------------ saves and skills ---- */

export type Tier = "proficient" | "expertise";

/** Which saves the printed totals make proficient: a total above the bare modifier by the Proficiency Bonus. */
export function proficientSaves(draft: Draft): ReadonlySet<AbilityId> {
  const totals = statblockOf(draft).savingThrows as Partial<Record<AbilityId, number | null>> | undefined;
  const scores = scoresOf(draft);
  const proficiency = proficiencyOf(draft);
  return new Set(
    ABILITY_IDS.filter((ability) => {
      const total = totals?.[ability];
      return typeof total === "number" && total - modifierOf(scores[ability]) >= proficiency && proficiency > 0;
    })
  );
}

const abilityOfSkill = (skill: string): AbilityId => (SRD_SKILL_ABILITY[skill] as AbilityId | undefined) ?? "wis";

/** Each printed skill's tier: twice the Proficiency Bonus above the modifier is Expertise. */
export function skillTiers(draft: Draft): ReadonlyMap<string, Tier> {
  const totals = (statblockOf(draft).skills as Record<string, number> | undefined) ?? {};
  const scores = scoresOf(draft);
  const proficiency = proficiencyOf(draft);
  const out = new Map<string, Tier>();
  for (const [skill, total] of Object.entries(totals)) {
    if (typeof total !== "number") continue;
    const above = total - modifierOf(scores[abilityOfSkill(skill)]);
    out.set(skill, proficiency > 0 && above >= proficiency * 2 ? "expertise" : "proficient");
  }
  return out;
}

/** The printed totals for these proficiencies at the record's scores and Proficiency Bonus, and the Passive
 *  Perception they give. Saves are written as the SRD writes them, all six, once any is proficient. */
export function withProficiencies(
  draft: Draft,
  saves: ReadonlySet<AbilityId>,
  skills: ReadonlyMap<string, Tier>
): Draft {
  const scores = scoresOf(draft);
  const proficiency = proficiencyOf(draft);
  const hadSaves = statblockOf(draft).savingThrows !== undefined;
  const savingThrows =
    saves.size > 0 || hadSaves
      ? Object.fromEntries(
          ABILITY_IDS.map((ability) => [ability, modifierOf(scores[ability]) + (saves.has(ability) ? proficiency : 0)])
        )
      : undefined;
  const skillTotals = Object.fromEntries(
    [...skills.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([skill, tier]) => [
        skill,
        modifierOf(scores[abilityOfSkill(skill)]) + proficiency * (tier === "expertise" ? 2 : 1)
      ])
  );
  const perception = (skillTotals.perception as number | undefined) ?? modifierOf(scores.wis);
  return withStatblock(draft, {
    savingThrows,
    skills: skills.size > 0 ? skillTotals : undefined,
    passivePerception: 10 + perception
  });
}

/** Re-prints saves, skills, Passive Perception and Initiative after `change`, keeping what was proficient. */
function keepingProficiencies(before: Draft, after: Draft): Draft {
  const dexBefore = modifierOf(scoresOf(before).dex);
  const initiative = typeof before.initiativeBonus === "number" ? before.initiativeBonus : dexBefore;
  const next = { ...after, initiativeBonus: modifierOf(scoresOf(after).dex) + (initiative - dexBefore) };
  return withProficiencies(next, proficientSaves(before), skillTiers(before));
}

/* -------------------------------------------------------------- hit points ---- */

/** How many Hit Dice the formula rolls, when it is the size's die (the record was built from dice). */
export function hitDiceOf(draft: Draft): number | null {
  const formula = (draft.hitPoints as { formula?: string } | undefined)?.formula ?? "";
  const match = /^(\d+)d(\d+)/.exec(formula.replace(/\s+/g, ""));
  return match && Number(match[2]) === HIT_DIE_BY_SIZE[sizeOf(draft)] ? Number(match[1]) : null;
}

export function withHitDice(draft: Draft, dice: number): Draft {
  const built = monsterHitPoints(dice, sizeOf(draft), scoresOf(draft).con);
  return {
    ...draft,
    hitPoints: { ...((draft.hitPoints as Bag | undefined) ?? {}), maximum: built.average, formula: built.formula }
  };
}

/** Hit Points rebuilt from the same number of dice after a size or Constitution change, when they were built from
 *  dice in the first place; typed Hit Points are left as typed. */
function rebuiltHitPoints(before: Draft, after: Draft): Draft {
  const dice = hitDiceOf(before);
  if (dice === null) return after;
  const built = monsterHitPoints(dice, sizeOf(before), scoresOf(before).con);
  const held = before.hitPoints as { maximum?: number; formula?: string } | undefined;
  const fromDice =
    held?.maximum === built.average && held.formula?.replace(/\s+/g, "") === built.formula.replace(/\s+/g, "");
  return fromDice ? withHitDice(after, dice) : after;
}

/* ------------------------------------------------- the answers that move others ---- */

/** The bestiary line the SRD gives each stat block: "Small fey, chaotic neutral · CR 1". */
export function summaryLineOf(draft: Draft): string {
  const bag = statblockOf(draft);
  const size = sizeOf(draft);
  const type = typeof bag.type === "string" && bag.type ? bag.type : "being";
  const alignment = typeof bag.alignment === "string" && bag.alignment ? `, ${bag.alignment}` : "";
  const rating = challengeOf(draft);
  const cr =
    rating === null
      ? ""
      : ` · CR ${rating === 0.125 ? "1/8" : rating === 0.25 ? "1/4" : rating === 0.5 ? "1/2" : rating}`;
  return `${size.charAt(0).toUpperCase()}${size.slice(1)} ${type}${alignment}${cr}`;
}

/** The summary follows the answers until the GM writes their own. */
function withSummary(before: Draft, after: Draft): Draft {
  const held = typeof before.summary === "string" ? before.summary : "";
  return held.trim() === "" || held === summaryLineOf(before) ? { ...after, summary: summaryLineOf(after) } : after;
}

/** One square per 5 feet of space: Tiny to Medium take one, Large 2x2, Huge 3x3, Gargantuan 4x4. */
const FOOTPRINT: Readonly<Record<CreatureSize, number>> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4
};

export function withSize(draft: Draft, size: CreatureSize): Draft {
  const token = (draft.token as Bag | undefined) ?? {};
  const after = {
    ...draft,
    size,
    token: { ...token, footprint: { width: FOOTPRINT[size], height: FOOTPRINT[size] } }
  };
  return withSummary(draft, rebuiltHitPoints(draft, after));
}

export function withChallenge(draft: Draft, challengeRating: number): Draft {
  const after = withStatblock(
    { ...draft, proficiencyBonus: proficiencyBonusForChallenge(challengeRating) },
    { challengeRating, experiencePoints: experienceForChallenge(challengeRating) ?? undefined }
  );
  return withSummary(draft, keepingProficiencies(draft, after));
}

export function withScore(draft: Draft, ability: AbilityId, score: number): Draft {
  const after = { ...draft, abilityScores: { ...scoresOf(draft), [ability]: score } };
  return rebuiltHitPoints(draft, keepingProficiencies(draft, after));
}

/** Creature type and alignment, which the summary line names. */
export function withIdentity(draft: Draft, patch: Readonly<{ type?: string; alignment?: string }>): Draft {
  return withSummary(draft, withStatblock(draft, patch));
}

export function withSaves(draft: Draft, saves: ReadonlySet<AbilityId>): Draft {
  return withProficiencies(draft, saves, skillTiers(draft));
}

export function withSkills(draft: Draft, skills: ReadonlyMap<string, Tier>): Draft {
  return withProficiencies(draft, proficientSaves(draft), skills);
}

/* ---------------------------------------------------------- speeds and senses ---- */

export const SPEED_MODES = ["walk", "fly", "swim", "climb", "burrow"] as const;
export type SpeedMode = (typeof SPEED_MODES)[number];
type Speeds = Partial<Record<SpeedMode, number | null>> & { hover?: boolean };

export function speedsOf(draft: Draft): Speeds {
  const held = (statblockOf(draft).speeds as Speeds | undefined) ?? {};
  return { ...held, walk: typeof draft.speedFeet === "number" ? draft.speedFeet : (held.walk ?? 30) };
}

/** Walking is `speedFeet`, which the engine moves on; the others are the bag's `speeds`, as the SRD prints them. */
export function withSpeed(draft: Draft, mode: SpeedMode, feet: number | null): Draft {
  const speeds: Speeds = {
    walk: null,
    swim: null,
    fly: null,
    climb: null,
    burrow: null,
    hover: false,
    ...speedsOf(draft)
  };
  speeds[mode] = feet;
  if (mode === "fly" && !feet) speeds.hover = false;
  const after = mode === "walk" ? { ...draft, speedFeet: feet ?? 0 } : draft;
  return withStatblock(after, { speeds: { ...speeds, walk: mode === "walk" ? (feet ?? 0) : speeds.walk } });
}

export function withHover(draft: Draft, hover: boolean): Draft {
  const speeds = { walk: null, swim: null, fly: null, climb: null, burrow: null, ...speedsOf(draft), hover };
  return withStatblock(draft, { speeds });
}

export const SENSES = ["blindsight", "darkvision", "tremorsense", "truesight"] as const;
export type Sense = (typeof SENSES)[number];

const SENSE_LINE = /^(blindsight|darkvision|tremorsense|truesight) (\d+) ft\.?/i;

export function sensesOf(draft: Draft): Partial<Record<Sense, number>> {
  const lines = statblockOf(draft).senses;
  const out: Partial<Record<Sense, number>> = {};
  if (!Array.isArray(lines)) return out;
  for (const line of lines) {
    const match = typeof line === "string" ? SENSE_LINE.exec(line) : null;
    if (match) out[match[1].toLowerCase() as Sense] = Number(match[2]);
  }
  return out;
}

/** The bag's `senses` lines ("darkvision 60 ft."), in the SRD's order, keeping any line this doesn't read. */
export function withSense(draft: Draft, sense: Sense, feet: number | null): Draft {
  const lines = Array.isArray(statblockOf(draft).senses) ? (statblockOf(draft).senses as string[]) : [];
  const others = lines.filter((line) => !SENSE_LINE.test(line));
  const known = { ...sensesOf(draft), [sense]: feet ?? undefined };
  const ours = SENSES.filter((name) => typeof known[name] === "number" && known[name]! > 0).map(
    (name) => `${name} ${known[name]} ft.`
  );
  const next = [...ours, ...others];
  return withStatblock(draft, { senses: next.length > 0 ? next : undefined });
}
