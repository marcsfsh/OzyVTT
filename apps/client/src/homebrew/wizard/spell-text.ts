/**
 * The spell wizard's answers that live in a spell's own words or its upcast rows.
 *
 * - Healing is read from the text, as the SRD's is (`healingOfText`): "regains Hit Points equal to 2d8 plus your
 *   spellcasting ability modifier". So the healing answer is that sentence, written into the description.
 * - The map template is read from the text too (`areaOfProse`), so the text has to name the area the way the
 *   SRD does ("20-foot-radius Sphere").
 * - Upcasting reads `castingOptions` rows (`slot_level_N`, a cantrip's `player_level_N`), and "At Higher Levels"
 *   is the prose beside them, so both are written from one answer.
 *
 * Pure functions over the record, so the record stays the only place an answer is kept.
 */

import { areaOfProse } from "@vtt/content-srd-5.2.1/action-prose";
import { healingOfText } from "@vtt/content-srd-5.2.1/spell-effect";
import type { Draft } from "../schema";

const ABILITY_WORDS: Readonly<Record<string, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

const title = (slug: string) =>
  slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

/** "a", "b and c", "a, b and c". */
export const listWords = (words: readonly string[]): string =>
  words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/* ------------------------------------------------------------------------- range ---- */

export type RangeKind = "self" | "touch" | "feet" | "miles" | "sight" | "unlimited";

export const RANGE_KINDS: ReadonlyArray<Readonly<{ value: RangeKind; label: string }>> = [
  { value: "self", label: "Self" },
  { value: "touch", label: "Touch" },
  { value: "feet", label: "A distance in feet" },
  { value: "miles", label: "Miles" },
  { value: "sight", label: "Sight" },
  { value: "unlimited", label: "Unlimited" }
];

type Range = Readonly<{ distance: number | null; unit: string | null; text: string | null }>;

const rangeOf = (draft: Draft): Range =>
  (draft.range as Range | undefined) ?? { distance: null, unit: null, text: null };

export function rangeKindOf(draft: Draft): RangeKind | null {
  const range = rangeOf(draft);
  if (range.unit === "feet" && typeof range.distance === "number") return "feet";
  if (range.unit === "miles") return "miles";
  const words = `${range.unit ?? ""} ${range.text ?? ""}`.toLowerCase();
  for (const kind of ["self", "touch", "sight", "unlimited"] as const) if (words.includes(kind)) return kind;
  return null;
}

/** The SRD's shape: a distance in feet carries its unit and the printed text; Self and Touch carry only the text,
 *  which the spell card prints. */
export function withRange(draft: Draft, kind: RangeKind, distance: number | null): Draft {
  const range: Range =
    kind === "feet"
      ? { distance: distance ?? 60, unit: "feet", text: `${distance ?? 60} feet` }
      : kind === "miles"
        ? {
            distance: distance ?? 1,
            unit: "miles",
            text: `${distance ?? 1} ${(distance ?? 1) === 1 ? "mile" : "miles"}`
          }
        : { distance: null, unit: null, text: title(kind) };
  return { ...draft, range };
}

/* ----------------------------------------------------------------------- healing ---- */

export type Healing = Readonly<{ formula: string; addsModifier: boolean }>;

export const healingOf = (draft: Draft): Healing | null =>
  healingOfText(typeof draft.description === "string" ? draft.description : "");

const sentences = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence.trim() !== "");

/** The sentence the SRD heals with, in the form `healingOfText` reads. */
export const healingSentence = (healing: Healing, touch: boolean): string =>
  `${touch ? "A creature you touch" : "A creature you choose within range"} regains ${
    healing.addsModifier
      ? `a number of Hit Points equal to ${healing.formula} plus your spellcasting ability modifier`
      : `${healing.formula} Hit Points`
  }.`;

/** The description with its healing sentence replaced, added, or taken out (null). */
export function withHealing(draft: Draft, healing: Healing | null): Draft {
  const description = typeof draft.description === "string" ? draft.description : "";
  const kept = sentences(description).filter((sentence) => healingOfText(sentence) === null);
  const next = healing ? [...kept, healingSentence(healing, rangeKindOf(draft) === "touch")] : kept;
  return { ...draft, description: next.join(" ") };
}

/* -------------------------------------------------------------------------- area ---- */

type Shape = Readonly<{ type?: string; size?: number | null }>;

/** How the SRD names an area, in the words `areaOfProse` reads: "20-foot-radius Sphere", "60-foot Cone". */
export function areaPhrase(draft: Draft): string | null {
  const shape = draft.shape as Shape | null | undefined;
  if (!shape?.type || typeof shape.size !== "number" || shape.size <= 0) return null;
  switch (shape.type) {
    case "sphere":
      return `${shape.size}-foot-radius Sphere`;
    case "cylinder":
      return `${shape.size}-foot-radius, 40-foot-high Cylinder`;
    case "cone":
      return `${shape.size}-foot Cone`;
    case "cube":
      return `${shape.size}-foot Cube`;
    case "line":
      return `${shape.size}-foot-long, 5-foot-wide Line`;
    default:
      return null;
  }
}

/** Whether the text names the area the answers give, so the map can draw its template. */
export function textNamesArea(draft: Draft): boolean {
  const phrase = areaPhrase(draft);
  if (!phrase) return true;
  const fromText = areaOfProse(typeof draft.description === "string" ? draft.description : "");
  const fromAnswer = areaOfProse(phrase);
  return !!fromText && !!fromAnswer && fromText.shape === fromAnswer.shape && fromText.sizeFeet === fromAnswer.sizeFeet;
}

/* ----------------------------------------------------------------------- scaling ---- */

type CastingOption = Readonly<{
  type: string;
  damageRoll: string | null;
  targetCount: number | null;
  description: string | null;
}>;

const optionsOf = (draft: Draft): readonly CastingOption[] =>
  Array.isArray(draft.castingOptions) ? (draft.castingOptions as CastingOption[]) : [];

/** The dice a spell rolls when it is cast: its damage, or the healing its text names. */
export const baseRollOf = (draft: Draft): string | null => {
  const roll = (draft.damage as { roll?: string | null } | undefined)?.roll;
  if (typeof roll === "string" && roll.trim() !== "") return roll.trim();
  return healingOf(draft)?.formula ?? null;
};

const DICE = /^(\d+)d(\d+)$/i;

/** `count` more dice of the increment's size added to the formula: "8d6" plus 2 x "1d6" is "10d6". A formula with
 *  no die of that size gets them as a new term. Null when the increment is not plain dice. */
export function addDice(formula: string, increment: string, times: number): string | null {
  const step = DICE.exec(increment.trim());
  if (!step) return null;
  const count = Number(step[1]) * times;
  const sides = step[2];
  const terms = formula.split(/\s*\+\s*/);
  const at = terms.findIndex((term) => new RegExp(`^\\d+d${sides}$`, "i").test(term.trim()));
  if (at === -1) return `${formula} + ${count}d${sides}`;
  const held = Number(DICE.exec(terms[at].trim())![1]);
  return terms.map((term, index) => (index === at ? `${held + count}d${sides}` : term.trim())).join(" + ");
}

export type Scaling = Readonly<{
  /** Dice added for each slot level above the spell's own ("1d6"), for a leveled spell. */
  perSlot: string | null;
  /** More creatures for each slot level above (Hold Person's one more). */
  targetsPerSlot: number | null;
  /** A cantrip's damage dice grow at character levels 5, 11 and 17, as every SRD damage cantrip's do. */
  cantripTiers: boolean;
}>;

/** What the upcast rows say, read back as the answers that would write them. */
export function scalingOf(draft: Draft): Scaling {
  const level = typeof draft.level === "number" ? draft.level : 1;
  const options = optionsOf(draft);
  const base = baseRollOf(draft);
  const next = options.find((option) => option.type === `slot_level_${level + 1}`);
  let perSlot: string | null = null;
  if (next?.damageRoll && base) {
    const baseTerm = DICE.exec(base.split(/\s*\+\s*/)[0].trim());
    const nextTerm = DICE.exec(next.damageRoll.split(/\s*\+\s*/)[0].trim());
    if (baseTerm && nextTerm && baseTerm[2] === nextTerm[2] && Number(nextTerm[1]) > Number(baseTerm[1]))
      perSlot = `${Number(nextTerm[1]) - Number(baseTerm[1])}d${baseTerm[2]}`;
  }
  const baseTargets = (draft.target as { count?: number | null } | undefined)?.count ?? 1;
  const targetsPerSlot =
    typeof next?.targetCount === "number" && next.targetCount > baseTargets ? next.targetCount - baseTargets : null;
  return {
    perSlot,
    targetsPerSlot,
    cantripTiers: level === 0 && options.some((option) => option.type === "player_level_5")
  };
}

const healsOnly = (draft: Draft) =>
  healingOf(draft) !== null && !(draft.damage as { roll?: string | null } | undefined)?.roll;

/** The upcast rows the answers give: `slot_level_N` above a leveled spell's own level, or a damage cantrip's
 *  `player_level_5/11/17`. */
export function scalingRows(draft: Draft, scaling: Scaling): CastingOption[] {
  const level = typeof draft.level === "number" ? draft.level : 1;
  const base = baseRollOf(draft);
  const baseTargets = (draft.target as { count?: number | null } | undefined)?.count ?? 1;
  const rows: CastingOption[] = [];
  if (level === 0) {
    if (!scaling.cantripTiers || !base) return rows;
    const die = base.split(/\s*\+\s*/)[0];
    [5, 11, 17].forEach((characterLevel, index) =>
      rows.push({
        type: `player_level_${characterLevel}`,
        damageRoll: addDice(base, die, index + 1),
        targetCount: null,
        description: null
      })
    );
    return rows;
  }
  for (let slot = level + 1; slot <= 9; slot += 1) {
    const above = slot - level;
    const roll = scaling.perSlot && base ? addDice(base, scaling.perSlot, above) : null;
    const targets = scaling.targetsPerSlot ? baseTargets + scaling.targetsPerSlot * above : null;
    if (roll === null && targets === null) continue;
    rows.push({ type: `slot_level_${slot}`, damageRoll: roll, targetCount: targets, description: null });
  }
  return rows;
}

/** "The damage increases by 1d6 for each spell slot level above 3.", in the SRD's wording; null for none. */
export function scalingText(draft: Draft, scaling: Scaling): string | null {
  const level = typeof draft.level === "number" ? draft.level : 1;
  const base = baseRollOf(draft);
  const what = healsOnly(draft) ? "healing" : "damage";
  const out: string[] = [];
  if (level === 0) {
    const rows = scalingRows(draft, scaling);
    if (rows.length === 3 && base)
      out.push(
        `The ${what} increases by ${base.split(/\s*\+\s*/)[0]} when you reach levels 5 (${rows[0].damageRoll}), 11 (${rows[1].damageRoll}), and 17 (${rows[2].damageRoll}).`
      );
  } else {
    const above = String(level);
    if (scaling.perSlot && base)
      out.push(`The ${what} increases by ${scaling.perSlot} for each spell slot level above ${above}.`);
    if (scaling.targetsPerSlot)
      out.push(
        `You can target ${scaling.targetsPerSlot === 1 ? "one additional creature" : `${scaling.targetsPerSlot} additional creatures`} for each spell slot level above ${above}.`
      );
  }
  return out.length > 0 ? out.join(" ") : null;
}

/** The record with the upcast rows the answers give. "At Higher Levels" follows them unless the GM has written
 *  their own; `from` is the record the current prose was written for. */
export function withScaling(draft: Draft, scaling: Scaling, from: Draft = draft): Draft {
  const held = typeof draft.higherLevel === "string" ? draft.higherLevel : null;
  const generated = held === null || held.trim() === "" || held === scalingText(from, scalingOf(from));
  return {
    ...draft,
    castingOptions: scalingRows(draft, scaling),
    higherLevel: generated ? scalingText(draft, scaling) : held
  };
}

/** An edit to the level or the dice, carried through to the upcast rows when the wizard wrote them. Rows it did not
 *  write (an SRD spell's, duplicated) are left exactly as they were. */
export function rescaled(before: Draft, after: Draft): Draft {
  const scaling = scalingOf(before);
  const ours = JSON.stringify(scalingRows(before, scaling)) === JSON.stringify(optionsOf(before));
  return ours ? withScaling(after, scaling, before) : after;
}

/* -------------------------------------------------------------------------- text ---- */

type Save = Readonly<{
  ability?: string;
  successDamage?: "half" | "none";
  failureConditions?: readonly string[];
  repeatSave?: boolean;
  endsOnDamage?: boolean;
}>;

/**
 * A description in the SRD's own sentence shapes, from the answers: how the spell reaches its target, what a hit or a
 * failed save does, the area as the map reads it, and the healing as the sheet reads it. A starting point the GM edits;
 * nothing is read from it that the answers do not already hold.
 */
export function spellTextFor(draft: Draft): string {
  const roll = (draft.damage as { roll?: string | null } | undefined)?.roll?.trim() || null;
  const types = ((draft.damage as { types?: string[] } | undefined)?.types ?? []).map(title);
  const typeWords = types.length > 0 ? `${listWords(types)} damage` : "damage";
  const save = draft.save as Save | null | undefined;
  const area = areaPhrase(draft);
  const kind = rangeKindOf(draft);
  const targetType = (draft.target as { type?: string | null } | undefined)?.type ?? "creature";
  const count = (draft.target as { count?: number | null } | undefined)?.count ?? 1;
  const conditions = (save?.failureConditions ?? []).map(title);
  const healing = healingOf(draft);
  const out: string[] = [];

  const who = area
    ? `each creature in a ${area}${kind === "self" ? " originating from you" : " centered on a point you choose within range"}`
    : kind === "touch"
      ? "a creature you touch"
      : targetType === "self"
        ? "you"
        : count > 1
          ? `up to ${count === 2 ? "two" : count === 3 ? "three" : count} creatures you can see within range`
          : "one creature you can see within range";

  if (draft.attackRoll === true) {
    const melee = kind === "touch" || kind === "self";
    out.push(`Make a ${melee ? "melee" : "ranged"} spell attack against the target.`);
    if (roll) out.push(`On a hit, the target takes ${roll} ${typeWords}.`);
  } else if (save?.ability) {
    const ability = ABILITY_WORDS[save.ability] ?? title(save.ability);
    const subject = who.charAt(0).toUpperCase() + who.slice(1);
    out.push(`${subject} ${area || count > 1 ? "makes" : "must make"} a ${ability} saving throw.`);
    const failure = [
      roll ? `takes ${roll} ${typeWords}` : null,
      conditions.length > 0 ? `has the ${listWords(conditions)} condition${conditions.length > 1 ? "s" : ""}` : null
    ].filter(Boolean);
    if (failure.length > 0) out.push(`On a failed save, a target ${failure.join(" and ")}.`);
    if (roll)
      out.push(
        save.successDamage === "none"
          ? "On a successful save, a target takes no damage."
          : "On a successful save, a target takes half as much damage."
      );
    if (save.repeatSave)
      out.push(
        "At the end of each of its turns, an affected target repeats the save, ending the effect on itself on a success."
      );
    if (save.endsOnDamage) out.push("The effect ends early on a target that takes any damage.");
  } else if (roll) {
    out.push(`${who.charAt(0).toUpperCase() + who.slice(1)} takes ${roll} ${typeWords}.`);
  }

  if (healing) out.push(healingSentence(healing, kind === "touch"));
  return out.join(" ");
}
