import type { AbilityId, Actor, DamageApplication, GameState, PendingSave } from "@vtt/domain";
import {
  abilityModifier as scoreModifier,
  aggregateRollMode,
  collectRiders,
  d20TestFormula,
  diceRiders,
  diceRiderTerms,
  halveDamageParts,
  otherDiceOf,
  parseDiceFormula,
  rescaleDamageParts,
  resolveDice,
  sumRiders,
  type AggregatedRollMode,
  type DiceResolution,
  type RandomSource
} from "@vtt/rules-5e";
import type { ActorDefinition, DamageDrain, ForcedPush } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { withoutSameHazard } from "./hazards.js";
import { recordRoll as recordRollInHistory, rolledTerms } from "./roll-history.js";
import { requireGm, type Initiator } from "./authorization.js";
import { holdsFeature } from "./class-features.js";
import { d20MinimumOf, totalMinimumOf } from "./ability-checks.js";
import { holdRoll, releaseHeldRoll, rollHeldTest } from "./held-rolls.js";
import { AURA_IMMUNE_TAG, auraOfAuthority, traitActionId } from "./statblock-traits.js";
import { applyDamageDetailed, previewDamage, adjustableActor } from "./hit-points.js";
import { holyWardClaim, inPaladinAura, tableHiddenCheck, type AuraContext } from "./paladin-auras.js";
import { setCondition } from "./actor-conditions.js";
import { autoFailsPhysicalSaves, conditionLabel, exhaustionPenalty, isIncapacitated } from "./condition-rules.js";
import {
  addEffect,
  CONCENTRATING_TAG,
  effectDurationOf,
  endConcentrationSustainedBy,
  endConditionsImmuneTo,
  endEffectIfPresent,
  endIdleConcentration,
  makeEffect,
  sourceOf,
  type ConditionImmunitySource,
  type EffectNarration
} from "./effects.js";
import {
  deriveEquipment,
  rollModeClaims,
  type EquipmentCatalog,
  type EquipmentDerivation,
  type RollModeClaims
} from "./equipment-derivation.js";
import { countZoneDamage } from "./spell-zone-state.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { suppressConditions } from "./suppressed-conditions.js";
import { sizeAtMost, sizeRank } from "./resolution/context.js";

export type SaveAnswerDependencies = Readonly<{
  random: RandomSource;
  newRollId: () => string;
  sessionId: string;
  role: "gm" | "player";
  now: () => string;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The item catalog, so an item's save bonus and save advantage reach the roll. */
  catalog?: EquipmentCatalog;
  /** Creature-to-creature distance, for the strike-back reaction the save's damage may open. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  /** Moves a token straight away from another on the live map (a failure's push); null when the map can't. */
  pushToken?: (
    input: Readonly<{ actorId: string; awayFromActorId: string; distanceFeet: number }>
  ) => Readonly<{ value: number; unit: string }> | null;
}>;
export type SaveOutcome = Readonly<{
  success: boolean;
  total: number;
  dc: number;
  /** The d20 that counted; absent when no die was rolled (an automatic failure, the GM's typed total). */
  natural?: number;
  appliedDamage: number;
  conditionApplied: boolean;
  committed: boolean;
  /** Typed breakdown of the damage this save applied, so the table sees why it changed; absent when none landed. */
  parts?: DamageApplication["parts"];
  flatReduction?: number;
  /** The condition that forced an automatic failure (Paralyzed etc. on a Str/Dex save); null when the die was rolled. */
  autoFailed?: string | null;
  /** The trait that made it succeed without a roll (Greater Magic Resistance against a spell). */
  autoSucceeded?: string;
  /** Advantage/disadvantage sources that shaped the rolled save (Restrained, Dodge); absent for a plain d20. */
  rollMode?: AggregatedRollMode;
}>;

/** Advantage/disadvantage sources for a save: Restrained gives disadvantage on DEX saves (SRD), and every
 *  carrier's `roll-mode` riders (Dodge, Rage, items), narrowed by `ability-is`, and by `versus-condition` against
 *  the conditions the save would impose or end (`stakes`: Antitoxin's Poisoned). A concentration check also
 *  collects `roll: "concentration"`. Mirrors attackRollSources. */
export function saveRollSources(
  target: Actor,
  ability: AbilityId,
  derivation: EquipmentDerivation,
  concentration = false,
  stakes: readonly string[] = [],
  sourceCreatureType: string | null = null
): RollModeClaims {
  const claims: RollModeClaims = { advantage: [], disadvantage: [] };
  if (ability === "dex" && target.conditions.some((condition) => condition.id === "restrained")) {
    claims.disadvantage.push({ source: "target-restrained", label: "Restrained (Dex saves)" });
  }
  return rollModeClaims(
    derivation,
    concentration ? ["save", "concentration"] : ["save"],
    "on-saving-throw",
    {
      ability,
      ...(stakes.length > 0 ? { targetConditionIds: stakes } : {}),
      // The creature whose effect forces the save, for a rider against its kind (Protection from Evil and Good).
      ...(sourceCreatureType !== null ? { sourceCreatureType } : {})
    },
    claims
  );
}

/**
 * A save's total once its riders' floors apply: a d20 under a `d20-minimum` counts as it, and a total under a
 * `total-minimum` counts as that ability score (Indomitable Might's Strength). With the carrier that raised it, or
 * null when nothing did.
 */
export function flooredSaveTotal(
  derivation: EquipmentDerivation,
  definition: ActorDefinition | undefined,
  ability: AbilityId,
  natural: number,
  total: number
): Readonly<{ total: number; raisedBy: string | null }> {
  const riders = [
    ...collectRiders(derivation.carriers, { ...derivation.context, moment: null }),
    ...collectRiders(derivation.carriers, { ...derivation.context, ability, moment: "on-saving-throw" })
  ];
  const floor = d20MinimumOf(riders, "save", true);
  const raised = floor !== null && natural < floor.face ? total + floor.face - natural : total;
  const lifted = totalMinimumOf(riders, "save", definition);
  if (lifted !== null && lifted.total > raised) return { total: lifted.total, raisedBy: lifted.label };
  return { total: raised, raisedBy: raised > total ? floor!.label : null };
}

/** The creature type of the creature whose effect forces a save, for riders against its kind; null when unknown. */
function sourceCreatureTypeOf(
  state: GameState,
  sourceActorId: string | null,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): string | null {
  const source = sourceActorId === null ? undefined : state.actors.find((actor) => actor.id === sourceActorId);
  if (!source) return null;
  return creatureTypeOf(source, source.definitionId ? resolveDefinition(source.definitionId) : undefined);
}

/** The conditions a pending save is about: what its failure imposes, or what the effect it would end holds. */
function conditionsAtStake(state: GameState, pending: PendingSave): string[] {
  const ending = pending.repeatOf
    ? (state.actors
        .find((actor) => actor.id === pending.repeatOf!.actorId)
        ?.effects.find((effect) => effect.id === pending.repeatOf!.effectId)?.linkedConditionIds ?? [])
    : [];
  return [...new Set([...pending.conditionIds, ...(pending.onFailEffect?.linkedConditionIds ?? []), ...ending])];
}

/** The flat rider bonus to one saving throw: standing plus momentary. */
export function saveRiderBonus(derivation: EquipmentDerivation, ability: AbilityId): number {
  const momentary = collectRiders(derivation.carriers, { ...derivation.context, ability, moment: "on-saving-throw" });
  // `derivation.saveBonus` is the summed standing half; only momentary riders are added here.
  return derivation.saveBonus + sumRiders(momentary, "save-bonus");
}

/** The dice riders add to one saving throw (Bless +1d4, Bane -1d4), standing or at the save, as formula terms. */
export function saveRiderDiceTerms(derivation: EquipmentDerivation, ability: AbilityId): string {
  const standing = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  const atSave = collectRiders(derivation.carriers, { ...derivation.context, ability, moment: "on-saving-throw" });
  return diceRiderTerms(diceRiders([...standing, ...atSave], "save-bonus"));
}

/** The flat rider bonus to a saving throw that names no ability, such as a death save: riders that apply to
 *  every save (Ring of Protection) and none tied to one ability. */
export function saveRiderBonusForAnySave(derivation: EquipmentDerivation): number {
  const momentary = collectRiders(derivation.carriers, { ...derivation.context, moment: "on-saving-throw" });
  return derivation.saveBonus + sumRiders(momentary, "save-bonus");
}

/** The dice riders add to a saving throw that names no ability, such as a death save (Bless's d4). */
export function saveRiderDiceTermsForAnySave(derivation: EquipmentDerivation): string {
  const standing = collectRiders(derivation.carriers, { ...derivation.context, moment: null });
  const atSave = collectRiders(derivation.carriers, { ...derivation.context, moment: "on-saving-throw" });
  return diceRiderTerms(diceRiders([...standing, ...atSave], "save-bonus"));
}

/** Advantage and Disadvantage on a saving throw that names no ability (a death save): riders on every save, and those
 *  on Death Saving Throws alone (Beacon of Hope). */
export function anySaveRollSources(derivation: EquipmentDerivation): RollModeClaims {
  return rollModeClaims(derivation, ["save", "death-save"], "on-saving-throw");
}

export type { AuraContext };

/** A Paladin's own Aura of Protection bonus: its Charisma modifier, at least +1, while it holds the feature and isn't
 *  Incapacitated ("The aura is inactive while you have the Incapacitated condition"); null otherwise. */
export function auraBonusOf(paladin: Actor, definition: ActorDefinition | undefined): number | null {
  if (isIncapacitated(paladin) || !holdsFeature(definition, "aura-of-protection", "Aura of Protection")) return null;
  return Math.max(1, scoreModifier(definition?.abilityScores.cha ?? 10));
}

/**
 * SRD Aura of Protection: "You and your allies in the aura gain a bonus to saving throws equal to your Charisma
 * modifier (minimum bonus of +1)", in a 10-foot Emanation (30 feet with Aura Expansion). A creature benefits from one
 * aura at a time, so the best counts. A Paladin hidden from the table (the shared check: GM-only, out of every
 * character's sight or under the fog) never shows its aura on a visible creature's save, which would reveal it.
 */
export function auraOfProtection(
  state: GameState,
  target: Actor,
  context: AuraContext
): Readonly<{ amount: number; source: string }> | null {
  let best: { amount: number; source: string } | null = null;
  const hidden = tableHiddenCheck(state, context);
  for (const paladin of state.actors) {
    // Only a Paladin with the aura is asked about, so a table with none builds no sight.
    const definition = paladin.definitionId ? context.resolveDefinition(paladin.definitionId) : undefined;
    const amount = auraBonusOf(paladin, definition);
    if (amount === null || !inPaladinAura(state, paladin, definition, target, context, hidden)) continue;
    if (!best || amount > best.amount)
      best = {
        amount,
        source: paladin.id === target.id ? "Aura of Protection" : `${paladin.name}'s Aura of Protection`
      };
  }
  return best;
}

const ABILITIES: readonly AbilityId[] = ["str", "dex", "con", "int", "wis", "cha"];

/** Save modifier without situational terms. Precedence: GM-typed `saveOverrides`, the sheet's
 *  `proficiencies.saves`, the open5e extension's monster totals, then the bare ability modifier. */
export function saveModifierFor(definition: ActorDefinition | undefined, ability: AbilityId): number {
  if (!definition) return 0;
  const proficiencies = definition.proficiencies;
  const override = proficiencies?.saveOverrides?.[ability];
  if (typeof override === "number") return override;
  // A sheet that records proficiencies is authoritative: an ability absent from `saves` is not proficient.
  if (proficiencies) {
    return (
      scoreModifier(definition.abilityScores[ability]) +
      (proficiencies.saves.includes(ability) ? definition.proficiencyBonus : 0)
    );
  }
  const extension = definition.extensions["open5e.srd-2024"];
  if (extension && typeof extension === "object") {
    const fromExtension = (extension as { savingThrows?: Record<string, unknown> }).savingThrows?.[ability];
    if (
      typeof fromExtension === "number" &&
      Number.isInteger(fromExtension) &&
      fromExtension >= -20 &&
      fromExtension <= 30
    )
      return fromExtension;
  }
  return scoreModifier(definition.abilityScores[ability]);
}

/** Stat-block traits that give every save Advantage: the berserker's Bloodied Frenzy ("While Bloodied, ... Advantage on
 *  attack rolls and saving throws") and an allied hobgoblin captain's Aura of Authority within 10 feet. */
function traitSaveClaims(
  state: GameState,
  target: Actor,
  definition: ActorDefinition | undefined,
  deps: Pick<SaveAnswerDependencies, "resolveDefinition" | "distanceFeet" | "catalog">
): Array<{ source: string; label: string }> {
  const bloodied = target.hp.current > 0 && target.hp.current * 2 <= target.hp.maximum;
  const authority = auraOfAuthority(state, target, deps);
  return [
    ...(bloodied && holdsFeature(definition, "bloodied-frenzy", "Bloodied Frenzy")
      ? [{ source: "bloodied-frenzy", label: "Bloodied Frenzy (Bloodied)" }]
      : []),
    ...(authority ? [authority] : [])
  ];
}

/** SRD Magic Resistance: "Advantage on saving throws against spells and other magical effects"; Greater Magic
 *  Resistance (the rakshasa's) "automatically succeeds" on them. Read from the stat block's trait by its name. */
export function magicResistanceOf(definition: ActorDefinition | undefined): "advantage" | "succeeds" | null {
  if (holdsFeature(definition, "greater-magic-resistance", "Greater Magic Resistance")) return "succeeds";
  if (holdsFeature(definition, "magic-resistance", "Magic Resistance")) return "advantage";
  return null;
}

/** Proficiency bonus when an item grants this save's proficiency and the sheet lacks it. */
function saveProficiencyFromItems(
  definition: ActorDefinition | undefined,
  derivation: EquipmentDerivation,
  ability: AbilityId
): number {
  if (!definition) return 0;
  if (!derivation.saves.some((entry) => entry.id === ability)) return 0;
  if (definition.proficiencies?.saves.includes(ability)) return 0;
  return definition.proficiencyBonus;
}

/** The save total shared by the sheet's chip and `answerSave`. Cover is per-save, so not included. */
export function saveTotalFor(
  definition: ActorDefinition | undefined,
  actor: Actor | undefined,
  ability: AbilityId,
  derivation: EquipmentDerivation
): number {
  return (
    saveModifierFor(definition, ability) +
    saveProficiencyFromItems(definition, derivation, ability) +
    (actor ? exhaustionPenalty(actor) : 0) +
    saveRiderBonus(derivation, ability)
  );
}

/**
 * A save the server rolls at once, with no prompt, for a creature's own trait (Undead Fortitude): the same total, riders
 * and Advantage the prompt would use, cover aside. The kept d20 and the total, with what shaped the roll.
 */
export function rollSaveAtOnce(
  state: GameState,
  actor: Actor,
  ability: AbilityId,
  deps: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
    distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
    rollDie: RandomSource;
    /** Against a spell, which Magic Resistance meets with Advantage. */
    magical?: boolean;
  }>
): Readonly<{ natural: number; total: number; rollMode: AggregatedRollMode }> {
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  const modifier =
    saveTotalFor(definition, actor, ability, derivation) + (auraOfProtection(state, actor, deps)?.amount ?? 0);
  const sources = saveRollSources(actor, ability, derivation);
  if (deps.magical === true && magicResistanceOf(definition) !== null)
    sources.advantage.push({ source: "magic-resistance", label: "Magic Resistance" });
  const rollMode = aggregateRollMode(sources.advantage, sources.disadvantage);
  const resolution = resolveDice(
    parseDiceFormula(d20TestFormula(rollMode.mode, modifier) + saveRiderDiceTerms(derivation, ability)),
    deps.rollDie
  );
  const d20 = resolution.terms.find((term) => term.kind === "dice");
  const natural = d20 && d20.kind === "dice" ? (d20.dice.find((die) => die.kept) ?? d20.dice[0])!.face : 0;
  return { natural, total: resolution.total, rollMode };
}

/**
 * Evasion (Rogue 7, Monk 7, and stat blocks that print it, the Assassin's): a held `evasion` class feature, or a
 * trait of that name on the sheet.
 */
export function hasEvasion(definition: ActorDefinition | undefined): boolean {
  return holdsFeature(definition, "evasion", "Evasion");
}

/** Create one pending save per target when a save action resolves. Called inside the action:resolve mutation. */
export function createPendingSaves(
  state: GameState,
  input: Readonly<{
    sourceActorId: string | null;
    sourceName: string;
    actionName: string;
    ability: AbilityId;
    dc: number;
    targetIds: readonly string[];
    proposedDamage: number;
    proposedDamageParts?: ReadonlyArray<{ amount: number; type: string }>;
    halfOnSuccess: boolean;
    conditionIds: readonly string[];
    saveBonus?: number;
    onFailEffect?: Omit<NonNullable<PendingSave["onFailEffect"]>, "modifiers"> &
      Partial<Pick<NonNullable<PendingSave["onFailEffect"]>, "modifiers">>;
    /** A save repeated at the end of the bearer's turn: a success ends this effect. */
    repeatOf?: PendingSave["repeatOf"];
    /** Replace an older prompt with the same (target, actionName, source) key. Default true; per-hit riders
     *  pass false since Extra Attack can owe two saves. */
    replaceExisting?: boolean;
    /** The GM's call for a roll these saves answer. */
    callId?: string;
    /** What else each save carries: what a success leaves, a line for a failure, the spell area that raised it. */
    extra?: Pick<PendingSave, "onSuccessEffect" | "failureNote" | "breaksConcentration" | "zoneId" | "gmApplies">;
    /** Against a spell or a magic item, which Magic Resistance meets with Advantage. */
    magical?: boolean;
    /** A success makes the target immune to this trait of its source for the fight (a ghast's Stench). */
    immuneOnSuccess?: boolean;
    /** What the save's damage drains as it lands (Harm's lower Hit Point maximum). */
    drain?: DamageDrain;
    /** Where a failure pushes the creature (Thunderwave). */
    failurePush?: ForcedPush;
    /** A creature this size or larger has Advantage on the save (Ensnaring Strike). */
    advantageAtSize?: PendingSave["advantageAtSize"];
    newSaveId: () => string;
    createdAt: number;
  }>
) {
  const additions: PendingSave[] = input.targetIds.map((targetActorId) => ({
    id: input.newSaveId(),
    targetActorId,
    ability: input.ability,
    dc: input.dc,
    sourceActorId: input.sourceActorId,
    sourceName: input.sourceName,
    actionName: input.actionName,
    proposedDamage: input.proposedDamage,
    ...(input.proposedDamageParts && input.proposedDamageParts.length > 0
      ? { proposedDamageParts: [...input.proposedDamageParts] }
      : {}),
    halfOnSuccess: input.halfOnSuccess,
    conditionIds: [...input.conditionIds],
    saveBonus: input.saveBonus ?? 0,
    ...(input.onFailEffect
      ? { onFailEffect: { ...input.onFailEffect, modifiers: [...(input.onFailEffect.modifiers ?? [])] } }
      : {}),
    ...(input.repeatOf ? { repeatOf: input.repeatOf } : {}),
    ...(input.callId !== undefined ? { callId: input.callId } : {}),
    ...(input.extra?.onSuccessEffect ? { onSuccessEffect: structuredClone(input.extra.onSuccessEffect) } : {}),
    ...(input.extra?.failureNote ? { failureNote: input.extra.failureNote } : {}),
    ...(input.extra?.breaksConcentration ? { breaksConcentration: true as const } : {}),
    ...(input.extra?.zoneId !== undefined ? { zoneId: input.extra.zoneId } : {}),
    ...(input.extra?.gmApplies ? { gmApplies: true as const } : {}),
    ...(input.magical ? { magical: true as const } : {}),
    ...(input.immuneOnSuccess ? { immuneOnSuccess: true as const } : {}),
    ...(input.drain ? { drain: { ...input.drain } } : {}),
    ...(input.failurePush ? { failurePush: { ...input.failurePush } } : {}),
    ...(input.advantageAtSize ? { advantageAtSize: input.advantageAtSize } : {}),
    createdAt: input.createdAt
  }));
  // A re-cast against the same target replaces its older prompt.
  const remaining =
    input.replaceExisting === false
      ? state.combat.pendingSaves
      : state.combat.pendingSaves.filter(
          (entry) =>
            !additions.some(
              (added) =>
                added.targetActorId === entry.targetActorId &&
                added.actionName === entry.actionName &&
                added.sourceActorId === entry.sourceActorId
            )
        );
  const pendingSaves = [...remaining, ...additions];
  if (pendingSaves.length > 100)
    throw new CommandRejectedError("Too many unanswered saving throws. Resolve or dismiss some first.");
  state.combat = { ...state.combat, pendingSaves };
}

/**
 * Puts a failed save's effect on its target (see `failureEffectFor`). A Concentration cast's effect lands only while
 * the caster still holds that Concentration: one broken before the target answered imposes nothing.
 */
export function applyFailureEffect(
  state: GameState,
  targetId: string,
  onFail: NonNullable<PendingSave["onFailEffect"]>,
  id: string,
  immunities?: ConditionImmunitySource
): EffectNarration[] {
  const target = state.actors.find((candidate) => candidate.id === targetId);
  if (!target) return [];
  if (onFail.castId !== undefined) {
    const holding = state.actors.some((actor) =>
      actor.effects.some((effect) => effect.castId === onFail.castId && effect.tags.includes(CONCENTRATING_TAG))
    );
    if (!holding)
      return [
        {
          kind: "effect",
          text: `${onFail.sourceName ?? "The caster"} is no longer concentrating, so ${target.name} is spared.`,
          actorId: target.id,
          ...sourceOf(onFail)
        }
      ];
  }
  const events: EffectNarration[] = [];
  withoutSameHazard(target, onFail);
  const applied = addEffect(
    state,
    target.id,
    makeEffect({
      id,
      name: onFail.name,
      tags: [...onFail.tags],
      sourceActorId: onFail.sourceActorId,
      sourceName: onFail.sourceName,
      sourceActionId: onFail.sourceActionId ?? null,
      startedRound: state.combat.round,
      // "Until the end of the current turn": the end of this turn.
      duration:
        onFail.currentTurn && onFail.duration?.type === "until-bearer-turn-end"
          ? { type: "until-bearer-turn-end", skipsCurrentTurn: false }
          : effectDurationOf(state, onFail.duration, target.id, onFail.sourceActorId),
      // Saves parked before failures carried their own lifetime were all grapples.
      endsWhenSourceDefeated: onFail.endsWhenSourceDefeated ?? onFail.tags.includes("grapple"),
      concentration: onFail.castId !== undefined,
      linkedConditionIds: [...onFail.linkedConditionIds],
      escapeDc: onFail.escapeDc,
      ...(onFail.repeatSave ? { repeatSave: { ...onFail.repeatSave } } : {}),
      ...(onFail.endsOnDamage ? { endsOnDamage: true } : {}),
      ...(onFail.endsOnSourceSideDamage ? { endsOnSourceSideDamage: true as const } : {}),
      ...(onFail.endsOnSpellHealing ? { endsOnSpellHealing: true as const } : {}),
      ...(onFail.speedZero ? { speedZero: true } : {}),
      ...(onFail.castId !== undefined ? { castId: onFail.castId } : {}),
      ...(onFail.spell ? { spell: { ...onFail.spell } } : {}),
      ...(onFail.rangeFeet !== undefined ? { rangeFeet: onFail.rangeFeet } : {}),
      ...(onFail.ongoingDamage ? { ongoingDamage: onFail.ongoingDamage } : {}),
      ...(onFail.magical ? { magical: true as const } : {}),
      ...(onFail.armorClassBonus !== undefined ? { armorClassBonus: onFail.armorClassBonus } : {}),
      ...(onFail.endAction ? { endAction: { ...onFail.endAction } } : {}),
      ...(onFail.optionId !== undefined ? { optionId: onFail.optionId } : {}),
      ...(onFail.conditionImmunities ? { conditionImmunities: [...onFail.conditionImmunities] } : {}),
      // What it does while it lasts (Bane's -1d4).
      modifiers: [...onFail.modifiers]
    }),
    events,
    immunities
  );
  // Calm Emotions: a Charmed or Frightened it holds off is kept on the effect for later; one it makes the creature
  // immune to and doesn't hold off ends.
  const held = suppressConditions(target, onFail.suppressesConditions ?? []);
  if (held.length > 0) {
    target.effects = target.effects.map((effect) =>
      effect.id === applied.id ? { ...effect, suppressedConditions: held } : effect
    );
    events.push({
      kind: "condition",
      text: `${target.name} is no longer ${held.map((entry) => conditionLabel(entry.id)).join(" or ")} while ${applied.name} lasts.`,
      actorId: target.id
    });
  }
  if (onFail.conditionImmunities)
    events.push(...endConditionsImmuneTo(target, onFail.conditionImmunities, applied.name));
  return [
    { kind: "effect", text: `${target.name} is ${applied.name}.`, actorId: target.id, ...sourceOf(applied) },
    ...events
  ];
}

/**
 * A failure's push (Thunderwave's 10 feet, a dragon's Repulsion Breath "up to 60 feet"), the whole way, straight away
 * from the save's source on the live map. Too big a creature stays put; a map that can't place it asks the GM to move
 * the token.
 */
function pushOnFailure(
  target: GameState["actors"][number],
  pending: PendingSave,
  deps: SaveAnswerDependencies
): EffectNarration[] {
  const push = pending.failurePush!;
  const sourceId = pending.sourceActorId;
  if (sourceId === null || sourceId === target.id) return [];
  if (push.maxTargetSize && !sizeAtMost(target.size, push.maxTargetSize)) return [];
  const moved = deps.pushToken?.({ actorId: target.id, awayFromActorId: sourceId, distanceFeet: push.feet }) ?? null;
  if (moved === null)
    return [
      {
        kind: "effect",
        text: `${target.name} is pushed ${push.feet} feet straight away from ${pending.sourceName}. Move the token.`,
        actorId: target.id,
        gmOnly: true
      }
    ];
  const travelled = Math.round(moved.value * 10) / 10;
  if (travelled <= 0) return [];
  return [
    {
      kind: "effect",
      text: `${target.name} is pushed ${travelled} ${moved.unit} straight away from ${pending.sourceName}.`,
      actorId: target.id,
      source: { actorId: sourceId, name: pending.sourceName }
    }
  ];
}

/** Records a save roll in the shared history, attributed to the creature saving; a hidden creature's stays GM-only. */
export function recordSaveRoll(
  state: GameState,
  resolution: DiceResolution,
  base: Readonly<{
    id: string;
    commandId: string;
    sessionId: string;
    role: "gm" | "player";
    label: string;
    saveLabel: string;
    actorId: string;
    visibility: "public" | "gm-only";
    createdAt: string;
    typed?: boolean;
  }>
) {
  recordRollInHistory(state, {
    id: base.id,
    commandId: base.commandId,
    initiatorSessionId: base.sessionId,
    initiatorRole: base.role,
    initiatorLabel: base.label,
    label: base.saveLabel,
    actorId: base.actorId,
    purpose: "save",
    visibility: base.visibility,
    formula: resolution.expression.source,
    normalizedFormula: resolution.expression.normalized,
    ...rolledTerms(resolution),
    total: resolution.total,
    ...(base.typed ? { typed: true as const } : {}),
    createdAt: base.createdAt
  });
}

/** How a roll card names a mode the GM forced. */
export const GM_CHOICE = "GM's choice";

/** The roll mode a roll card shows: the rules' count with its sources, or the GM's forced choice named as such;
 *  absent for a plain d20. */
export function shownRollMode(
  aggregated: AggregatedRollMode,
  forced: "advantage" | "disadvantage" | "normal" | undefined
): AggregatedRollMode | undefined {
  if (forced === undefined) return aggregated.mode === "normal" ? undefined : aggregated;
  if (forced === "normal") return undefined;
  return {
    mode: forced,
    advantage: forced === "advantage" ? [GM_CHOICE] : [],
    disadvantage: forced === "disadvantage" ? [GM_CHOICE] : []
  };
}

/** How a pending save is answered beyond its method: a typed d20 (`face`), or a reroll of the held die. */
export type SaveAnswerOptions = Readonly<{ face?: number; reroll?: boolean }>;

/** Answers a pending save (a roll, a typed d20, or the GM's typed total) and auto-applies it: fail takes full damage
 *  and the condition; success takes half if the action says so. The structured-save exception to propose-then-apply
 *  (ADR-0008). GM any save; a player only their own character's. A preview holds its die (ADR-0012), so a later
 *  preview or the confirm uses the same one. */
export function answerSave(
  state: GameState,
  commandId: string,
  saveId: string,
  method: "roll" | "manual",
  manualTotal: number | undefined,
  commit: boolean,
  scope: Initiator,
  deps: SaveAnswerDependencies,
  legendaryResistance = false,
  explicitRollMode?: "advantage" | "disadvantage" | "normal",
  damageOverride?: number,
  options: SaveAnswerOptions = {}
): { outcome: SaveOutcome; events: EffectNarration[] } {
  // A save owed outside a fight (a concentration check after a trap) is answered the same way.
  const pending = state.combat.pendingSaves.find((entry) => entry.id === saveId);
  if (!pending) throw new CommandRejectedError("That saving throw was already answered or dismissed.");
  const target = adjustableActor(state, pending.targetActorId, scope);
  if (!ABILITIES.includes(pending.ability)) throw new CommandRejectedError("That saving throw has an unknown ability.");
  // A player's typed damage stands in for dice, so it follows the table's setting for typed dice.
  if (damageOverride !== undefined && scope.role !== "gm" && state.builderPolicy.typedRolls !== "open")
    throw new CommandRejectedError("At this table the server rolls the dice. Ask the GM to change the damage.");
  const heldKey = `save:${saveId}`;

  let total: number;
  let natural: number | null = null;
  let autoFailed: string | null = null;
  let autoSucceeded: string | null = null;
  let rollMode: AggregatedRollMode | undefined;
  /** What raised the roll past its dice (Indomitable Might), named on the table's line. */
  let raisedBy: string | null = null;
  const targetDefinition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
  const magicResistance = pending.magical ? magicResistanceOf(targetDefinition) : null;
  if (method === "manual") {
    // The GM's typed total is a ruling, so it stands as given (a table may rule an exception to an auto-fail). A
    // player types the face their die shows instead, and the server adds the bonus.
    requireGm(scope, "Type the d20 your die shows; the server adds your bonus.");
    if (manualTotal === undefined || !Number.isInteger(manualTotal) || manualTotal < -20 || manualTotal > 60)
      throw new CommandRejectedError("Enter the rolled save total (a whole number from -20 to 60).");
    total = manualTotal;
  } else if ((pending.ability === "str" || pending.ability === "dex") && autoFailsPhysicalSaves(target) !== null) {
    // SRD: Paralyzed/Petrified/Stunned/Unconscious auto-fail Str/Dex saves; no die is rolled, typed or not.
    autoFailed = autoFailsPhysicalSaves(target);
    total = 0;
  } else if (magicResistance === "succeeds") {
    autoSucceeded = "Greater Magic Resistance";
    total = 0;
  } else {
    const definition = targetDefinition;
    const derivation = deriveEquipment(target, definition, deps.catalog);
    // Exhaustion (-2 x level, SRD 5.2.1) and item save bonuses come through `saveTotalFor`, shared with the sheet's
    // chip; cover's per-save bonus and an ally Paladin's aura are added on top.
    const aura = auraOfProtection(state, target, deps)?.amount ?? 0;
    const modifier = saveTotalFor(definition, target, pending.ability, derivation) + pending.saveBonus + aura;
    // A save that ends effects when failed is a concentration check.
    const sources = saveRollSources(
      target,
      pending.ability,
      derivation,
      pending.endsEffects !== undefined,
      conditionsAtStake(state, pending),
      sourceCreatureTypeOf(state, pending.sourceActorId, deps.resolveDefinition)
    );
    if (magicResistance === "advantage")
      sources.advantage.push({ source: "magic-resistance", label: "Magic Resistance" });
    // "A Large or larger creature has Advantage on this save" (Ensnaring Strike).
    if (pending.advantageAtSize && sizeRank(target.size) >= sizeRank(pending.advantageAtSize))
      sources.advantage.push({ source: "size", label: `${pending.actionName}: its size` });
    sources.advantage.push(...traitSaveClaims(state, target, definition, deps));
    const ward = holyWardClaim(state, target, pending.sourceActorId, {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    });
    if (ward) sources.advantage.push(ward);
    const aggregated = aggregateRollMode(sources.advantage, sources.disadvantage);
    // A player's choice is never read: the rules count Advantage and Disadvantage, and only the GM may force a mode.
    const forced = scope.role === "gm" ? explicitRollMode : undefined;
    const mode = forced ?? aggregated.mode;
    // Bless's d4 rolls into the save itself, and is held with its d20s.
    const test = rollHeldTest(
      state,
      heldKey,
      target,
      scope,
      mode,
      modifier,
      saveRiderDiceTerms(derivation, pending.ability),
      options,
      deps.random
    );
    rollMode = test.typed ? undefined : shownRollMode(aggregated, forced);
    natural = test.natural;
    const rollId = deps.newRollId();
    // A second look at held dice records nothing new; the dice already sit in the history.
    if (test.fresh)
      recordSaveRoll(state, test.resolution, {
        id: rollId,
        commandId,
        sessionId: deps.sessionId,
        role: deps.role,
        label: target.name,
        saveLabel: `${pending.ability.toUpperCase()} save`,
        actorId: target.id,
        visibility: target.visibility === "gm-only" ? "gm-only" : "public",
        createdAt: deps.now(),
        typed: test.typed
      });
    if (commit) releaseHeldRoll(state, heldKey);
    else
      holdRoll(state, {
        key: heldKey,
        actorId: target.id,
        faces: test.faces,
        others: otherDiceOf(test.resolution),
        rollId: test.fresh ? rollId : (state.heldRolls.find((entry) => entry.key === heldKey)?.rollId ?? null),
        typed: test.typed
      });
    const floored = flooredSaveTotal(derivation, definition, pending.ability, test.natural, test.resolution.total);
    total = floored.total;
    if (floored.raisedBy !== null) raisedBy = floored.raisedBy;
  }

  let success = autoSucceeded !== null || (autoFailed === null && total >= pending.dc);
  // SRD Legendary Resistance: on a failed save the creature can choose to succeed. The GM commits with
  // the flag; the pool rides actionUses["legendary-resistance"] and a Long Rest re-arms it.
  let legendaryNote: string | null = null;
  if (legendaryResistance) {
    if (!commit) throw new CommandRejectedError("Commit the save to spend Legendary Resistance.");
    requireGm(scope, "Only the GM can spend Legendary Resistance.");
    const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
    const perDay = definition?.legendary?.resistancesPerDay ?? 0;
    if (perDay === 0) throw new CommandRejectedError(`${target.name} has no Legendary Resistance.`);
    const spentSoFar = target.actionUses["legendary-resistance"] ?? 0;
    if (spentSoFar >= perDay)
      throw new CommandRejectedError(`${target.name} has no Legendary Resistance left (0 of ${perDay} remaining).`);
    // A natural success spends nothing.
    if (!success) {
      target.actionUses = { ...target.actionUses, "legendary-resistance": spentSoFar + 1 };
      success = true;
      autoFailed = null;
      legendaryNote = `${target.name} uses Legendary Resistance to succeed (${perDay - spentSoFar - 1} of ${perDay} remaining).`;
    }
  }
  // A hand-entered damage amendment, applied before the success halving. The proposal's damage types
  // are kept (`rescaleDamageParts`) so resistances still apply. Range is bounded by `SaveAnswerSchema`
  // and ownership by `adjustableActor` above.
  const proposedTotal = damageOverride ?? pending.proposedDamage;
  // Typed parts (ADR-0020) halve on success (the total, rounded down once) and run the defense pipeline; older
  // saves fall back to the untyped total.
  const proposed = pending.proposedDamageParts;
  const parts =
    proposed && proposed.length > 0 && damageOverride !== undefined
      ? rescaleDamageParts(proposed, damageOverride)
      : proposed;
  // SRD Evasion: on a Dexterity save for half damage, a success takes none and a failure half.
  const evasion =
    pending.ability === "dex" &&
    pending.halfOnSuccess &&
    !isIncapacitated(target) &&
    hasEvasion(target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined);
  const halved = success !== evasion;
  const outcomeParts =
    parts && parts.length > 0
      ? success && (!pending.halfOnSuccess || evasion)
        ? []
        : halved
          ? halveDamageParts(parts)
          : parts
      : null;
  const outcomeDamage =
    outcomeParts !== null
      ? outcomeParts.reduce((sum, part) => sum + part.amount, 0)
      : success && (!pending.halfOnSuccess || evasion)
        ? 0
        : halved
          ? Math.floor(proposedTotal / 2)
          : proposedTotal;
  const outcomeCondition =
    !success && (pending.conditionIds.length > 0 || (pending.onFailEffect?.linkedConditionIds.length ?? 0) > 0);

  // Preview (commit=false): the roll is recorded so everyone sees it, but nothing is applied and the
  // save stays open until the answerer confirms. The damage is weighed through the target's defences, so the
  // prompt shows what Confirm will land.
  if (!commit) {
    const weighed =
      outcomeDamage > 0
        ? previewDamage(
            state,
            target.id,
            outcomeParts !== null ? { amount: outcomeDamage, parts: outcomeParts } : { amount: outcomeDamage },
            {
              resolveDefinition: (definitionId) => deps.resolveDefinition(definitionId),
              ...(deps.catalog ? { catalog: deps.catalog } : {})
            }
          )
        : null;
    return {
      outcome: {
        success,
        total,
        dc: pending.dc,
        appliedDamage: weighed?.totalApplied ?? 0,
        conditionApplied: outcomeCondition,
        committed: false,
        autoFailed,
        ...(autoSucceeded !== null ? { autoSucceeded } : {}),
        ...(natural !== null ? { natural } : {}),
        ...(rollMode ? { rollMode } : {}),
        ...(weighed && weighed.parts.length > 0 ? { parts: weighed.parts } : {}),
        ...(weighed?.flatReduction ? { flatReduction: weighed.flatReduction } : {})
      },
      events: []
    };
  }

  const events: EffectNarration[] = [];
  if (legendaryNote !== null) events.push({ kind: "effect", text: legendaryNote, actorId: target.id });
  if (autoFailed !== null)
    events.push({
      kind: "condition",
      text: `${target.name} automatically fails the ${pending.ability.toUpperCase()} save (${conditionLabel(autoFailed)}).`,
      actorId: target.id
    });
  if (autoSucceeded !== null)
    events.push({
      kind: "condition",
      text: `${target.name} automatically succeeds on the ${pending.ability.toUpperCase()} save (${autoSucceeded}).`,
      actorId: target.id
    });
  if (raisedBy !== null)
    events.push({
      kind: "condition",
      text: `${target.name}'s ${pending.ability.toUpperCase()} save counts as ${total} (${raisedBy}).`,
      actorId: target.id
    });
  let appliedDamage = 0;
  let application: DamageApplication | null = null;
  let conditionApplied = false;
  if (outcomeDamage > 0) {
    const outcome = applyDamageDetailed(
      state,
      target.id,
      {
        amount: outcomeDamage,
        ...(outcomeParts !== null ? { parts: outcomeParts } : {}),
        sourceActorId: pending.sourceActorId,
        // Harm drains only on a failed save; a Life Drain whose save halves the damage drains either way.
        ...(pending.drain && (!success || pending.drain.failedSaveOnly !== true) ? { drain: pending.drain } : {})
      },
      { role: "gm" },
      {
        resolveDefinition: (definitionId) => deps.resolveDefinition(definitionId),
        newId: deps.newRollId,
        now: deps.now,
        commandId,
        rollDie: deps.random,
        ...(deps.catalog ? { catalog: deps.catalog } : {}),
        ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
      }
    );
    appliedDamage = outcome.application.totalApplied;
    // Keep the whole application along with its total.
    application = outcome.application;
    events.push(...outcome.events);
    // A spell area that stops after so much damage counts it (Guardian of Faith).
    events.push(...countZoneDamage(state, pending.zoneId, appliedDamage, deps.catalog));
  }
  // Where the target stands counts too: a Paladin's aura can ward off what the failure imposes.
  const immunities = {
    resolveDefinition: (definitionId: string) => deps.resolveDefinition(definitionId),
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
  };
  if (outcomeCondition) {
    // What the failure's effect links lands with the effect below; the rest (Prone, Exhaustion) stands alone.
    // setCondition narrates immunity skips; whether any condition landed is read back.
    const linked = new Set(pending.onFailEffect?.linkedConditionIds ?? []);
    for (const conditionId of pending.conditionIds.filter((id) => !linked.has(id)))
      events.push(...setCondition(state, target.id, conditionId, true, undefined, { role: "gm" }, immunities));
  }
  // A committed failed concentration check ends the sustained effects (SRD Concentration); tolerant of
  // effects already gone.
  if (!success && pending.endsEffects) {
    for (const reference of pending.endsEffects)
      events.push(...endEffectIfPresent(state, reference.actorId, reference.effectId));
  }
  // A committed failure applies the declared source-linked effect (a grapple, a timed or Concentration condition).
  if (!success && pending.onFailEffect)
    events.push(
      ...applyFailureEffect(state, target.id, pending.onFailEffect, `${commandId}:${saveId}:fail`, immunities)
    );
  // What a success leaves instead (Heat Metal's Disadvantage on a creature that keeps hold of the object).
  if (success && pending.onSuccessEffect)
    events.push(
      ...applyFailureEffect(state, target.id, pending.onSuccessEffect, `${commandId}:${saveId}:success`, immunities)
    );
  // The note can name the source (Heat Metal's "until the start of the caster's next turn"), so it carries it to be
  // masked when hidden.
  if (!success && pending.failureNote)
    events.push({
      kind: "effect",
      text: pending.failureNote,
      actorId: target.id,
      ...(pending.sourceActorId ? { source: { actorId: pending.sourceActorId, name: pending.sourceName } } : {})
    });
  if (!success && pending.failurePush) events.push(...pushOnFailure(target, pending, deps));
  // SRD Sleet Storm: a failure "and lose Concentration".
  if (!success && pending.breaksConcentration) events.push(...endConcentrationSustainedBy(state, target.id));
  if (outcomeCondition)
    conditionApplied = target.conditions.some(
      (condition) =>
        pending.conditionIds.includes(condition.id) || pending.onFailEffect?.linkedConditionIds.includes(condition.id)
    );
  // "Success: The target is immune to this ghast's Stench for 24 hours", held for the fight.
  if (success && pending.immuneOnSuccess && pending.sourceActorId !== null)
    addEffect(
      state,
      target.id,
      makeEffect({
        id: `${commandId}:${saveId}:immune`,
        name: `Immune to ${pending.sourceName}'s ${pending.actionName}`.slice(0, 120),
        tags: [AURA_IMMUNE_TAG],
        sourceActorId: pending.sourceActorId,
        sourceName: pending.sourceName,
        sourceActionId: traitActionId(pending.actionName),
        startedRound: state.combat.round,
        duration: { type: "encounter" }
      })
    );
  // A repeated save that succeeds ends the effect it was repeated for (Hold Person ends on that target).
  if (success && pending.repeatOf)
    events.push(...endEffectIfPresent(state, pending.repeatOf.actorId, pending.repeatOf.effectId));
  state.combat = { ...state.combat, pendingSaves: state.combat.pendingSaves.filter((entry) => entry.id !== saveId) };
  // A spell whose last target saved has nothing left (Hold Person, Phantasmal Killer's "the spell ends").
  const castId = pending.onFailEffect?.castId;
  if (castId !== undefined) events.push(...endIdleConcentration(state, castId));
  // A save the GM called for reports back to the call.
  if (pending.callId !== undefined)
    recordCallResult(state, pending.callId, target.id, {
      natural: natural ?? 0,
      total,
      success,
      ...(autoFailed !== null ? { autoFailed } : {})
    });
  return {
    outcome: {
      success,
      total,
      dc: pending.dc,
      ...(natural !== null ? { natural } : {}),
      appliedDamage,
      conditionApplied,
      committed: true,
      autoFailed,
      ...(autoSucceeded !== null ? { autoSucceeded } : {}),
      ...(rollMode ? { rollMode } : {}),
      ...(application
        ? {
            parts: application.parts,
            ...(application.flatReduction ? { flatReduction: application.flatReduction } : {})
          }
        : {})
    },
    events
  };
}

/** Drop a pending save without resolving it (GM housekeeping, e.g. the effect ended). */
export function dismissSave(state: GameState, saveId: string, scope: Initiator) {
  requireGm(scope, "Only the GM can dismiss a saving throw.");
  if (!state.combat.pendingSaves.some((entry) => entry.id === saveId))
    throw new CommandRejectedError("That saving throw was already answered or dismissed.");
  state.combat = { ...state.combat, pendingSaves: state.combat.pendingSaves.filter((entry) => entry.id !== saveId) };
  releaseHeldRoll(state, `save:${saveId}`);
}

/** Writes one character's result into the GM's call for a roll; a closed call is left alone. */
export function recordCallResult(
  state: GameState,
  callId: string,
  actorId: string,
  result: NonNullable<GameState["rollCalls"][number]["entries"][number]["result"]>
): void {
  state.rollCalls = state.rollCalls.map((call) =>
    call.id !== callId
      ? call
      : {
          ...call,
          entries: call.entries.map((entry) =>
            entry.actorId === actorId ? { ...entry, result: { ...result } } : entry
          )
        }
  );
}
