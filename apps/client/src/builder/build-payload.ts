import type {
  BuilderAbilityMethod,
  BuilderOffer,
  BuilderOffersReply,
  BuilderOffersRequest,
  BuilderOfferStep,
  BuilderPolicy,
  ContentBackgroundSummary,
  ContentClassSummary,
  ContentFeatSummary,
  ContentSpeciesSummary,
  ContentSubclassSummary
} from "@vtt/domain";
import type { CharacterChoice } from "@vtt/schemas";
import {
  ABILITIES,
  ABILITY_ROLL_FORMULA,
  abilityModifier,
  hitDieFaces,
  isPointBuyLegal,
  pointBuyRemaining,
  POINT_BUY_BUDGET,
  POINT_BUY_MAXIMUM,
  POINT_BUY_MINIMUM,
  STANDARD_ARRAY,
  validateAbilityFormula,
  type Ability,
  type HitDie
} from "@vtt/rules-5e";
import type { BuilderCatalogs } from "../content/catalogs";

/**
 * The character builder's draft model and payload assembly (pure, no React, no socket).
 *
 * The wizard collects choices, never a finished sheet. What the content asks a build to pick, and the
 * ledger rows the answers make, come from the server (`builder:offers`), worked out by the same survey
 * `character.create` validates against. This module keeps the draft, asks for and adopts those offers,
 * and gates each step. The few numbers computed here (ability totals, point-buy budget) are previews of
 * the player's inputs; the server's win.
 */

export const BUILDER_DRAFT_VERSION = 1;

export type PickMap = Readonly<Record<string, readonly string[]>>;

/** The in-progress build; `draft.ts` persists exactly this shape. */
export type BuilderDraft = {
  version: number;
  speciesId: string | null;
  backgroundId: string | null;
  classId: string | null;
  level: number;
  /** Mirrors the `subclass` offer's pick; sent as the payload's top-level `subclassId`. */
  subclassId: string | null;
  abilityMethod: BuilderAbilityMethod;
  /** assign-mode: the six generated values, in draw order. */
  abilityPool: ReadonlyArray<{ id: string; value: number }>;
  /** assign-mode: ability -> pool entry id. */
  poolAssignment: Readonly<Record<string, string | null>>;
  /** spend-mode (point buy): the base score per ability. */
  spendScores: Readonly<Record<string, number>>;
  backgroundBonus: ReadonlyArray<{ ability: Ability; amount: number }>;
  hpMode: "average" | "entries";
  /** One roll per level 2..level, in level order. */
  hpEntries: readonly number[];
  /** offer key -> chosen option ids (order preserved; one entry per pick). */
  picks: PickMap;
  /** offer key -> the ASI shorthand's +2 split, when that offer took the ability route. */
  asiIncreases: Readonly<Record<string, ReadonlyArray<{ ability: Ability; amount: number }>>>;
  name: string;
};

export function emptyDraft(): BuilderDraft {
  return {
    version: BUILDER_DRAFT_VERSION,
    speciesId: null,
    backgroundId: null,
    classId: null,
    level: 1,
    subclassId: null,
    abilityMethod: "standard-array",
    abilityPool: STANDARD_ARRAY.map((value, index) => ({ id: `sa-${index}`, value })),
    poolAssignment: {},
    spendScores: Object.fromEntries(ABILITIES.map((ability) => [ability, POINT_BUY_MINIMUM])),
    backgroundBonus: [],
    hpMode: "average",
    hpEntries: [],
    picks: {},
    asiIncreases: {},
    name: ""
  };
}

// Offers: what the content asks this build to pick, as the server works it out.

/** The offers read for a draft: the identity so far and every answer by offer key. */
export function offersRequestOf(draft: BuilderDraft): BuilderOffersRequest {
  return {
    ...(draft.speciesId ? { speciesId: draft.speciesId } : {}),
    ...(draft.backgroundId ? { backgroundId: draft.backgroundId } : {}),
    ...(draft.classId ? { classId: draft.classId } : {}),
    level: draft.level,
    picks: draft.picks,
    asiIncreases: draft.asiIncreases
  };
}

/** The draft with the answers the server kept: a pick the build no longer offers is gone, and the subclass
 *  is the subclass offer's answer. The same object when nothing changed, so it is safe from an effect. */
export function withAnswersFrom(draft: BuilderDraft, reply: BuilderOffersReply): BuilderDraft {
  const same =
    sameAnswers(draft.picks, reply.picks) &&
    sameAnswers(draft.asiIncreases, reply.asiIncreases) &&
    draft.subclassId === reply.subclassId;
  return same
    ? draft
    : { ...draft, picks: reply.picks, asiIncreases: reply.asiIncreases, subclassId: reply.subclassId };
}

const sameAnswers = (left: Readonly<Record<string, unknown>>, right: Readonly<Record<string, unknown>>) => {
  const keyed = (answers: Readonly<Record<string, unknown>>) =>
    JSON.stringify(
      Object.keys(answers)
        .sort()
        .map((key) => [key, answers[key]])
    );
  return keyed(left) === keyed(right);
};

/** The catalog records the draft names, for the step bodies and the detail pane. */
export type OfferContext = Readonly<{
  species: ContentSpeciesSummary | null;
  background: ContentBackgroundSummary | null;
  classRecord: ContentClassSummary | null;
  subclass: ContentSubclassSummary | null;
  originFeat: ContentFeatSummary | null;
  hitDie: HitDie | null;
}>;

export function offerContext(draft: BuilderDraft, catalogs: BuilderCatalogs): OfferContext {
  const species = catalogs.choice.species.find((entry) => entry.id === draft.speciesId) ?? null;
  const background = catalogs.backgrounds.find((entry) => entry.id === draft.backgroundId) ?? null;
  const classRecord = catalogs.choice.classes.find((entry) => entry.id === draft.classId) ?? null;
  const subclass = catalogs.choice.subclasses.find((entry) => entry.id === draft.subclassId) ?? null;
  const originFeat = background?.originFeatId
    ? (catalogs.choice.feats.find((entry) => entry.id === background.originFeatId) ?? null)
    : null;
  return {
    species,
    background,
    classRecord,
    subclass,
    originFeat,
    hitDie: (classRecord?.hitDie as HitDie | undefined) ?? null
  };
}

/** The offer kinds answered by a feat, whose grids show each feat's summary. */
export const FEAT_KINDS: ReadonlySet<string> = new Set(["feat", "fighting-style", "asi-or-feat"]);

export const titleize = (id: string) =>
  id
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** What to call one of these picks in an instruction. */
const kindNoun = (kind: string) =>
  // `expertise` options are skills, so name them as such.
  kind === "skill" || kind === "expertise"
    ? "skill"
    : kind === "tool"
      ? "tool"
      : kind === "language"
        ? "language"
        : "option";

/** The built-in "raise two points instead of taking a feat" row id the server understands. */
export const ASI_SHORTHAND = "asi";

/** An offer is satisfied when exactly filled, or deferred because its catalog is empty. */
export function offerFilled(offer: BuilderOffer, draft: BuilderDraft): boolean {
  if (offer.unresolvable !== null) return true;
  const picks = draft.picks[offer.key] ?? [];
  if (picks.length !== offer.capacity) return false;
  // The ASI route also needs its +2 spelled out, or the server rejects the row.
  if (offer.kind === "asi-or-feat" && picks[0] === ASI_SHORTHAND) {
    const increases = draft.asiIncreases[offer.key] ?? [];
    return increases.reduce((total, entry) => total + entry.amount, 0) === 2;
  }
  return true;
}

// Ability scores

export const ABILITY_LABELS: Readonly<Record<Ability, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

/** Assign-mode methods hand out a fixed pool; point buy spends against a budget. */
export const isAssignMethod = (method: BuilderAbilityMethod) => method !== "point-buy";

/** Base scores before any bonus. `null` where the player has not assigned a value yet. */
export function baseScoresOf(draft: BuilderDraft): Record<Ability, number | null> {
  const scores = {} as Record<Ability, number | null>;
  for (const ability of ABILITIES) {
    if (isAssignMethod(draft.abilityMethod)) {
      const poolId = draft.poolAssignment[ability] ?? null;
      scores[ability] = draft.abilityPool.find((entry) => entry.id === poolId)?.value ?? null;
    } else {
      scores[ability] = draft.spendScores[ability] ?? POINT_BUY_MINIMUM;
    }
  }
  return scores;
}

/**
 * The bonuses the client can see: the background spread, the species' printed increases, and the
 * player's own ability picks (ASI split, feat `ability-score` picks). Riders that raise scores stay
 * server-side, so this is a preview; the server's total is what lands on the sheet.
 */
export function abilityBonusesOf(
  draft: BuilderDraft,
  catalogs: BuilderCatalogs,
  offers: readonly BuilderOffer[]
): Record<Ability, number> {
  const bonuses = Object.fromEntries(ABILITIES.map((ability) => [ability, 0])) as Record<Ability, number>;
  for (const entry of draft.backgroundBonus) bonuses[entry.ability] += entry.amount;
  const species = catalogs.choice.species.find((entry) => entry.id === draft.speciesId);
  for (const bonus of species?.abilityBonuses ?? []) {
    if (ABILITIES.includes(bonus.ability as Ability)) bonuses[bonus.ability as Ability] += bonus.amount;
  }
  for (const offer of offers) {
    if (offer.kind === "asi-or-feat") {
      for (const increase of draft.asiIncreases[offer.key] ?? []) {
        if ((draft.picks[offer.key] ?? [])[0] === ASI_SHORTHAND) bonuses[increase.ability] += increase.amount;
      }
    }
    if (offer.kind === "ability-score") {
      for (const pick of draft.picks[offer.key] ?? []) {
        if (ABILITIES.includes(pick as Ability)) bonuses[pick as Ability] += 1;
      }
    }
  }
  return bonuses;
}

/** A finished score may not pass this; the server rejects it. */
export const ABILITY_SCORE_CAP = 20;

export type AbilityCapBreach = Readonly<{
  ability: Ability;
  total: number;
  /** The ASI offer whose increase broke the ceiling; null when the background's own spread did. */
  offerKey: string | null;
  /** Said in the player's words, naming the ability and both ways out. */
  reason: string;
}>;

export type AbilityCapPreview = Readonly<{
  breach: AbilityCapBreach | null;
  /** Per ASI offer key: the running scores just before that offer's increases, so it can show what
      each ability would reach. Empty until every base score is assigned. */
  before: ReadonlyMap<string, Readonly<Record<Ability, number>>>;
}>;

/**
 * Walks the ability scores in the server's order and reports the first increase past 20. An input
 * check, not a game outcome: the background spread and each ASI row reject above 20, while species
 * increases and feat `ability-score` picks clamp. The server recomputes all of it.
 */
export function abilityCapPreview(
  draft: BuilderDraft,
  catalogs: BuilderCatalogs,
  offers: readonly BuilderOffer[]
): AbilityCapPreview {
  const before = new Map<string, Record<Ability, number>>();
  const base = baseScoresOf(draft);
  if (ABILITIES.some((ability) => base[ability] == null)) return { breach: null, before };
  const scores = Object.fromEntries(ABILITIES.map((ability) => [ability, base[ability]!])) as Record<Ability, number>;

  let breach: AbilityCapBreach | null = null;
  const overflowed = (ability: Ability, offerKey: string | null, fix: string) => {
    if (scores[ability] <= ABILITY_SCORE_CAP || breach) return;
    breach = {
      ability,
      total: scores[ability],
      offerKey,
      reason: `${ABILITY_LABELS[ability]} would be ${scores[ability]} — no ability may go above ${ABILITY_SCORE_CAP}. ${fix}`
    };
  };

  const background = catalogs.backgrounds.find((entry) => entry.id === draft.backgroundId) ?? null;
  for (const entry of draft.backgroundBonus) {
    scores[entry.ability] += entry.amount;
    overflowed(
      entry.ability,
      null,
      `Move ${background ? `${background.name}'s` : "the background's"} increase, or lower ${ABILITY_LABELS[entry.ability]}.`
    );
  }
  const species = catalogs.choice.species.find((entry) => entry.id === draft.speciesId);
  for (const bonus of species?.abilityBonuses ?? []) {
    if (ABILITIES.includes(bonus.ability as Ability)) {
      const ability = bonus.ability as Ability;
      scores[ability] = Math.min(ABILITY_SCORE_CAP, scores[ability] + bonus.amount);
    }
  }
  for (const offer of offers) {
    if (offer.kind !== "asi-or-feat") continue;
    before.set(offer.key, { ...scores });
    if ((draft.picks[offer.key] ?? [])[0] !== ASI_SHORTHAND) continue;
    for (const increase of draft.asiIncreases[offer.key] ?? []) {
      scores[increase.ability] += increase.amount;
      overflowed(
        increase.ability,
        offer.key,
        `Change the level ${offer.level} improvement, or lower ${ABILITY_LABELS[increase.ability]}.`
      );
    }
  }
  return { breach, before };
}

export function pointBuySpent(draft: BuilderDraft): number {
  const values = ABILITIES.map((ability) => draft.spendScores[ability] ?? POINT_BUY_MINIMUM);
  const legal = values.every((value) => value >= POINT_BUY_MINIMUM && value <= POINT_BUY_MAXIMUM);
  return legal ? POINT_BUY_BUDGET - pointBuyRemaining(values, POINT_BUY_BUDGET) : POINT_BUY_BUDGET + 1;
}

// The submitted payload

export type CharacterCreatePayload = Readonly<{
  name: string;
  speciesId: string;
  backgroundId: string;
  classId: string;
  level: number;
  subclassId?: string;
  abilityMethod: BuilderAbilityMethod;
  baseScores: Record<Ability, number>;
  backgroundBonusAllocation: ReadonlyArray<{ ability: Ability; amount: number }>;
  hp: { mode: "average" | "entries"; entries?: readonly number[] };
  choices: readonly CharacterChoice[];
}>;

/** The `character.create` body, minus the caller's `commandId`; `choices` are the ledger rows the server
    made from the draft's answers. Throws only on a draft the step gating should already have blocked. */
export function buildCreatePayload(draft: BuilderDraft, choices: readonly CharacterChoice[]): CharacterCreatePayload {
  const base = baseScoresOf(draft);
  const scores = {} as Record<Ability, number>;
  for (const ability of ABILITIES) {
    const value = base[ability];
    if (value == null) throw new Error(`${ABILITY_LABELS[ability]} has no score yet.`);
    scores[ability] = value;
  }
  if (!draft.speciesId || !draft.backgroundId || !draft.classId)
    throw new Error("Species, background, and class are all required.");
  return {
    name: draft.name.trim(),
    speciesId: draft.speciesId,
    backgroundId: draft.backgroundId,
    classId: draft.classId,
    level: draft.level,
    ...(draft.subclassId ? { subclassId: draft.subclassId } : {}),
    abilityMethod: draft.abilityMethod,
    baseScores: scores,
    backgroundBonusAllocation: draft.backgroundBonus,
    hp: draft.hpMode === "average" ? { mode: "average" } : { mode: "entries", entries: draft.hpEntries },
    choices
  };
}

// Roster capacity: the table stores at most 100 sheets and 200 combatants (`actor-roster.ts`), so
// the wizard warns as it fills and blocks once full, rather than failing at Create.

export const DEFINITION_LIMIT = 100;
export const ACTOR_LIMIT = 200;
/** Warn from here on, so the GM can prune before the wizard stops them. */
const CAPACITY_WARNING_FRACTION = 0.8;

export type RosterCapacity = Readonly<{
  definitions: number;
  actors: number;
  /** Set once a create cannot land; shown as the review step's blocked reason. */
  blockedReason: string | null;
  /** Set from 80% of either limit: there is room, but not much. */
  warning: string | null;
}>;

export function rosterCapacity(definitions: number, actors: number): RosterCapacity {
  const line = `Sheet library ${definitions} of ${DEFINITION_LIMIT}; roster ${actors} of ${ACTOR_LIMIT}.`;
  if (definitions >= DEFINITION_LIMIT || actors >= ACTOR_LIMIT) {
    return {
      definitions,
      actors,
      warning: null,
      blockedReason: `${line} Remove a character or combatant you no longer need, then create this one.`
    };
  }
  const near =
    definitions >= DEFINITION_LIMIT * CAPACITY_WARNING_FRACTION || actors >= ACTOR_LIMIT * CAPACITY_WARNING_FRACTION;
  return {
    definitions,
    actors,
    blockedReason: null,
    warning: near ? `${line} Remove characters you no longer need to keep room for new ones.` : null
  };
}

// Per-step gating: every blocked Next says why.

export const STEP_IDS = ["species", "background", "class", "features", "abilities", "equipment", "review"] as const;
export type StepId = (typeof STEP_IDS)[number];
export const STEP_LABELS: Readonly<Record<StepId, string>> = {
  species: "Species",
  background: "Background",
  class: "Class & level",
  features: "Class features",
  abilities: "Ability scores",
  equipment: "Equipment",
  review: "Name & review"
};
/** The phone rail's names: shorter only where nothing is lost. The level control lives on the
    class step, so it stays "Class & level". */
export const STEP_SHORT: Readonly<Record<StepId, string>> = {
  species: "Species",
  background: "Background",
  class: "Class & level",
  features: "Features",
  abilities: "Abilities",
  equipment: "Equipment",
  review: "Review"
};

const offersForStep = (offers: readonly BuilderOffer[], step: BuilderOfferStep) =>
  offers.filter((offer) => offer.step === step);

/** The first unmet requirement of a step, phrased as an instruction, or null when the step is done. */
export function stepBlockedReason(
  step: StepId,
  draft: BuilderDraft,
  catalogs: BuilderCatalogs,
  offers: readonly BuilderOffer[],
  policy: BuilderPolicy
): string | null {
  const context = offerContext(draft, catalogs);
  const unfilled = (owner: BuilderOfferStep) =>
    offersForStep(offers, owner).find((offer) => !offerFilled(offer, draft));
  /**
   * One template for "this pick is not answered yet". The label is printed as the content prints it,
   * unquoted, matching the heading it points at.
   */
  const pickReason = (offer: BuilderOffer) => {
    // Offers on one step can share a label (six "Ability Score Improvement"s), so stamp the level
    // only when the label alone is ambiguous.
    const ambiguous = offersForStep(offers, offer.step).filter((sibling) => sibling.label === offer.label).length > 1;
    const named = ambiguous ? `level ${offer.level} ${offer.label}` : offer.label;
    const chosen = (draft.picks[offer.key] ?? []).length;
    if (offer.kind === "asi-or-feat" && chosen === offer.capacity)
      return `Split the +2 from ${named} across your abilities.`;
    return offer.capacity === 1
      ? `Choose your ${named} to continue.`
      : `Choose ${offer.capacity} for ${named} to continue — ${chosen} of ${offer.capacity} so far.`;
  };
  /**
   * A pick already held from another source. Options are not filtered, so a pick made before the
   * collision (e.g. the background changed later) survives and must be reported.
   */
  const heldConflict = (owner: BuilderOfferStep) => {
    for (const offer of offersForStep(offers, owner)) {
      if (!offer.unavailable) continue;
      for (const id of draft.picks[offer.key] ?? []) {
        const held = offer.unavailable[id];
        if (!held) continue;
        const name = offer.options.find((option) => option.id === id)?.name ?? titleize(id);
        return `"${name}" is ${held} — pick a different ${kindNoun(offer.kind)}.`;
      }
    }
    return null;
  };

  switch (step) {
    case "species": {
      if (!draft.speciesId) return "Choose a species to continue.";
      const conflict = heldConflict("species");
      if (conflict) return conflict;
      const offer = unfilled("species");
      return offer ? pickReason(offer) : null;
    }
    case "background": {
      if (!draft.backgroundId) return "Choose a background to continue.";
      const conflict = heldConflict("background");
      if (conflict) return conflict;
      const offer = unfilled("background");
      return offer ? pickReason(offer) : null;
    }
    case "class": {
      if (!draft.classId) return "Choose a class to continue.";
      const conflict = heldConflict("class");
      if (conflict) return conflict;
      const offer = unfilled("class");
      return offer ? pickReason(offer) : null;
    }
    case "features": {
      if (!draft.classId) return "Choose a class first.";
      const classRecord = context.classRecord;
      // A class with no subclass content yet has an empty subclass offer; say that first, since nothing
      // on screen could satisfy it.
      if (classRecord && draft.level >= classRecord.subclassLevel && !draft.subclassId) {
        const subclassOffer = offers.find((offer) => offer.kind === "subclass");
        if (!subclassOffer || subclassOffer.options.length === 0) {
          const escape =
            classRecord.subclassLevel > 1 ? ` Drop to level ${classRecord.subclassLevel - 1} to continue.` : "";
          return `No ${classRecord.name} subclasses are available yet — a level ${classRecord.subclassLevel} ${classRecord.name} must have one.${escape}`;
        }
      }
      const conflict = heldConflict("features");
      if (conflict) return conflict;
      const offer = unfilled("features");
      // Name the subclass only when it is the first unmet requirement.
      if (offer)
        return offer.kind === "subclass"
          ? `Choose a ${classRecord?.subclassLabel ?? "subclass"} to continue.`
          : pickReason(offer);
      // An ASI past 20 is chosen here but only visible once scores exist, so both steps guard the cap
      // with the same sentence.
      const breach = abilityCapPreview(draft, catalogs, offers).breach;
      return breach && breach.offerKey !== null ? breach.reason : null;
    }
    case "abilities": {
      if (!policy.allowedAbilityMethods.includes(draft.abilityMethod))
        return "Your GM does not allow that ability method — pick another.";
      const base = baseScoresOf(draft);
      const missing = ABILITIES.filter((ability) => base[ability] == null);
      if (missing.length > 0) return `Assign a score to ${ABILITY_LABELS[missing[0]]} to continue.`;
      if (draft.abilityMethod === "point-buy" && !isPointBuyLegal(ABILITIES.map((ability) => base[ability]!))) {
        return "That spread is over the 27-point budget — lower a score to continue.";
      }
      if (draft.abilityMethod === "standard-array") {
        const sorted = ABILITIES.map((ability) => base[ability]!)
          .sort((left, right) => right - left)
          .join(",");
        if (sorted !== [...STANDARD_ARRAY].join(","))
          return `Use each standard-array value once (${STANDARD_ARRAY.join(", ")}).`;
      }
      // Rolled or GM-formula scores are typed by the player, and the server bound-checks them against
      // the formula, so the step checks the same bounds.
      if (draft.abilityMethod === "roll" || draft.abilityMethod === "custom") {
        const formula =
          draft.abilityMethod === "custom" ? (policy.customFormula ?? ABILITY_ROLL_FORMULA) : ABILITY_ROLL_FORMULA;
        const check = validateAbilityFormula(formula);
        if (check.ok) {
          const outside = ABILITIES.find((ability) => base[ability]! < check.minimum || base[ability]! > check.maximum);
          if (outside)
            return `A ${formula} roll produces ${check.minimum}-${check.maximum} — ${ABILITY_LABELS[outside]} ${base[outside]} is outside that. Re-roll it or correct the value.`;
        }
      }
      const options = context.background?.abilityOptions ?? null;
      if (options) {
        const total = draft.backgroundBonus.reduce((sum, entry) => sum + entry.amount, 0);
        if (total === 0) return `Spend ${context.background!.name}'s ability increases to continue.`;
        const spread = [...draft.backgroundBonus.map((entry) => entry.amount)]
          .sort((left, right) => right - left)
          .join("/");
        if (!options.spreads.some((legal) => [...legal].sort((left, right) => right - left).join("/") === spread)) {
          return `${context.background!.name} allows ${options.spreads.map((legal) => `+${legal.join("/+")}`).join(" or ")} — adjust the split.`;
        }
        if (new Set(draft.backgroundBonus.map((entry) => entry.ability)).size !== draft.backgroundBonus.length) {
          return "Each background increase must go to a different ability.";
        }
      }
      // The 20 cap, checked on the step that owns the scores (the features step guards the improvements).
      const breach = abilityCapPreview(draft, catalogs, offers).breach;
      if (breach) return breach.reason;
      if (draft.hpMode === "entries") {
        const needed = draft.level - 1;
        const faces = context.hitDie ? hitDieFaces(context.hitDie) : 12;
        if (draft.hpEntries.length !== needed)
          return `Enter your hit-point roll for level ${draft.hpEntries.length + 2} (${needed - draft.hpEntries.length} to go).`;
        if (draft.hpEntries.some((entry) => entry < 1 || entry > faces))
          return `A ${context.hitDie} roll is 1-${faces} — fix the out-of-range entry.`;
      }
      return null;
    }
    case "equipment": {
      const offer = unfilled("equipment");
      return offer ? pickReason(offer) : null;
    }
    case "review": {
      if (draft.name.trim().length === 0) return "Name your character to create them.";
      for (const id of STEP_IDS) {
        if (id === "review") continue;
        const reason = stepBlockedReason(id, draft, catalogs, offers, policy);
        if (reason) return `${STEP_LABELS[id]} is not finished: ${reason}`;
      }
      return null;
    }
    default:
      return null;
  }
}

/** Preview only: the modifier the allocator shows beside a total. */
export const previewModifier = (total: number | null) => (total == null ? null : abilityModifier(total));
