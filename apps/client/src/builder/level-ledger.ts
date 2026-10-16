import type { ActorDefinition, CharacterChoice } from "@vtt/schemas";
import { ABILITIES, type Ability } from "@vtt/rules-5e";
import type { BuilderAbilityMethod, BuilderOffersReply, BuilderPolicy } from "@vtt/domain";
import { abilityBonusesOf, emptyDraft, type BuilderDraft } from "./build-payload";
import type { BuilderCatalogs } from "../content/catalogs";

/**
 * Reads a character back into the wizard for a rebuild (level up or down, respec) from the
 * choice-provenance ledger. The table reads the ledger back onto the offers (`builder:offers` with
 * `choices`); this turns that answer into a draft. The ability method, base scores and background increase
 * come from the ledger's `ability-scores` row; a sheet built before that row existed falls back to the sheet
 * minus the bonuses the ledger explains. Hit points re-send the recorded rolls; see `hpPlan`.
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

/**
 * The wizard draft for a rebuild at `targetLevel`, from the table's reading of the character's ledger at
 * that level: its answers by offer, and the base scores the sheet's totals imply.
 */
export function draftFromLedger(
  identity: LedgerIdentity,
  choices: readonly CharacterChoice[],
  definition: ActorDefinition,
  catalogs: BuilderCatalogs,
  targetLevel: number,
  policy: BuilderPolicy,
  read: BuilderOffersReply
): BuilderDraft {
  // Recorded rolls are re-sent verbatim so a level-down/level-up round trip restores the same max HP.
  const hp = hpPlan(choices, targetLevel);
  const recorded = recordedAbilities(choices);
  const draft: BuilderDraft = {
    ...emptyDraft(),
    speciesId: identity.speciesId,
    backgroundId: identity.backgroundId,
    classId: identity.classId,
    subclassId: read.subclassId,
    level: targetLevel,
    name: definition.name,
    abilityMethod: recorded?.method ?? methodFor(policy),
    backgroundBonus: recorded?.backgroundBonus ?? [],
    hpMode: hp.mode,
    hpEntries: hp.mode === "entries" ? hp.entries : [],
    picks: read.picks,
    asiIncreases: read.asiIncreases
  };

  // Ability scores last: the recorded base scores, or for an older sheet the sheet score minus the bonuses the
  // picks above explain (an ASI is a pick).
  const bonuses = recorded ? null : abilityBonusesOf(draft, catalogs, read.offers);
  const pool: Array<{ id: string; value: number }> = [];
  const poolAssignment: Record<string, string | null> = {};
  const spendScores: Record<string, number> = {};
  for (const [index, ability] of ABILITIES.entries()) {
    const base = recorded
      ? recorded.base[ability]
      : Math.max(1, (definition.abilityScores[ability] ?? 10) - bonuses![ability]);
    pool.push({ id: `lv-${index}`, value: base });
    poolAssignment[ability] = `lv-${index}`;
    spendScores[ability] = base;
  }
  return { ...draft, abilityPool: pool, poolAssignment, spendScores };
}

/** The ledger's record of how the scores were made, or null for a sheet built before it was kept. Mirrors the
 *  server's `storedAbilityScores`. */
export function recordedAbilities(choices: readonly CharacterChoice[]): Readonly<{
  method: BuilderAbilityMethod;
  base: Readonly<Record<Ability, number>>;
  backgroundBonus: BuilderDraft["backgroundBonus"];
}> | null {
  const row = choices.find((entry) => entry.kind === "ability-scores");
  const payload = row?.payload as
    { baseScores?: Record<string, unknown>; backgroundBonusAllocation?: unknown } | undefined;
  const base = payload?.baseScores;
  if (!row || !base || !ABILITIES.every((ability) => typeof base[ability] === "number")) return null;
  if (!(METHODS as readonly string[]).includes(row.id)) return null;
  const allocation = Array.isArray(payload?.backgroundBonusAllocation) ? payload.backgroundBonusAllocation : [];
  return {
    method: row.id as BuilderAbilityMethod,
    base: Object.fromEntries(ABILITIES.map((ability) => [ability, base[ability] as number])) as Record<Ability, number>,
    backgroundBonus: allocation.flatMap((entry: { ability?: unknown; amount?: unknown }) =>
      ABILITIES.includes(entry?.ability as Ability) && typeof entry?.amount === "number"
        ? [{ ability: entry.ability as Ability, amount: entry.amount }]
        : []
    )
  };
}

const METHODS: readonly BuilderAbilityMethod[] = ["standard-array", "point-buy", "roll", "custom"];

/**
 * How a rebuild's hit points are sent: a rolled sheet asks the table to roll, which reuses every recorded roll
 * and throws only the levels that have none (a new level); a sheet that took the average keeps it.
 */
export function hpPlan(
  choices: readonly CharacterChoice[],
  _targetLevel: number
): Readonly<{ mode: "entries"; entries: number[] } | { mode: "roll" | "average" }> {
  return choices.some((row) => row.kind === "hp-roll") ? { mode: "roll" } : { mode: "average" };
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

/** The levels the table will roll hit points for on a rebuild: those with no recorded roll, when the sheet was
 *  rolled. Null when nothing is rolled (all recorded, or the average was taken). */
export function hpRollGap(choices: readonly CharacterChoice[], targetLevel: number): readonly number[] | null {
  if (hpPlan(choices, targetLevel).mode !== "roll") return null;
  const missing: number[] = [];
  for (let level = 2; level <= targetLevel; level += 1)
    if (!choices.some((row) => row.kind === "hp-roll" && row.level === level)) missing.push(level);
  return missing.length > 0 ? missing : null;
}

/** Every ledger decision above `level`: what levelling down gives up. */
export function choicesAbove(choices: readonly CharacterChoice[], level: number): readonly CharacterChoice[] {
  return choices.filter((row) => row.level > level);
}
