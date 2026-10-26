import { dropHeldRow } from "./effects.js";
import { ownSizeOf, takeForm } from "./transform/assume.js";
import { revertOnFailure } from "./transform/rules.js";
import { refreshSize } from "./transform/forms.js";
import type {
  AbilityId,
  Actor,
  DamageApplication,
  GameState,
  HeldRoll,
  PendingSave,
  RollAnswered,
  RollAnswerOffer
} from "@vtt/domain";
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
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { withoutSameHazard } from "./hazards.js";
import { recordRoll as recordRollInHistory, rolledTerms } from "./roll-history.js";
import { requireGm, type Initiator } from "./authorization.js";
import { holdsFeature } from "./class-features.js";
import { d20MinimumOf, totalMinimumOf } from "./ability-checks.js";
import { heldRollFor, holdRoll, releaseHeldRoll, rollHeldTest } from "./held-rolls.js";
import {
  answeredLines,
  answerKeyOf,
  answersFromOthers,
  answersOffered,
  applyRollAnswer,
  askAnswer,
  withAnswers,
  type AnswerDeps,
  type AnswerTarget
} from "./roll-answers.js";
import { AURA_IMMUNE_TAG, auraOfAuthority, traitActionId } from "./statblock-traits.js";
import { immunityDuration } from "./save-immunity.js";
import { settleTouchedZone } from "./zone-touch.js";
import { applyDamageDetailed, previewDamage, adjustableActor, healActor, killOutright } from "./hit-points.js";
import { giveVitality } from "./resolution/vitality.js";
import { openDamageWindow } from "./damage-window.js";
import { applyHitPointBand, banishOnFailure, hitPointBandOf } from "./fatal-saves.js";
import { applyMarginCompanion, marginBandOf, withMarginBand } from "./save-margins.js";
import { penalizeRow } from "./row-penalties.js";
import { regurgitate, swallowLands, SWALLOWED_TAG } from "./swallow.js";
import { holyWardClaim, inPaladinAura, tableHiddenCheck, type AuraContext } from "./paladin-auras.js";
import { setCondition } from "./actor-conditions.js";
import { autoFailsPhysicalSaves, conditionLabel, exhaustionPenalty, isIncapacitated } from "./condition-rules.js";
import { startHoldingBreath } from "./breath.js";
import { GIBBERING_TAG, gibberingTurn } from "./random-outcomes.js";
import {
  addEffect,
  CONCENTRATING_TAG,
  SMOTHERING_TAG,
  dropHeldItems,
  effectDurationOf,
  endConcentrationSustainedBy,
  endConditionsImmuneTo,
  endEffectIfPresent,
  endIdleConcentration,
  makeEffect,
  sourceOf,
  spellWords,
  type ConditionImmunitySource,
  type EffectNarration
} from "./effects.js";
import { areAllies } from "./creature-sides.js";
import { rowRecord } from "./item-records.js";
import {
  deriveEquipment,
  itemIsActive,
  rollModeClaims,
  type EquipmentCatalog,
  type EquipmentDerivation,
  type RollModeClaims
} from "./equipment-derivation.js";
import { countZoneDamage } from "./spell-zone-state.js";
import { followPushed, forceOf } from "./summon-strikes.js";
import { endCasterSpell } from "./spell-endings.js";
import { armedRepeat, durationUntilRepeat, settleEndingSave } from "./save-stages.js";
import { creatureTypeOf } from "./statblock-facts.js";
import { suppressConditions } from "./suppressed-conditions.js";
import { sizeAtMost, sizeRank } from "./resolution/context.js";
import { lightSensitivities, sightRules } from "./vision/rules.js";
import { legendaryResistancesPerDay } from "./lair.js";
import { unseat } from "./mounts.js";
import { spendKillCharge } from "./item-charges.js";

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
    input: Readonly<{ actorId: string; awayFromActorId: string; distanceFeet: number; toward?: boolean }>
  ) => Readonly<{ value: number; unit: string }> | null;
  /** Pulls a token into another creature's space (a shambling mound's Engulf); false when the map can't. */
  pullInto?: (actorId: string, intoId: string) => boolean;
  /** The nearest unoccupied space within `withinFeet` of another creature that a success moves its creature to (a
   *  gelatinous cube's Engulf): null when there is none, undefined when the map can't say. */
  openSpaceBeside?: (
    actorId: string,
    besideId: string,
    withinFeet: number
  ) => Readonly<{ x: number; y: number }> | null | undefined;
  /** Sets a token down at a point the server picked. */
  placeToken?: (actorId: string, at: Readonly<{ x: number; y: number }>) => void;
  /** Sets a creature's token down in the nearest unoccupied space beside another's (a rider thrown from its mount);
   *  false when the map can't. */
  placeBeside?: (actorId: string, besideId: string) => boolean;
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
  /** What answered the roll, already in its numbers, and on a preview what may still answer it. */
  answered?: readonly RollAnswered[];
  answers?: readonly RollAnswerOffer[];
  /** The confirm waits on another creature's answer to the roll (Countercharm); nothing is applied yet. */
  awaitingAnswer?: true;
  /** The damage waits on the target's reaction to taking it (Stone's Endurance); the answer lands it. */
  damageHeld?: true;
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
  sourceCreatureType: string | null = null,
  against: SaveSource = {}
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
      ...(sourceCreatureType !== null ? { sourceCreatureType } : {}),
      // A save against a spell or another magical effect (Spellguard Shield), and against a spell, with its school and
      // level (Mantle of Spell Resistance).
      ...(against.magical ? { magicalSource: true } : {}),
      // A save against a breath weapon (Dragon Scale Mail's Advantage).
      ...(against.breathWeapon ? { breathWeaponSource: true } : {}),
      ...(against.spell
        ? {
            spellSource: true,
            spellId: against.spell.id,
            spellSchool: against.spell.school,
            spellLevel: against.spell.level
          }
        : {})
    },
    claims
  );
}

/** What a save is against, for a rider that reads it: magic, the spell, and a breath weapon. */
export type SaveSource = Readonly<{
  magical?: boolean;
  spell?: Readonly<{ id: string; school: string; level: number }>;
  breathWeapon?: boolean;
}>;

/** The active item whose success against this spell leaves it no effect on its bearer (a Ring of Spell Turning: "If
 *  you succeed on the save for a spell of level 7 or lower, the spell has no effect on you"), by name. */
function spellTurnedBy(target: Actor, pending: PendingSave, catalog: EquipmentCatalog | undefined): string | null {
  const level = pending.spell?.level;
  if (level === undefined || !catalog) return null;
  for (const row of target.inventory) {
    const record = rowRecord(catalog, row);
    const turning = record?.savesNegateSpells;
    if (turning && level <= turning.maxLevel && itemIsActive(row, record)) return record!.name;
  }
  return null;
}

/** What a breath weapon as the SRD's stat blocks name it: a Dragon's "Fire Breath", a dragonborn's "Breath Weapon". */
export const isBreathWeapon = (actionName: string): boolean => /\bbreath(?: weapon)?\b/i.test(actionName);

/** What a pending save is against: a spell is magic too. */
export const saveSourceOf = (pending: Pick<PendingSave, "magical" | "spell" | "actionName">): SaveSource => ({
  ...(pending.magical === true || pending.spell !== undefined ? { magical: true } : {}),
  ...(pending.spell ? { spell: pending.spell } : {}),
  ...(isBreathWeapon(pending.actionName) ? { breathWeapon: true } : {})
});

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

/**
 * An item's aura of Advantage on saves against magic (SRD Holy Avenger: "You and all creatures Friendly to you in the
 * Emanation have Advantage on saving throws against spells and other magical effects"), for a save against magic: the
 * bearer's own, or an ally's within its reach on the map. A bearer hidden from the table gives a visible creature
 * nothing, which would reveal it.
 */
export function magicSaveAuraClaims(
  state: GameState,
  target: Actor,
  against: SaveSource,
  context: AuraContext
): Array<{ source: string; label: string }> {
  if (!against.magical || !context.catalog) return [];
  const claims: Array<{ source: string; label: string }> = [];
  let hidden: ((actorId: string) => boolean) | null = null;
  for (const bearer of state.actors) {
    if (bearer.archived || bearer.hp.current <= 0) continue;
    for (const row of bearer.inventory) {
      const record = rowRecord(context.catalog, row);
      const aura = record?.magicSaveAura;
      if (!aura || !itemIsActive(row, record)) continue;
      if (bearer.id !== target.id) {
        if (!areAllies(bearer, target, context.resolveDefinition)) continue;
        hidden ??= tableHiddenCheck(state, context);
        if (hidden(bearer.id) && !hidden(target.id)) continue;
        const definition = bearer.definitionId ? context.resolveDefinition(bearer.definitionId) : undefined;
        const level = aura.widerAt
          ? (definition?.character?.classes.find((entry) => entry.id === aura.widerAt!.classId)?.level ?? 0)
          : 0;
        const feet = aura.widerAt && level >= aura.widerAt.level ? aura.widerAt.feet : aura.feet;
        const distance = context.distanceFeet?.(bearer.id, target.id) ?? null;
        if (distance === null || distance > feet + 1e-6) continue;
      }
      claims.push({
        source: "item-aura",
        label: bearer.id === target.id ? record!.name : `${bearer.name}'s ${record!.name}`
      });
    }
  }
  return claims;
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
    /** What gives this save Advantage or Disadvantage beside the creature's own riders (a Blanket against the cold,
     *  Heavy armor in the heat). */
    advantageFrom?: string;
    disadvantageFrom?: string;
  }>
): Readonly<{ natural: number; total: number; rollMode: AggregatedRollMode }> {
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const derivation = deriveEquipment(actor, definition, deps.catalog);
  const modifier =
    saveTotalFor(definition, actor, ability, derivation) + (auraOfProtection(state, actor, deps)?.amount ?? 0);
  const sources = saveRollSources(actor, ability, derivation, false, [], null, {
    ...(deps.magical === true ? { magical: true } : {})
  });
  if (deps.magical === true && magicResistanceOf(definition) !== null)
    sources.advantage.push({ source: "magic-resistance", label: "Magic Resistance" });
  if (deps.advantageFrom) sources.advantage.push({ source: "situation", label: deps.advantageFrom });
  if (deps.disadvantageFrom) sources.disadvantage.push({ source: "situation", label: deps.disadvantageFrom });
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

export { createPendingSaves } from "./pending-saves.js";

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
  const failed = makeEffect({
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
        : effectDurationOf(
            state,
            durationUntilRepeat(onFail.duration, onFail.repeatSave),
            target.id,
            onFail.sourceActorId
          ),
    // Saves parked before failures carried their own lifetime were all grapples.
    endsWhenSourceDefeated: onFail.endsWhenSourceDefeated ?? onFail.tags.includes("grapple"),
    concentration: onFail.castId !== undefined,
    linkedConditionIds: [...onFail.linkedConditionIds],
    escapeDc: onFail.escapeDc,
    ...(onFail.repeatSave ? { repeatSave: armedRepeat(state, target.id, onFail.repeatSave) } : {}),
    ...(onFail.endsOnDamage ? { endsOnDamage: true } : {}),
    ...(onFail.endsOnIncapacitated ? { endsOnIncapacitated: true as const } : {}),
    ...(onFail.endsOnSourceSideDamage ? { endsOnSourceSideDamage: true as const } : {}),
    ...(onFail.endsOnSpellHealing ? { endsOnSpellHealing: true as const } : {}),
    ...(onFail.endsOutOfSight ? { endsOutOfSight: true as const } : {}),
    ...(onFail.endedBy ? { endedBy: structuredClone(onFail.endedBy) } : {}),
    ...(onFail.atRest ? { atRest: structuredClone(onFail.atRest) } : {}),
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
    // The light it sheds while it lasts (Faerie Fire's Dim Light).
    ...(onFail.light ? { light: { ...onFail.light } } : {}),
    // What holds it (a Net), whose destruction frees it.
    ...(onFail.heldBy ? { heldBy: { ...onFail.heldBy, hitPoints: { ...onFail.heldBy.hitPoints } } } : {}),
    // What it does while it lasts (Bane's -1d4).
    modifiers: [...onFail.modifiers],
    // A size it changes (Enlarge/Reduce), from the size the creature had before.
    ...(onFail.sizeChange ? { sizeChange: { ...onFail.sizeChange }, ownSize: ownSizeOf(target) } : {})
  });
  // A failure that shape-shifts the creature (Polymorph) takes the form, which needs the stat blocks.
  if (onFail.form && immunities?.resolveDefinition) {
    const shifted = takeForm(
      state,
      target.id,
      { ...failed, form: structuredClone(onFail.form) },
      {
        resolveDefinition: immunities.resolveDefinition,
        ...(immunities.catalog ? { catalog: immunities.catalog } : {})
      },
      immunities
    );
    return shifted;
  }
  const applied = addEffect(state, target.id, failed, events, immunities);
  if (applied.sizeChange) refreshSize(state, target);
  // "It drops whatever it is holding" (Fear), once, as the failure lands.
  if (onFail.tags.includes(DROPS_HELD_TAG)) events.push(...dropHeldItems(target, immunities));
  // "The behir swallows the target, which is no longer Grappled."
  if (onFail.tags.includes(SWALLOWED_TAG) && onFail.sourceActorId)
    events.push(...swallowLands(state, target, onFail.sourceActorId));
  // "Is suffocating" while engulfed or whelmed: it holds its breath until what smothers it ends.
  if (onFail.tags.includes(SMOTHERING_TAG)) {
    const definition = target.definitionId ? immunities?.resolveDefinition?.(target.definitionId) : undefined;
    events.push(...startHoldingBreath(state, target, definition));
  }
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

/** The tag on a failure that makes its target drop what it holds (Fear). */
export const DROPS_HELD_TAG = "drops-held";

/**
 * A save's forced move, the whole way, on the live map: a failure's push straight away from the save's source
 * (Thunderwave's 10 feet, a dragon's Repulsion Breath "up to 60 feet") or pull straight toward it (a chain devil's
 * Conjure Infernal Chain), a failure that pulls the creature into the source's space (a shambling mound's Engulf), or a
 * success's push (a bulette's Deadly Leap). Too big a creature stays put; a map that can't place it asks the GM to move
 * the token.
 */
function forcedMoveOnSave(
  state: GameState,
  target: GameState["actors"][number],
  pending: PendingSave,
  push: NonNullable<PendingSave["failurePush"]>,
  deps: SaveAnswerDependencies
): EffectNarration[] {
  const sourceId = pending.sourceActorId;
  if (sourceId === null || sourceId === target.id) return [];
  if (push.maxTargetSize && !sizeAtMost(target.size, push.maxTargetSize)) return [];
  const source = { actorId: sourceId, name: pending.sourceName };
  if (push.intoSpace) {
    const pulled = deps.pullInto?.(target.id, sourceId) ?? false;
    return [
      {
        kind: "effect",
        text: `${target.name} is pulled into ${pending.sourceName}'s space.${pulled ? "" : " Move the token."}`,
        actorId: target.id,
        source
      }
    ];
  }
  // A spell's force pushes from where it stands and goes along (Arcane Hand's Forceful Hand).
  const before = state.combat.tokens.find((token) => token.actorId === target.id)?.position ?? null;
  const standing = pending.spell ? forceOf(state, sourceId, pending.spell.id) : undefined;
  const forceAt = standing && state.combat.tokens.find((token) => token.actorId === standing.id)?.position;
  // A force that moved into the creature's own space pushes it straight away from the caster.
  const force = forceAt && before && (forceAt.x !== before.x || forceAt.y !== before.y) ? standing : undefined;
  const moved =
    deps.pushToken?.({
      actorId: target.id,
      awayFromActorId: force?.id ?? sourceId,
      distanceFeet: push.feet,
      ...(push.toward ? { toward: true } : {})
    }) ?? null;
  const after = state.combat.tokens.find((token) => token.actorId === target.id)?.position ?? null;
  if (standing && before && after && moved !== null) followPushed(state, standing.id, before, after);
  const way = push.toward ? "toward" : "away from";
  const verb = push.toward ? "pulled" : "pushed";
  // A creature in the source's own space (a bulette landed on it) has no straight way out: it goes to the nearest
  // unoccupied space beside the source.
  const sourceAt = state.combat.tokens.find((token) => token.actorId === sourceId)?.position;
  const stacked = !push.toward && before !== null && !!sourceAt && sourceAt.x === before.x && sourceAt.y === before.y;
  if (moved === null && stacked && deps.placeBeside?.(target.id, sourceId))
    return [
      {
        kind: "effect",
        text: `${target.name} is pushed out of ${pending.sourceName}'s space.`,
        actorId: target.id,
        source
      }
    ];
  if (moved === null)
    return [
      {
        kind: "effect",
        text: `${target.name} is ${verb} ${push.feet} feet straight ${way} ${pending.sourceName}. Move the token.`,
        actorId: target.id,
        gmOnly: true
      }
    ];
  const travelled = Math.round(moved.value * 10) / 10;
  if (travelled <= 0) return [];
  return [
    {
      kind: "effect",
      text: `${target.name} is ${verb} ${travelled} ${moved.unit} straight ${way} ${pending.sourceName}.`,
      actorId: target.id,
      source
    }
  ];
}

/** A success that moves the creature out beside the source (a gelatinous cube's Engulf: "the target moves to an
 *  unoccupied space within 5 feet of the cube"). */
function moveOutOnSuccess(
  target: GameState["actors"][number],
  pending: PendingSave,
  at: Readonly<{ x: number; y: number }> | undefined,
  deps: SaveAnswerDependencies
): EffectNarration[] {
  if (at) deps.placeToken?.(target.id, at);
  const within = pending.successMovesOut?.withinFeet ?? 5;
  const placed = at !== undefined && deps.placeToken !== undefined;
  return [
    {
      kind: "effect",
      text: `${target.name} moves to an unoccupied space within ${within} feet of ${pending.sourceName}.${placed ? "" : " Move the token."}`,
      actorId: target.id,
      ...(pending.sourceActorId ? { source: { actorId: pending.sourceActorId, name: pending.sourceName } } : {})
    }
  ];
}

/** A failure that kills (Consume Life): the target dies, and its source regains the rolled hit points. */
function killOnFailure(
  state: GameState,
  target: GameState["actors"][number],
  pending: PendingSave,
  deps: SaveAnswerDependencies
): EffectNarration[] {
  const events = killOutright(state, target.id, pending.actionName, {
    withoutDamage: true,
    deps: {
      resolveDefinition: deps.resolveDefinition,
      rollDie: deps.random,
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    }
  });
  const formula = pending.failureKills?.sourceRegains;
  const source = state.actors.find((actor) => actor.id === pending.sourceActorId);
  if (!formula || !source || source.hp.current <= 0) return events;
  const regained = Math.max(0, resolveDice(parseDiceFormula(formula), deps.random).total);
  const before = source.hp.current;
  events.push(...healActor(state, source.id, regained, { role: "gm" }));
  const gained = source.hp.current - before;
  if (gained > 0)
    events.push({
      kind: "effect",
      text: `${source.name} regains ${gained} hit points (${pending.actionName}).`,
      actorId: source.id,
      gmOnly: true
    });
  return events;
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

/** How a pending save is answered beyond its method: a typed d20 (`face`), a reroll of the held die, or an answer to
 *  the held roll (`roll-answers.ts`). */
export type SaveAnswerOptions = Readonly<{
  face?: number;
  reroll?: boolean;
  /** `by` names another creature answering (Countercharm, through its Reaction prompt); absent, the saving one. */
  answer?: Readonly<{ id: string; subtract?: boolean; face?: number; by?: string }>;
  /** The confirm of a save that waited on others' answers, finished once they have answered. */
  settling?: true;
}>;

/** What lasts only until its bearer's next saving throw (Staggering Blow's Disadvantage) is spent by it; the rest of
 *  the effect (its no Opportunity Attacks) stays until its own end. */
export const UNTIL_OWN_SAVE_TAG = "until-own-save";

function spendUntilOwnSave(state: GameState, target: Actor): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const effect of target.effects.filter((candidate) => candidate.tags.includes(UNTIL_OWN_SAVE_TAG))) {
    const rest = effect.tags.filter((tag) => tag !== UNTIL_OWN_SAVE_TAG);
    if (rest.length === 0) {
      events.push(...endEffectIfPresent(state, target.id, effect.id));
      continue;
    }
    target.effects = target.effects.map((candidate) =>
      candidate.id === effect.id
        ? {
            ...candidate,
            tags: rest,
            modifiers: candidate.modifiers.filter(
              (modifier) => modifier.type !== "roll-mode" || modifier.roll !== "save"
            )
          }
        : candidate
    );
  }
  return events;
}

/** Answers a pending save (a roll, a typed d20, or the GM's typed total) and auto-applies it: fail takes full damage
 *  and the condition; success takes half if the action says so. The structured-save exception to propose-then-apply
 *  (ADR-0008). GM any save; a player only their own character's. A preview holds its die (ADR-0012), so a later
 *  preview or the confirm uses the same one. */
export function answerSave(
  state: GameState,
  commandId: string,
  saveId: string,
  method: "roll" | "manual" | "fail",
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
  // A confirmed save waiting on another creature's answer moves only through that answer.
  if (pending.confirmed && options.settling !== true && options.answer?.by === undefined)
    throw new CommandRejectedError(`${target.name}'s save waits on an answer to the roll. The GM can close it.`);

  let total: number;
  let natural: number | null = null;
  let autoFailed: string | null = null;
  let autoSucceeded: string | null = null;
  let rollMode: AggregatedRollMode | undefined;
  /** What raised the roll past its dice (Indomitable Might), named on the table's line. */
  let raisedBy: string | null = null;
  // What answered the rolled save (`roll-answers.ts`), and what may still answer it on a preview.
  let answerSucceeds = false;
  let answered: RollAnswered[] = [];
  let offered: RollAnswerOffer[] = [];
  const answerEvents: EffectNarration[] = [];
  // A confirm that waits on another creature's answer to the roll applies nothing yet.
  let awaitingAnswer = false;
  if (options.answer && method !== "roll") throw new CommandRejectedError("Answer a save the dice decide.");
  const targetDefinition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
  const magicResistance = pending.magical ? magicResistanceOf(targetDefinition) : null;
  // SRD Saving Throw: "you can decide to fail the save without rolling" (a willing target). Its controller decides,
  // which `adjustableActor` checked above.
  const chosenFailure = method === "fail";
  if (chosenFailure && legendaryResistance)
    throw new CommandRejectedError("A creature that chooses to fail a save doesn't spend Legendary Resistance on it.");
  if (chosenFailure) {
    total = 0;
    // A die shown on an earlier look (an auto-roll) goes unused.
    if (commit) releaseHeldRoll(state, heldKey);
  } else if (method === "manual") {
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
  } else if (pending.autoSucceeds) {
    // "Constructs automatically succeed on the save" (Flesh to Stone); no die is rolled.
    autoSucceeded = pending.autoSucceeds;
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
      sourceCreatureTypeOf(state, pending.sourceActorId, deps.resolveDefinition),
      saveSourceOf(pending)
    );
    if (magicResistance === "advantage")
      sources.advantage.push({ source: "magic-resistance", label: "Magic Resistance" });
    // What opened the save gives it Advantage (damage, for Hideous Laughter), or the fight it is in (Charm Person).
    if (pending.advantageFrom) sources.advantage.push({ source: "trigger", label: pending.advantageFrom });
    // "A Large or larger creature has Advantage on this save" (Ensnaring Strike).
    if (pending.advantageAtSize && sizeRank(target.size) >= sizeRank(pending.advantageAtSize))
      sources.advantage.push({ source: "size", label: `${pending.actionName}: its size` });
    // "A Construct has Disadvantage on the save" (Shatter).
    const type = creatureTypeOf(target, definition);
    if (type !== null && pending.disadvantageTypes?.includes(type))
      sources.disadvantage.push({ source: "creature-type", label: `${pending.actionName}: its creature type` });
    // Heightened Spell's target, on the cast's save and each it repeats.
    if (pending.disadvantageFrom)
      sources.disadvantage.push({ source: "disadvantage-from", label: pending.disadvantageFrom });
    sources.advantage.push(...traitSaveClaims(state, target, definition, deps));
    sources.advantage.push(...magicSaveAuraClaims(state, target, saveSourceOf(pending), deps));
    // Sunlight Weakness: Disadvantage on D20 Tests while it stands in sunlight.
    const sightContent = { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
    for (const name of lightSensitivities(state, target, "save", sightRules(state, sightContent), sightContent))
      sources.disadvantage.push({ source: "light-sensitivity", label: `${name} (in the light)` });
    const ward = holyWardClaim(state, target, pending.sourceActorId, {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {})
    });
    if (ward) sources.advantage.push(ward);
    const aggregated = aggregateRollMode(sources.advantage, sources.disadvantage);
    // A player's choice is never read: the rules count Advantage and Disadvantage, and only the GM may force a mode.
    const forced = scope.role === "gm" ? explicitRollMode : undefined;
    const mode = forced ?? aggregated.mode;
    if (options.answer && (commit || options.reroll || options.face !== undefined))
      throw new CommandRejectedError("Answer the save on a look of its own, before you confirm it.");
    if (options.answer && !heldRollFor(state, heldKey))
      throw new CommandRejectedError("Roll first: an answer meets a roll that was made.");
    // Bless's d4 rolls into the save itself, and is held with its d20s.
    const throwSave = (choice: Pick<SaveAnswerOptions, "face" | "reroll">) =>
      rollHeldTest(
        state,
        heldKey,
        target,
        scope,
        mode,
        modifier,
        saveRiderDiceTerms(derivation, pending.ability),
        choice,
        deps.random
      );
    let test = throwSave(options.answer ? {} : options);
    rollMode = test.typed ? undefined : shownRollMode(aggregated, forced);
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
    // What answered the save on an earlier look counts in this one, the confirm included.
    const answeredBefore = heldRollFor(state, heldKey);
    if (!commit)
      holdRoll(state, {
        key: heldKey,
        actorId: target.id,
        faces: test.faces,
        others: otherDiceOf(test.resolution),
        rollId: test.fresh ? rollId : (state.heldRolls.find((entry) => entry.key === heldKey)?.rollId ?? null),
        typed: test.typed
      });
    const shown = (held: HeldRoll | undefined) => withAnswers(held, test.natural, test.resolution.total);
    const answerTarget = (held: HeldRoll | undefined): AnswerTarget => ({
      kind: "save",
      roller: target,
      key: heldKey,
      natural: shown(held).natural,
      total: shown(held).total,
      threshold: pending.dc,
      mode,
      ability: pending.ability,
      stakes: {
        conditions: conditionsAtStake(state, pending),
        ...(pending.spell ? { spell: pending.spell } : {}),
        sourceActorId: pending.sourceActorId
      },
      purpose: "save",
      label: `${pending.ability.toUpperCase()} save`,
      visibility: target.visibility === "gm-only" ? "gm-only" : "public"
    });
    if (options.answer) {
      const bearer =
        options.answer.by === undefined ? target : state.actors.find((actor) => actor.id === options.answer!.by);
      if (!bearer) throw new CommandRejectedError("The creature answering the save is no longer here.");
      answerEvents.push(
        ...applyRollAnswer(
          state,
          answerTarget(heldRollFor(state, heldKey)),
          bearer,
          options.answer,
          answerDepsOf(deps, commandId)
        )
      );
      // A reroll answer changed the held dice; this look reads them.
      test = throwSave({});
    }
    let held = commit ? answeredBefore : heldRollFor(state, heldKey);
    // Another creature may answer the confirmed roll first (Countercharm, a sphinx's Burst of Ingenuity), one at a
    // time in turn order: the confirm waits on its prompt, and the answer finishes it.
    if (commit && !legendaryResistance && state.combat.active) {
      const asked = pending.confirmed?.asked ?? [];
      const next = answersFromOthers(state, answerTarget(held), answerDepsOf(deps, commandId), new Set(asked))[0];
      if (next) {
        holdRoll(state, {
          key: heldKey,
          actorId: target.id,
          faces: test.faces,
          others: otherDiceOf(test.resolution),
          rollId: held?.rollId ?? (test.fresh ? rollId : null),
          typed: test.typed
        });
        held = heldRollFor(state, heldKey);
        const confirmed = {
          ...(forced !== undefined ? { rollMode: forced } : {}),
          ...(damageOverride !== undefined ? { damageOverride } : {}),
          asked: [...asked, answerKeyOf(next)]
        };
        state.combat = {
          ...state.combat,
          pendingSaves: state.combat.pendingSaves.map((entry) =>
            entry.id === saveId ? { ...entry, confirmed } : entry
          )
        };
        answerEvents.push(
          askAnswer(
            state,
            next,
            { rollKind: "save", roller: target, targetActorId: null, saveId, asked: confirmed.asked },
            { newId: deps.newRollId, now: deps.now, commandId }
          )
        );
        awaitingAnswer = true;
      }
    }
    if (commit && !awaitingAnswer) releaseHeldRoll(state, heldKey);
    const read = shown(held);
    natural = read.natural;
    total = read.total;
    answerSucceeds = read.succeed;
    answered = answeredLines(held);
    if (!commit) offered = answersOffered(state, answerTarget(held), answerDepsOf(deps, commandId));
    // A floor under the d20 or the total (Indomitable Might's Strength score) counts as more.
    const floored = flooredSaveTotal(derivation, definition, pending.ability, natural, total);
    total = floored.total;
    if (floored.raisedBy !== null) raisedBy = floored.raisedBy;
  }
  // Waiting on an answer, the confirm reads as a look: nothing lands until the answer finishes it.
  const applying = commit && !awaitingAnswer;

  let success =
    !chosenFailure && (autoSucceeded !== null || (autoFailed === null && total >= pending.dc) || answerSucceeds);
  // SRD Legendary Resistance: on a failed save the creature can choose to succeed. The GM commits with
  // the flag; the pool rides actionUses["legendary-resistance"] and a Long Rest re-arms it.
  let legendaryNote: string | null = null;
  if (legendaryResistance) {
    if (!commit) throw new CommandRejectedError("Commit the save to spend Legendary Resistance.");
    requireGm(scope, "Only the GM can spend Legendary Resistance.");
    const definition = target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined;
    const perDay = legendaryResistancesPerDay(target, definition);
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
  // "If there is no unoccupied space, the target fails the save instead" (a gelatinous cube's Engulf).
  const roomOutside =
    success && pending.successMovesOut && pending.sourceActorId
      ? deps.openSpaceBeside?.(target.id, pending.sourceActorId, pending.successMovesOut.withinFeet)
      : undefined;
  const noRoom = roomOutside === null;
  if (noRoom) success = false;
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
  // A Ring of Spell Turning: a success against a spell of its level or lower leaves the spell no effect at all.
  const turnedBy = success ? spellTurnedBy(target, pending, deps.catalog) : null;
  // A failure that acts by the target's Hit Points (Divine Word, Slaying Bow) does its band's outcome instead.
  const band = success ? null : hitPointBandOf(pending, target);
  const outcomeParts = band
    ? []
    : parts && parts.length > 0
      ? success && (!pending.halfOnSuccess || evasion || turnedBy !== null)
        ? []
        : halved
          ? halveDamageParts(parts)
          : parts
      : null;
  const outcomeDamage =
    outcomeParts !== null
      ? outcomeParts.reduce((sum, part) => sum + part.amount, 0)
      : success && (!pending.halfOnSuccess || evasion || turnedBy !== null)
        ? 0
        : halved
          ? Math.floor(proposedTotal / 2)
          : proposedTotal;
  const outcomeCondition =
    !success &&
    band === null &&
    (pending.conditionIds.length > 0 || (pending.onFailEffect?.linkedConditionIds.length ?? 0) > 0);

  // Preview (commit=false): the roll is recorded so everyone sees it, but nothing is applied and the
  // save stays open until the answerer confirms. The damage is weighed through the target's defences, so the
  // prompt shows what Confirm will land.
  if (!applying) {
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
        ...(weighed?.flatReduction ? { flatReduction: weighed.flatReduction } : {}),
        ...(answered.length > 0 ? { answered } : {}),
        ...(offered.length > 0 ? { answers: offered } : {}),
        ...(awaitingAnswer ? { awaitingAnswer: true as const } : {})
      },
      events: answerEvents
    };
  }

  const events: EffectNarration[] = [...answerEvents, ...spendUntilOwnSave(state, target)];
  if (legendaryNote !== null) events.push({ kind: "effect", text: legendaryNote, actorId: target.id });
  if (chosenFailure)
    events.push({
      kind: "condition",
      text: `${target.name} chooses to fail the ${pending.ability.toUpperCase()} save.`,
      actorId: target.id
    });
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
  // Harm drains only on a failed save; a Life Drain whose save halves the damage drains either way.
  const drain = pending.drain && (!success || pending.drain.failedSaveOnly !== true) ? pending.drain : undefined;
  // Damage the target may answer before it lands (Stone's Endurance, Superior Hunter's Defense) waits on a prompt that
  // holds it, and the answer lands it (reactions.ts). Damage a spell area counts (Guardian of Faith) lands at once.
  const held =
    outcomeDamage > 0 && outcomeParts !== null && pending.zoneId === undefined
      ? openDamageWindow(
          state,
          {
            source: state.actors.find((actor) => actor.id === pending.sourceActorId) ?? null,
            sourceName: pending.sourceName,
            target,
            parts: outcomeParts,
            critical: false,
            hit: false,
            hitKinds: [],
            ...(drain ? { drain } : {}),
            asked: []
          },
          {
            resolveDefinition: (definitionId) => deps.resolveDefinition(definitionId),
            ...(deps.catalog ? { catalog: deps.catalog } : {}),
            random: deps.random,
            newId: deps.newRollId,
            now: deps.now,
            sessionId: deps.sessionId,
            role: deps.role,
            commandId,
            ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
          }
        )
      : null;
  if (outcomeDamage > 0 && held === null) {
    const outcome = applyDamageDetailed(
      state,
      target.id,
      {
        amount: outcomeDamage,
        ...(outcomeParts !== null ? { parts: outcomeParts } : {}),
        sourceActorId: pending.sourceActorId,
        ...(drain ? { drain } : {})
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
    // The cast's damage landed: its caster's pick gains the vitality (Improved Potent Spellcasting).
    if (appliedDamage > 0 && pending.vitality) events.push(...giveVitality(state, pending.vitality));
    // A spell area that stops after so much damage counts it (Guardian of Faith).
    events.push(...countZoneDamage(state, pending.zoneId, appliedDamage, deps.catalog));
  }
  // Where the target stands counts too: a Paladin's aura can ward off what the failure imposes.
  const immunities = {
    resolveDefinition: (definitionId: string) => deps.resolveDefinition(definitionId),
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {}),
    // Against a spell or a magic item's effect, which Freedom of Movement keeps from Paralyzing or Restraining.
    magical: pending.magical === true || pending.spell !== undefined
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
  if (band)
    events.push(
      ...applyHitPointBand(
        state,
        target,
        band,
        pending,
        {
          resolveDefinition: (definitionId) => deps.resolveDefinition(definitionId),
          ...(deps.catalog ? { catalog: deps.catalog } : {}),
          newId: deps.newRollId,
          now: deps.now,
          rollDie: deps.random
        },
        `${commandId}:${saveId}:band`
      )
    );
  // A slaying that spends its weapon's charge (Nine Lives Stealer) spends it now.
  const killer =
    band?.dies && pending.spendsOnKill
      ? state.actors.find((actor) => actor.id === pending.spendsOnKill!.actorId)
      : undefined;
  if (killer) spendKillCharge(killer, pending.spendsOnKill!.key);
  if (!success && pending.failureBanishes)
    events.push(
      ...banishOnFailure(
        state,
        target,
        pending,
        target.definitionId ? deps.resolveDefinition(target.definitionId) : undefined,
        `${commandId}:${saveId}:banished`
      )
    );
  // "Failure by 5 or More": the band's conditions and duration stand in for the failure's, with what lasts while they do.
  const margin = !success && band === null ? marginBandOf(pending, total) : null;
  if (!success && band === null && pending.onFailEffect) {
    const banded = margin ? withMarginBand(pending.onFailEffect, margin) : pending.onFailEffect;
    // A failure whose hours are rolled as it lands (Torpor: 4d6 hours).
    const onFail = banded.hoursRolled
      ? {
          ...banded,
          duration: {
            type: "minutes" as const,
            minutes: Math.max(1, resolveDice(parseDiceFormula(banded.hoursRolled), deps.random).total) * 60
          }
        }
      : banded;
    events.push(...applyFailureEffect(state, target.id, onFail, `${commandId}:${saveId}:fail`, immunities));
    if (margin)
      events.push(
        ...applyMarginCompanion(state, target.id, onFail, margin, `${commandId}:${saveId}:margin`, immunities)
      );
  }
  // A rust monster's Antennae: the armor or weapon the failure marks takes a cumulative -1.
  if (!success && pending.objectPenalty)
    events.push(
      ...penalizeRow(state, target.id, pending.objectPenalty.rowId, {
        resolveDefinition: (definitionId) => deps.resolveDefinition(definitionId),
        ...(deps.catalog ? { catalog: deps.catalog } : {})
      })
    );
  // A gibbering mouther's d8 decides what the creature does this turn.
  if (!success && pending.onFailEffect?.tags.includes(GIBBERING_TAG))
    events.push(...gibberingTurn(target, deps.random));
  // A Ring of Spell Turning's success leaves the spell nothing; otherwise what a success leaves instead (Heat Metal's
  // Disadvantage on a creature that keeps hold of the object).
  if (turnedBy !== null)
    events.push({
      kind: "effect",
      text: `${turnedBy} leaves ${spellWords(pending.spell!.id)} no effect on ${target.name}.`,
      actorId: target.id
    });
  if (success && turnedBy === null && pending.onSuccessEffect)
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
  if (!success && pending.failurePush)
    events.push(...forcedMoveOnSave(state, target, pending, pending.failurePush, deps));
  if (success && turnedBy === null && pending.successPush)
    events.push(...forcedMoveOnSave(state, target, pending, pending.successPush, deps));
  if (success && pending.successMovesOut)
    events.push(...moveOutOnSuccess(target, pending, roomOutside ?? undefined, deps));
  if (noRoom)
    events.push({
      kind: "effect",
      text: `${target.name} has no unoccupied space within ${pending.successMovesOut!.withinFeet} feet of ${pending.sourceName} and fails the save instead.`,
      actorId: target.id
    });
  // SRD Mounted Combat: a rider that fails to stay on falls off, Prone beside its mount.
  if (!success && pending.unseats) events.push(...unseat(state, target.id, pending.unseats, deps.placeBeside));
  // Delayed Blast Fireball's bead: fumbled, it goes off where it is; caught, it goes off where it is thrown.
  if (pending.touchedZone) events.push(...settleTouchedZone(state, pending.touchedZone, target, success));
  // "The target dies, and the wisp regains 10 (3d6) Hit Points."
  if (!success && pending.failureKills) events.push(...killOnFailure(state, target, pending, deps));
  // A swallower that fails to hold on lets out what it swallowed.
  if (!success && pending.regurgitates) events.push(...regurgitate(state, target.id, pending.regurgitates.withinFeet));
  // SRD Sleet Storm: a failure "and lose Concentration".
  if (!success && pending.breaksConcentration) events.push(...endConcentrationSustainedBy(state, target.id));
  // Heat Metal: "the target must succeed on a Constitution saving throw or drop the object if it can".
  if (!success && pending.dropsRowId) events.push(...dropHeldRow(target, pending.dropsRowId, immunities));
  // "On a successful save, the spell ends" (Detect Thoughts' probe).
  if (success && pending.successEndsSpell && pending.sourceActorId && pending.spell)
    events.push(...endCasterSpell(state, pending.sourceActorId, pending.spell.id));
  // SRD Moonbeam: a shape-shifted creature that fails "reverts to its true form and can't shape-shift until it leaves".
  if (!success && pending.endsForm) {
    const zone = state.combat.spellZones.find((entry) => entry.id === pending.zoneId);
    const caster = state.actors.find((actor) => actor.id === pending.sourceActorId);
    const castId =
      zone?.castId ??
      caster?.effects.find((effect) => effect.castId !== undefined && effect.spell?.id === pending.spell?.id)?.castId;
    events.push(
      ...revertOnFailure(state, target, {
        sourceActorId: pending.sourceActorId,
        sourceName: pending.sourceName,
        spellName: pending.actionName,
        ...(castId ? { castId } : {}),
        id: `${commandId}:${saveId}:revert`
      })
    );
  }
  if (outcomeCondition)
    conditionApplied = target.conditions.some(
      (condition) =>
        pending.conditionIds.includes(condition.id) || pending.onFailEffect?.linkedConditionIds.includes(condition.id)
    );
  // "Success: The target is immune to this ghast's Stench for 24 hours": on the game clock where the text prints a time.
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
        duration: immunityDuration(pending.immuneMinutes)
      })
    );
  // A repeated save that succeeds ends the effect it was repeated for (Hold Person ends on that target), unless the text
  // counts successes; a failure may count or bring the effect's next stage (a basilisk's second failure).
  if (pending.repeatOf) events.push(...settleEndingSave(state, pending, success, `${commandId}:${saveId}`, immunities));
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
        : {}),
      ...(answered.length > 0 ? { answered } : {}),
      ...(held ? { damageHeld: true as const } : {})
    },
    events
  };
}

/** What an answer to a save needs from the save's own dependencies. */
export function answerDepsOf(
  deps: Pick<
    SaveAnswerDependencies,
    "resolveDefinition" | "catalog" | "random" | "newRollId" | "sessionId" | "role" | "now" | "distanceFeet"
  >,
  commandId: string
): AnswerDeps {
  return {
    resolveDefinition: deps.resolveDefinition,
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    random: deps.random,
    newRollId: deps.newRollId,
    sessionId: deps.sessionId,
    role: deps.role,
    now: deps.now,
    commandId,
    ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
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
