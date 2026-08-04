import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { ABILITIES, type Ability } from "@vtt/rules-5e";
import type { BuilderAbilityMethod, BuilderPolicy } from "@vtt/domain";
import { ASI_SHORTHAND, abilityBonusesOf, computeOffers, emptyDraft, type BuilderDraft, type BuilderOffer } from "./build-payload";
import type { BuilderCatalogs } from "../content/catalogs";

/**
 * **Reading a character back into the wizard (D13/D14).**
 *
 * A level-up is a rebuild, and a rebuild needs the same inputs a create needed. The durable record of
 * those inputs is the **choice-provenance ledger** on the stored definition
 * (`definition.character.choices`, `@vtt/schemas`) — written for exactly this purpose: "level-up and
 * respec are impossible to prefill without it".
 *
 * What the ledger holds, and what it does not, decides the honesty of this surface:
 *  - identity (species, background, class, subclass, level), every PICK, and — since the rebuild work
 *    — the per-level HP ROLLS (`kind: "hp-roll"`, one row per level from 2 up): recorded, so restored;
 *  - the ability-score METHOD: not stored by any build. Ability scores are therefore re-derived from
 *    the sheet (final scores minus the bonuses the ledger explains) rather than guessed at.
 *
 * A character built BEFORE hp-roll rows existed has some or none of them, and the server's rule for
 * that is explicit: an incomplete set rebuilds on the AVERAGE and no dice are invented to hide it
 * (`storedHitPointRolls`, character-build.ts). `hpRolls`/`hpRollGap` below are the client's half of
 * that same rule — the same answer, said to the player before they commit rather than after.
 *
 * A sheet with NO ledger at all (a PDF import, a pre-wizard character) is a different case again, and
 * `ledgerOf` returning null is how the flow knows to say so instead of guessing.
 */

/** The ledger, or null when this sheet carries no provenance at all (absent ≠ empty — see the schema). */
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

/** The identity a rebuild has to re-send, read off the stored sheet. Null when it is not all there. */
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

/** Ledger rows that belong at or below `level` — everything a character of that level still owns. */
const rowsUpTo = (choices: readonly CharacterChoice[], level: number) => choices.filter((row) => row.level <= level);

/**
 * Does this ledger row answer this offer? Offers carry (level, kind, classId, featureId); rows carry
 * the same four, which is exactly why the ledger is shaped the way it is. Matching on the tuple rather
 * than on `offer.key` keeps this independent of how keys are minted.
 */
const rowAnswers = (row: CharacterChoice, offer: BuilderOffer) =>
  row.level === offer.level &&
  row.kind === offer.kind &&
  (row.classId ?? null) === offer.classId &&
  ((row.payload?.featureId as string | undefined) ?? null) === offer.featureId;

/**
 * Rebuild a wizard draft from a character's ledger at a target level.
 *
 * The loop is not decoration: a pick can CREATE the next offer (choosing a subclass is what asks for
 * the subclass's own choices), so offers are recomputed until the set stops growing. Four passes is
 * more than any published class needs and bounds a content bug rather than trusting one.
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
    // Recorded rolls are re-sent verbatim, so a level-down/level-up round trip restores the same
    // maximum. Without this the rebuild would quietly re-roll the character onto the average.
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

  // Ability scores last: the bonuses depend on the picks above (an ASI at level 4 is a pick), so the
  // base scores can only be recovered once they are in. Final sheet score minus explained bonus.
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
 * Which ability method a rebuild may claim.
 *
 * The scores are not being re-rolled — they are the character's existing scores, re-sent so the server
 * can reassemble the sheet. So the method has to be one the table ALLOWS whose validation those scores
 * satisfy, and "roll"/"custom" bound-check against the formula's range (3-18 for 4d6kh3) rather than
 * demanding an exact array or a 27-point spread. Preferring those is not a loophole: it is the only
 * answer that does not fail a character whose scores were legally made under a method the GM has since
 * turned off. Where the table allows neither, the strict methods are tried in turn and the server has
 * the last word — a rejection with its own message, shown on the review step.
 */
export function methodFor(policy: BuilderPolicy): BuilderAbilityMethod {
  const allowed = policy.allowedAbilityMethods;
  if (allowed.includes("roll")) return "roll";
  if (allowed.includes("custom") && policy.customFormula) return "custom";
  if (allowed.includes("point-buy")) return "point-buy";
  return allowed[0] ?? "standard-array";
}

/**
 * The recorded rolls for levels 2..level, or null when ANY of them is missing — the client's copy of
 * the server's `storedHitPointRolls` rule, deliberately identical so the two cannot disagree about
 * whether a rebuild keeps its hit points.
 */
export function hpRolls(choices: readonly CharacterChoice[], level: number): number[] | null {
  const rolls: number[] = [];
  for (let candidate = 2; candidate <= level; candidate += 1) {
    const roll = choices.find((row) => row.kind === "hp-roll" && row.level === candidate)?.payload?.roll;
    if (typeof roll !== "number" || !Number.isInteger(roll) || roll < 1) return null;
    rolls.push(roll);
  }
  return rolls;
}

/**
 * Which levels a ROLLED-HP character has no recorded roll for (D14's honesty clause).
 *
 * Three cases, and only the third is a notice. No hp-roll rows at all = the character took the
 * average and has nothing to be told. A complete set = nothing missing. A PARTIAL set = a character
 * built before rolls were recorded, and the rebuild will use the average for the whole run: the
 * player is told which levels that covers, and no dice are invented.
 */
export function hpRollGap(choices: readonly CharacterChoice[], targetLevel: number): Readonly<{ from: number; to: number }> | null {
  const recorded = choices.filter((row) => row.kind === "hp-roll");
  if (recorded.length === 0) return null;
  if (hpRolls(choices, targetLevel)) return null;
  return { from: 2, to: Math.max(2, targetLevel) };
}

/**
 * What leveling DOWN gives up: every ledger decision stamped above the target level, named.
 *
 * Deliberately read from the ledger rather than from the class's feature list — the ledger is what the
 * rebuild will drop, so this is a preview of the actual change rather than a parallel guess at it.
 */
export function choicesAbove(choices: readonly CharacterChoice[], level: number): readonly CharacterChoice[] {
  return choices.filter((row) => row.level > level);
}
