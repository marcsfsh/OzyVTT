import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { ABILITIES, type Ability } from "@vtt/rules-5e";
import type { BuilderAbilityMethod, BuilderPolicy } from "@vtt/domain";
import { ASI_SHORTHAND, abilityBonusesOf, computeOffers, emptyDraft, type BuilderDraft, type BuilderOffer } from "./build-payload";
import type { BuilderCatalogs } from "../content/catalogs";

/**
 * Reads a character back into the wizard for a rebuild (level up or down, respec) from the
 * choice-provenance ledger. The ability method is not stored, so base scores are the sheet minus the
 * bonuses the ledger explains. Older characters may lack some hp-roll rows; see `hpRollGap`.
 */

/** The ledger, or null when this sheet carries no provenance (absent differs from empty). */
export function ledgerOf(definition: ActorDefinition | null | undefined): readonly CharacterChoice[] | null {
  const choices = definition?.character?.choices;
  return choices ?? null;
}

export type LedgerIdentity = Readonly<{
  speciesId: string;
  backgroundId: string;
  classId: string;
  subclassId: string | null;
  level: number;
}>;

/** The identity a rebuild must re-send, read off the stored sheet; null when incomplete. */
export function identityOf(definition: ActorDefinition | null | undefined): LedgerIdentity | null {
  const character = definition?.character;
  const primary = character?.classes?.[0];
  if (!character || !primary || !character.race || !character.background) return null;
  return {
    speciesId: character.race.id,
    backgroundId: character.background.id,
    classId: primary.id,
    subclassId: primary.subclass?.id ?? null,
    level: character.classes.reduce((total, entry) => total + entry.level, 0)
  };
}

/** Ledger rows at or below `level`: everything a character of that level still owns. */
const rowsUpTo = (choices: readonly CharacterChoice[], level: number) => choices.filter((row) => row.level <= level);

/** Whether a ledger row answers an offer, matched on its fields rather than `offer.key`. */
const rowAnswers = (row: CharacterChoice, offer: BuilderOffer) =>
  row.level === offer.level &&
  row.kind === offer.kind &&
  (row.classId ?? null) === offer.classId &&
  ((row.payload?.featureId as string | undefined) ?? null) === offer.featureId;

/**
 * Rebuilds a wizard draft from a character's ledger at a target level. A pick can create the next
 * offer (a subclass asks for its own choices), so offers are recomputed until the set stops
 * growing; four passes bounds a content bug.
 */
export function draftFromLedger(
  identity: LedgerIdentity,
  choices: readonly CharacterChoice[],
  definition: ActorDefinition,
  catalogs: BuilderCatalogs,
  targetLevel: number,
  policy: BuilderPolicy
): BuilderDraft {
  const rows = rowsUpTo(choices, targetLevel);
  let draft: BuilderDraft = {
    ...emptyDraft(),
    speciesId: identity.speciesId,
    backgroundId: identity.backgroundId,
    classId: identity.classId,
    subclassId: identity.subclassId,
    level: targetLevel,
    name: definition.name,
    abilityMethod: methodFor(policy),
    // Recorded rolls are re-sent verbatim so a level-down/level-up round trip restores the same max HP.
    ...(hpRolls(choices, targetLevel) ? { hpMode: "entries" as const, hpEntries: hpRolls(choices, targetLevel)! } : { hpMode: "average" as const, hpEntries: [] })
  };

  for (let pass = 0; pass < 4; pass += 1) {
    const offers = computeOffers(draft, catalogs);
    const picks: Record<string, readonly string[]> = {};
    const asiIncreases: Record<string, ReadonlyArray<{ ability: Ability; amount: number }>> = {};
    for (const offer of offers) {
      const matched = rows.filter((row) => rowAnswers(row, offer)).slice(0, offer.capacity);
      if (matched.length === 0) continue;
      picks[offer.key] = matched.map((row) => row.id);
      const asi = matched.find((row) => row.id === ASI_SHORTHAND);
      const increases = asi?.payload?.increases as ReadonlyArray<{ ability: Ability; amount: number }> | undefined;
      if (increases) asiIncreases[offer.key] = increases;
    }
    const next: BuilderDraft = { ...draft, picks, asiIncreases };
    if (JSON.stringify(next.picks) === JSON.stringify(draft.picks) && pass > 0) { draft = next; break; }
    draft = next;
  }

  // Ability scores last: bonuses depend on the picks above (an ASI is a pick). Base = sheet score
  // minus explained bonus.
  const bonuses = abilityBonusesOf(draft, catalogs, computeOffers(draft, catalogs));
  const pool: Array<{ id: string; value: number }> = [];
  const poolAssignment: Record<string, string | null> = {};
  const spendScores: Record<string, number> = {};
  for (const [index, ability] of ABILITIES.entries()) {
    const base = Math.max(1, (definition.abilityScores[ability] ?? 10) - bonuses[ability]);
    pool.push({ id: `lv-${index}`, value: base });
    poolAssignment[ability] = `lv-${index}`;
    spendScores[ability] = base;
  }
  return { ...draft, abilityPool: pool, poolAssignment, spendScores };
}

/**
 * The ability method a rebuild claims. Scores are re-sent, not re-rolled, so "roll"/"custom" (bound
 * checks only) are preferred; otherwise the server has the last word.
 */
export function methodFor(policy: BuilderPolicy): BuilderAbilityMethod {
  const allowed = policy.allowedAbilityMethods;
  if (allowed.includes("roll")) return "roll";
  if (allowed.includes("custom") && policy.customFormula) return "custom";
  if (allowed.includes("point-buy")) return "point-buy";
  return allowed[0] ?? "standard-array";
}

/** Recorded rolls for levels 2..level, or null if any is missing. Must match the server's `storedHitPointRolls`. */
export function hpRolls(choices: readonly CharacterChoice[], level: number): number[] | null {
  const rolls: number[] = [];
  for (let candidate = 2; candidate <= level; candidate += 1) {
    const roll = choices.find((row) => row.kind === "hp-roll" && row.level === candidate)?.payload?.roll;
    if (typeof roll !== "number" || !Number.isInteger(roll) || roll < 1) return null;
    rolls.push(roll);
  }
  return rolls;
}

/** The levels missing an hp roll; reported only for a partial set (none means the average was taken). */
export function hpRollGap(choices: readonly CharacterChoice[], targetLevel: number): Readonly<{ from: number; to: number }> | null {
  const recorded = choices.filter((row) => row.kind === "hp-roll");
  if (recorded.length === 0) return null;
  if (hpRolls(choices, targetLevel)) return null;
  return { from: 2, to: Math.max(2, targetLevel) };
}

/** Every ledger decision above `level`: what levelling down gives up. */
export function choicesAbove(choices: readonly CharacterChoice[], level: number): readonly CharacterChoice[] {
  return choices.filter((row) => row.level > level);
}
