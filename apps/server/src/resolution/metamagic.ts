import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { spellDurationAt, spellRangeFeet, spellSpanOf } from "@vtt/content-srd-5.2.1/spell-effect";
import type { CastShapingOffers, GameState } from "@vtt/domain";
import { parseDiceFormula, resolveDice, type DiceResolution } from "@vtt/rules-5e";
import type { ActorDefinition, CastShaping, CastShapingId, DamageType } from "@vtt/schemas";
import { holdsFeature } from "../class-features.js";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { hasEffectTag, READIED_TAG } from "../effects.js";
import { laterRowOf, ritualSpellActionId } from "../item-actions.js";
import type { RuleId } from "../rules-families.js";
import { sceneSight } from "../vision/sight.js";
import { abilityModifier, recordRoll, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Metamagic ("You use the chosen options to temporarily modify spells you cast. To use an option, you must
 * spend the number of Sorcery Points that it costs. You can use only one Metamagic option on a spell when you cast it
 * unless otherwise noted") and the Evoker's Sculpt Spells. A cast carries its shaping (`ResolveInput.shaping`); the
 * economy checks each pick against the caster's options, the spell and the points left, and spends them. What a pick
 * does reaches the steps that read the spell or the action: the spell's range and duration (Distant, Extended), the
 * action's casting time, attack range and damage type (Quickened, Distant, Transmuted), its level (Twinned), its
 * components (Subtle), its saves (Careful, Heightened, Sculpt Spells) and its damage dice (Empowered). Seeking Spell
 * answers a missed spell attack on its roll instead (`roll-answers.ts`).
 */

/** The Sorcery Points pool every Metamagic option is paid from (Font of Magic). */
export const SORCERY_POINTS = "sorcery-points";
/** Innate Sorcery's effect, which Sorcery Incarnate and Arcane Apotheosis read. */
const INNATE_SORCERY_TAG = "innate-sorcery";
/** The Metamagic option that answers a missed spell attack on its roll. */
export const SEEKING_SPELL = "seeking-spell";

type ShapingRule = Readonly<{ name: string; cost: number; counted: boolean }>;

/** Each way to shape a cast: its name, its Sorcery Point cost, and whether it counts toward the options one spell may
 *  carry ("You can use Empowered Spell even if you've already used a different Metamagic option"). */
export const SHAPINGS: Readonly<Record<CastShapingId, ShapingRule>> = {
  "careful-spell": { name: "Careful Spell", cost: 1, counted: true },
  "distant-spell": { name: "Distant Spell", cost: 1, counted: true },
  "empowered-spell": { name: "Empowered Spell", cost: 1, counted: false },
  "extended-spell": { name: "Extended Spell", cost: 1, counted: true },
  "heightened-spell": { name: "Heightened Spell", cost: 2, counted: true },
  "quickened-spell": { name: "Quickened Spell", cost: 2, counted: true },
  "subtle-spell": { name: "Subtle Spell", cost: 1, counted: true },
  "transmuted-spell": { name: "Transmuted Spell", cost: 1, counted: true },
  "twinned-spell": { name: "Twinned Spell", cost: 1, counted: true },
  "sculpt-spells": { name: "Sculpt Spells", cost: 0, counted: false }
};

/** The Metamagic option ids, Seeking Spell among them. */
const METAMAGIC_IDS: ReadonlySet<string> = new Set([
  ...Object.keys(SHAPINGS).filter((id) => id !== "sculpt-spells"),
  SEEKING_SPELL
]);

/** Whether an action is a Metamagic option's own row on the sheet, which is chosen with a cast and never taken alone. */
export const isMetamagicOption = (actionId: string) => METAMAGIC_IDS.has(actionId);

/** "Acid, Cold, Fire, Lightning, Poison, Thunder." */
const TRANSMUTABLE: readonly DamageType[] = ["acid", "cold", "fire", "lightning", "poison", "thunder"];

type Violation = Readonly<{ rule: RuleId; message: string }>;

/** The shaping a list carries, by id. */
export const shapingOf = (shaping: readonly CastShaping[] | undefined, id: CastShapingId) =>
  shaping?.find((entry) => entry.id === id);

/** Whether the caster can use a way of shaping: a Metamagic option picked under Metamagic, or the Evoker's Sculpt
 *  Spells; on a sheet built elsewhere, a trait printed under the name. */
export function knowsShaping(
  definition: ActorDefinition | undefined,
  id: CastShapingId | typeof SEEKING_SPELL
): boolean {
  if (id === "sculpt-spells") return holdsFeature(definition, "sculpt-spells", "Sculpt Spells");
  const picked = (definition?.character?.features ?? []).some(
    (feature) => feature.kind === "option" && feature.sourceId === "metamagic" && feature.id === id
  );
  return picked || holdsFeature(definition, id, id === SEEKING_SPELL ? "Seeking Spell" : SHAPINGS[id].name);
}

/** The Sorcery Points pool: its size, the largest any action in the pool names, and what is left of it. */
export function sorceryPoints(
  attacker: Pick<LiveActor, "actionUses">,
  siblings: ReadonlyArray<DefinitionAction>
): Readonly<{ limit: number; left: number }> {
  const limit = siblings.reduce(
    (most, action) => (action.uses?.pool === SORCERY_POINTS ? Math.max(most, action.uses.limit) : most),
    0
  );
  return { limit, left: Math.max(0, limit - (attacker.actionUses[SORCERY_POINTS] ?? 0)) };
}

/** SRD Sorcery Incarnate: "while your Innate Sorcery feature is active, you can use up to two of your Metamagic options
 *  on each spell you cast". */
function optionsPerSpell(attacker: LiveActor, definition: ActorDefinition | undefined): number {
  return hasEffectTag(attacker, INNATE_SORCERY_TAG) &&
    holdsFeature(definition, "sorcery-incarnate", "Sorcery Incarnate")
    ? 2
    : 1;
}

/** SRD Arcane Apotheosis: "While your Innate Sorcery feature is active, you can use one Metamagic option on each of your
 *  turns without spending Sorcery Points on it." Whether this turn's free option is still there. */
export function freeOptionReady(
  state: GameState,
  attacker: LiveActor,
  definition: ActorDefinition | undefined
): boolean {
  return (
    state.combat.active &&
    state.combat.turnActorId === attacker.id &&
    state.combat.turn.metamagic?.freeUsed !== true &&
    hasEffectTag(attacker, INNATE_SORCERY_TAG) &&
    holdsFeature(definition, "arcane-apotheosis", "Arcane Apotheosis")
  );
}

/** Marks this turn's free Metamagic option used. */
export function useFreeOption(state: GameState): void {
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, metamagic: { ...state.combat.turn.metamagic, freeUsed: true } }
  };
}

/** How many creatures Careful Spell protects: "up to your Charisma modifier (minimum of one creature)". */
const carefulCount = (definition: ActorDefinition | undefined) => Math.max(1, abilityModifier(definition, "cha"));

/** A spell's duration at a level, in minutes, or null when it has no timed span (Instantaneous, until dispelled). */
function durationMinutes(spell: SpellReference, level: number): number | null {
  const span = spellSpanOf(spellDurationAt(spell, level).duration);
  if (!span) return null;
  return "rounds" in span ? span.rounds / 10 : span.minutes;
}

/** The parts of a spell's damage Transmuted Spell can change. */
const transmutable = (action: Pick<DefinitionAction, "damage">) =>
  action.damage.filter((part) => (TRANSMUTABLE as readonly string[]).includes(part.type));

/** What the cast is, for the checks of each pick. */
type CastFacts = Readonly<{
  state: GameState;
  attacker: LiveActor;
  action: DefinitionAction;
  spell: SpellReference;
  /** The level the spell is cast at: its slot's, else its own. */
  castLevel: number;
  definition: ActorDefinition | undefined;
}>;

/** Why this spell can't take a way of shaping, or null when it can. */
function unfitFor(id: CastShapingId, facts: CastFacts): string | null {
  const { state, attacker, action, spell, castLevel } = facts;
  const name = SHAPINGS[id].name;
  const saves = action.save !== undefined && action.save.bySelf !== true;
  // A spell whose area asks its saves later (Moonbeam) makes creatures save too, which Heightened Spell reaches.
  const savesLater = (spell.effect?.laterActions ?? []).some((row) => row.zone !== undefined && row.save !== undefined);
  switch (id) {
    case "careful-spell":
      return saves ? null : `${name} shapes a spell that makes creatures save, and ${spell.name} doesn't.`;
    case "heightened-spell":
      return saves || savesLater
        ? null
        : `${name} shapes a spell that makes creatures save, and ${spell.name} doesn't.`;
    case "sculpt-spells":
      if (spell.school !== "evocation") return `${name} shapes an Evocation spell, and ${spell.name} isn't one.`;
      return saves ? null : `${name} shapes a spell that makes creatures save, and ${spell.name} doesn't.`;
    case "distant-spell":
      return spellRangeFeet(printedSpell(spell).range) !== null ||
        /^touch\b/i.test(printedSpell(spell).range.text ?? "")
        ? null
        : `${name} needs a spell with a range of 5 feet or more, or Touch.`;
    case "empowered-spell":
      return action.damage.some((part) => /\d+d\d+/i.test(part.formula))
        ? null
        : `${name} rerolls damage dice, and ${spell.name} rolls none.`;
    case "extended-spell": {
      const minutes = durationMinutes(printedSpell(spell), castLevel);
      return minutes !== null && minutes >= 1 && minutes < 24 * 60
        ? null
        : `${name} doubles a duration of 1 minute or longer up to 24 hours, and ${spell.name} has none it can double.`;
    }
    case "quickened-spell":
      if (!/^action\b/i.test(spell.castingTime.trim()) || action.id === ritualSpellActionId(spell.id))
        return `${name} changes a casting time of an action, and ${spell.name} isn't cast with one.`;
      if (!state.combat.active || state.combat.turnActorId !== attacker.id)
        return `${name} is used on ${attacker.name}'s own turn in a fight.`;
      return state.combat.turn.metamagic?.leveledCast === true
        ? `${attacker.name} already cast a level 1+ spell this turn, so ${name} can't shape another.`
        : null;
    case "subtle-spell": {
      const { verbal, somatic, material, costly } = spell.components;
      return verbal || somatic || (material && (costly ?? []).length === 0)
        ? null
        : `${spell.name} has no Verbal, Somatic or Material component ${name} can leave out.`;
    }
    case "transmuted-spell":
      if (action.damageTypes !== undefined)
        return `${attacker.name} already chooses ${spell.name}'s damage type, so ${name} changes nothing.`;
      return transmutable(action).length > 0
        ? null
        : `${name} changes Acid, Cold, Fire, Lightning, Poison or Thunder damage, and ${spell.name} deals none.`;
    case "twinned-spell":
      if ((spell.effect?.targets?.perSlot ?? 0) <= 0)
        return `${name} raises a spell that targets another creature at a higher level, and ${spell.name} doesn't.`;
      return castLevel >= 9 ? `${name} can't raise ${spell.name} above level 9.` : null;
  }
}

/** The types Transmuted Spell can change this spell's damage to: the listed types it doesn't already deal. */
function transmutedTypes(action: DefinitionAction): DamageType[] {
  const dealt = new Set(transmutable(action).map((part) => part.type));
  return TRANSMUTABLE.filter((type) => !(dealt.size === 1 && dealt.has(type)));
}

/** The open instance a later ray of this spell continues (Scorching Ray's second ray, an Eldritch Blast beam), on its
 *  caster's turn, or null when this resolve casts the spell anew. */
export function castInstanceOf(
  state: GameState,
  attacker: Pick<LiveActor, "id">,
  action: Pick<DefinitionAction, "id" | "spellId">
): Readonly<{ shaping?: readonly CastShaping[] }> | null {
  if (action.spellId === undefined || !state.combat.active || state.combat.turnActorId !== attacker.id) return null;
  const turn = state.combat.turn;
  const opened = [
    turn.actionUsed ? turn.actionInstance : null,
    turn.bonusActionUsed ? turn.bonusActionInstance : null
  ].find((open) => open?.actorId === attacker.id && (open.components[action.id] ?? 0) > 0);
  return opened ?? null;
}

/** How a resolve is shaped: a later ray keeps its cast's shaping, a readied spell's release the shaping it was readied
 *  with, and anything else takes what it was sent with. */
export function shapingInForce(
  state: GameState,
  action: Pick<DefinitionAction, "id" | "spellId">,
  input: Readonly<{ actorId: string; shaping?: readonly CastShaping[] }>
): readonly CastShaping[] {
  if (action.spellId === undefined) return [];
  const open = castInstanceOf(state, { id: input.actorId }, action);
  if (open) return open.shaping ?? [];
  const caster = state.actors.find((actor) => actor.id === input.actorId);
  const readied =
    state.combat.active && state.combat.turnActorId !== input.actorId
      ? caster?.effects.find(
          (effect) => effect.tags.includes(READIED_TAG) && effect.readiedSpell?.actionId === action.id
        )?.readiedSpell
      : undefined;
  return readied ? (readied.shaping ?? []) : (input.shaping ?? []);
}

/** The level a cast counts as: Twinned Spell's "increase the spell's effective level by 1". */
export const levelBonusOf = (shaping: readonly CastShaping[] | undefined) =>
  shapingOf(shaping, "twinned-spell") ? 1 : 0;

/** What a resolve's shaping costs and changes in the turn's bookkeeping, committed with the economy. */
export type ShapingPlan = Readonly<{
  /** Sorcery Points spent now; Empowered Spell's point is spent when its dice are rerolled. */
  points: number;
  /** Arcane Apotheosis's free option is used. */
  free: boolean;
  /** No further level 1+ spell this turn (Quickened Spell). */
  quickened: boolean;
}>;

/**
 * Checks a cast's shaping: each pick is one its caster knows and the spell can take, with the creatures and type it
 * names; no more counted options than one spell may carry; and the Sorcery Points to pay, less this turn's free option.
 * Also the turn's own rule: after Quickened Spell, no level 1+ spell this turn. Returns the violations and the plan.
 */
export function shapingCheck(
  facts: CastFacts &
    Readonly<{
      shaping: readonly CastShaping[];
      targetIds: readonly string[];
      siblings: ReadonlyArray<DefinitionAction>;
      resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
      catalog: EquipmentCatalog | undefined;
    }>
): { violations: Violation[]; plan: ShapingPlan | null } {
  const { state, attacker, spell, shaping, definition } = facts;
  const violations: Violation[] = [];
  const turnActor = state.combat.active && state.combat.turnActorId === attacker.id;
  if (spell.level >= 1 && turnActor && state.combat.turn.metamagic?.quickened === true)
    violations.push({
      rule: "metamagic.quickened",
      message: `${attacker.name} used Quickened Spell this turn, so no other level 1+ spell can be cast until the turn ends.`
    });
  if (shaping.length === 0) return { violations, plan: null };
  for (const entry of shaping) {
    const name = SHAPINGS[entry.id].name;
    if (!knowsShaping(definition, entry.id)) {
      violations.push({
        rule: "metamagic.unknown",
        message:
          entry.id === "sculpt-spells"
            ? `${attacker.name} doesn't have Sculpt Spells.`
            : `${attacker.name} doesn't know the Metamagic option ${name}.`
      });
      continue;
    }
    const unfit = unfitFor(entry.id, facts);
    if (unfit !== null) violations.push({ rule: "metamagic.unfit", message: unfit });
    else violations.push(...choiceViolations(entry, facts));
  }
  const counted = shaping.filter((entry) => SHAPINGS[entry.id].counted);
  const allowed = optionsPerSpell(attacker, definition);
  if (counted.length > allowed)
    violations.push({
      rule: "metamagic.too-many",
      message:
        allowed === 1
          ? `${attacker.name} can use one Metamagic option on a spell (Empowered Spell aside).`
          : `${attacker.name} can use two Metamagic options on a spell while Innate Sorcery is active.`
    });
  // The turn's free option waives the dearest counted option; with none counted it is left for Empowered Spell.
  const freeReady = freeOptionReady(state, attacker, definition);
  const free = freeReady && counted.length > 0;
  const costs = counted.map((entry) => SHAPINGS[entry.id].cost);
  const points = costs.reduce((sum, cost) => sum + cost, 0) - (free ? Math.max(...costs) : 0);
  // Empowered Spell's point is spent with its reroll, so it is only held back here.
  const empoweredPoint = shapingOf(shaping, "empowered-spell") !== undefined && !(freeReady && !free) ? 1 : 0;
  const needed = points + empoweredPoint;
  const { left } = sorceryPoints(attacker, facts.siblings);
  if (needed > left)
    violations.push({
      rule: "feature.no-uses-remaining",
      message: `${attacker.name} has ${left} Sorcery ${left === 1 ? "Point" : "Points"} left, and this cast's Metamagic costs ${needed}.`
    });
  return {
    violations,
    plan: { points, free, quickened: shapingOf(shaping, "quickened-spell") !== undefined }
  };
}

/** The creatures and the type a pick names, checked against the cast. */
function choiceViolations(
  entry: CastShaping,
  facts: CastFacts &
    Readonly<{
      targetIds: readonly string[];
      resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
      catalog: EquipmentCatalog | undefined;
    }>
): Violation[] {
  const { state, attacker, action, spell, definition, castLevel } = facts;
  const name = SHAPINGS[entry.id].name;
  const chosen = [...new Set(entry.creatureIds ?? [])];
  const nameOf = (id: string) => state.actors.find((actor) => actor.id === id)?.name ?? "That creature";
  switch (entry.id) {
    case "careful-spell":
    case "sculpt-spells": {
      const limit = entry.id === "careful-spell" ? carefulCount(definition) : 1 + castLevel;
      if (chosen.length === 0) return [{ rule: "metamagic.choice", message: `Choose who ${name} protects.` }];
      if (chosen.length > limit)
        return [
          {
            rule: "metamagic.choice",
            message: `${name} protects up to ${limit} ${limit === 1 ? "creature" : "creatures"}; ${chosen.length} were chosen.`
          }
        ];
      if (chosen.includes(attacker.id))
        return [{ rule: "metamagic.choice", message: `${name} protects other creatures. Leave ${attacker.name} out.` }];
      // Sculpt Spells: "other creatures that you can see", when the map's vision says who the caster sees.
      if (entry.id === "sculpt-spells") {
        const sight = sceneSight(state, {
          ...(facts.resolveDefinition ? { definition: facts.resolveDefinition } : {}),
          ...(facts.catalog ? { catalog: facts.catalog } : {})
        });
        const unseen = sight.enabled ? chosen.find((id) => !sight.sees(attacker.id, id)) : undefined;
        if (unseen !== undefined)
          return [
            { rule: "metamagic.choice", message: `${attacker.name} can't see ${nameOf(unseen)} to sculpt it out.` }
          ];
      }
      return [];
    }
    case "heightened-spell": {
      const target = heightenedTargetOf(entry, facts.targetIds);
      if (target === null)
        return [{ rule: "metamagic.choice", message: `Choose the one target ${name} gives Disadvantage.` }];
      // A readied spell has no targets until it is released.
      return facts.targetIds.length === 0 || facts.targetIds.includes(target)
        ? []
        : [{ rule: "metamagic.choice", message: `${nameOf(target)} isn't one of ${spell.name}'s targets.` }];
    }
    case "transmuted-spell": {
      const type = entry.damageType;
      if (type === undefined || !transmutedTypes(action).includes(type))
        return [
          {
            rule: "metamagic.choice",
            message: `Choose the type ${name} changes ${spell.name}'s damage to: ${transmutedTypes(action).join(", ")}.`
          }
        ];
      return [];
    }
    default:
      return [];
  }
}

/** The one target Heightened Spell names: the chosen creature, or a spell's only target. */
function heightenedTargetOf(entry: CastShaping, targetIds: readonly string[]): string | null {
  const chosen = entry.creatureIds ?? [];
  if (chosen.length === 1) return chosen[0]!;
  const unique = [...new Set(targetIds)];
  return chosen.length === 0 && unique.length === 1 ? unique[0]! : null;
}

/** What the sheet's cast offers for a spell: the ways its caster may shape it, with what each costs and why it can't
 *  shape this spell now. Undefined for a caster with none, or an action that casts nothing new. */
export function shapingOffers(
  state: GameState,
  attacker: LiveActor,
  action: DefinitionAction,
  spell: SpellReference | undefined,
  definition: ActorDefinition | undefined,
  siblings: ReadonlyArray<DefinitionAction>
): CastShapingOffers | undefined {
  if (!spell || action.spellId !== spell.id || laterRowOf(spell, action.id) !== undefined) return undefined;
  const ids = (Object.keys(SHAPINGS) as CastShapingId[]).filter(
    (id) => knowsShaping(definition, id) && (id !== "sculpt-spells" || spell.school === "evocation")
  );
  if (ids.length === 0) return undefined;
  const points = sorceryPoints(attacker, siblings);
  const free = freeOptionReady(state, attacker, definition);
  const facts: CastFacts = {
    state,
    attacker,
    action,
    spell,
    castLevel: action.spellSlot?.level ?? spell.level,
    definition
  };
  return {
    limit: optionsPerSpell(attacker, definition),
    points: points.left,
    ...(free ? { free: true as const } : {}),
    options: ids.map((id) => {
      const rule = SHAPINGS[id];
      const unfit = unfitFor(id, facts);
      const reason = unfit ?? (rule.cost > points.left && !free ? "Not enough Sorcery Points." : undefined);
      return {
        id,
        name: rule.name,
        cost: rule.cost,
        available: reason === undefined,
        ...(reason !== undefined ? { reason } : {}),
        counted: rule.counted,
        ...(id === "careful-spell" ? { creatures: { count: carefulCount(definition) } } : {}),
        ...(id === "sculpt-spells" ? { creatures: { count: 1 + facts.castLevel, plusLevel: true as const } } : {}),
        ...(id === "heightened-spell" ? { creatures: { count: 1 } } : {}),
        ...(id === "transmuted-spell" && unfit === null ? { damageTypes: transmutedTypes(action) } : {})
      };
    })
  };
}

/** Doubles a duration printed in minutes or rounds, up to 24 hours (Extended Spell). */
function extendedText(minutes: number): string {
  return `${Math.min(24 * 60, minutes * 2)} minutes`;
}

/** The spell as this casting shapes it: Distant Spell's doubled range (a Touch spell's 30 feet) and Extended Spell's
 *  doubled duration, at every level its higher-level rows reach. */
export function shapedSpell(spell: SpellReference, shaping: readonly CastShaping[]): SpellReference {
  let shaped = spell;
  const touch = /^touch\b/i.test(spell.range.text ?? "");
  if (shapingOf(shaping, "distant-spell") && (spellRangeFeet(spell.range) !== null || touch)) {
    const feet = spellRangeFeet(spell.range);
    const range =
      feet !== null
        ? { ...spell.range, distance: feet * 2, text: `${feet * 2} feet` }
        : { ...spell.range, unit: "feet" as const, distance: 30, text: "30 feet" };
    const attackRange = spell.effect?.attackRange;
    shaped = {
      ...shaped,
      range,
      ...(shaped.effect && attackRange
        ? {
            effect: {
              ...shaped.effect,
              attackRange: { ...attackRange, feet: feet !== null ? attackRange.feet * 2 : 30 }
            }
          }
        : {})
    };
  }
  if (shapingOf(shaping, "extended-spell")) {
    const doubled = (duration: string) => {
      const span = spellSpanOf(duration);
      if (!span) return duration;
      return extendedText("rounds" in span ? span.rounds / 10 : span.minutes);
    };
    shaped = {
      ...shaped,
      duration: doubled(shaped.duration),
      ...(shaped.upcastDurations
        ? { upcastDurations: shaped.upcastDurations.map((row) => ({ ...row, duration: doubled(row.duration) })) }
        : {})
    };
  }
  return shaped;
}

/** A duration an action carries in rounds or minutes, doubled when it is the spell's own (Bless's 10 rounds are its
 *  1 minute); a shorter one (until the end of the next turn) is the effect's, which Extended Spell leaves alone. */
function extendedDuration<T extends { type: string }>(duration: T, spellMinutes: number | null): T {
  if (spellMinutes === null) return duration;
  const minutes =
    duration.type === "rounds"
      ? (duration as unknown as { rounds: number }).rounds / 10
      : duration.type === "minutes"
        ? (duration as unknown as { minutes: number }).minutes
        : null;
  if (minutes !== spellMinutes) return duration;
  const doubled = Math.min(24 * 60, minutes * 2);
  return (doubled <= 10
    ? { type: "rounds", rounds: doubled * 10 }
    : { type: "minutes", minutes: doubled }) as unknown as T;
}

/** The action as this casting shapes it before its economy is checked: Quickened Spell's Bonus Action and Distant
 *  Spell's attack range. */
export function shapedAction(action: DefinitionAction, shaping: readonly CastShaping[]): DefinitionAction {
  if (action.spellId === undefined || shaping.length === 0) return action;
  let shaped = action;
  if (shapingOf(shaping, "quickened-spell") && shaped.activation === "action")
    shaped = { ...shaped, activation: "bonus-action" };
  const attack = shaped.attack;
  if (shapingOf(shaping, "distant-spell") && attack) {
    shaped =
      attack.rangeFeet !== undefined
        ? {
            ...shaped,
            attack: {
              ...attack,
              rangeFeet: attack.rangeFeet * 2,
              ...(attack.rangeNormalFeet !== undefined ? { rangeNormalFeet: attack.rangeNormalFeet * 2 } : {})
            }
          }
        : attack.reachFeet !== undefined
          ? { ...shaped, attack: { ...attack, reachFeet: Math.max(30, attack.reachFeet) } }
          : shaped;
  }
  return shaped;
}

/** What the shaping changes in what the cast deals and leaves, once its picks are checked against the spell as
 *  printed: Transmuted Spell's damage type, and Extended Spell's doubled durations on what the cast grants or imposes.
 *  `spell` is the spell as printed. */
export function shapedOutcome(
  action: DefinitionAction,
  spell: SpellReference | undefined,
  shaping: readonly CastShaping[],
  level: number | null
): DefinitionAction {
  if (!spell || shaping.length === 0) return action;
  let shaped = action;
  const transmuted = shapingOf(shaping, "transmuted-spell")?.damageType;
  if (transmuted !== undefined)
    shaped = {
      ...shaped,
      damage: shaped.damage.map((part) =>
        (TRANSMUTABLE as readonly string[]).includes(part.type) ? { ...part, type: transmuted } : part
      )
    };
  if (shapingOf(shaping, "extended-spell")) {
    const minutes = durationMinutes(spell, level ?? spell.level);
    const grants = shaped.grants;
    const save = shaped.save;
    shaped = {
      ...shaped,
      ...(grants ? { grants: { ...grants, duration: extendedDuration(grants.duration, minutes) } } : {}),
      ...(save
        ? {
            save: {
              ...save,
              ...(save.failureDuration ? { failureDuration: extendedDuration(save.failureDuration, minutes) } : {}),
              ...(save.failureEffect?.duration
                ? {
                    failureEffect: {
                      ...save.failureEffect,
                      duration: extendedDuration(save.failureEffect.duration, minutes)
                    }
                  }
                : {})
            }
          }
        : {})
    };
  }
  return shaped;
}

/** Each shaped spell's printed record, for the checks of what a spell can take. */
const printed = new WeakMap<SpellReference, SpellReference>();

/** The spell as printed, under any shaping of this cast. */
export const printedSpell = (spell: SpellReference): SpellReference => printed.get(spell) ?? spell;

/** The catalog a shaped cast reads: its spell as the shaping makes it (Distant Spell, Extended Spell), so every step
 *  that reads the spell's range or duration reads the shaped one. */
export function withShapedSpell<
  D extends Readonly<{ catalog?: { spellRecord?: (id: string) => SpellReference | undefined } }>
>(deps: D, spellId: string | undefined, shaping: readonly CastShaping[]): D {
  const lookup = deps.catalog?.spellRecord;
  if (spellId === undefined || !lookup) return deps;
  if (!shapingOf(shaping, "distant-spell") && !shapingOf(shaping, "extended-spell")) return deps;
  const spell = lookup(spellId);
  if (!spell) return deps;
  const shaped = shapedSpell(spell, shaping);
  printed.set(shaped, spell);
  return { ...deps, catalog: { ...deps.catalog, spellRecord: (id: string) => (id === spellId ? shaped : lookup(id)) } };
}

/** The creatures this cast's save leaves alone, each with what protects it: Careful Spell's and Sculpt Spells' chosen
 *  creatures, which "automatically succeed" on it and take no damage. Only the cast's own targets count. */
export function shieldedFromSave(ctx: Pick<ResolveContext, "input" | "targets">): Map<string, string> {
  const shielded = new Map<string, string>();
  const targetIds = new Set(ctx.targets.map((target) => target.id));
  for (const id of ["careful-spell", "sculpt-spells"] as const)
    for (const creatureId of shapingOf(ctx.input.shaping, id)?.creatureIds ?? [])
      if (targetIds.has(creatureId) && !shielded.has(creatureId)) shielded.set(creatureId, SHAPINGS[id].name);
  return shielded;
}

/** The target Heightened Spell gives Disadvantage on its saves against the spell, or null. */
export function heightenedTarget(ctx: Pick<ResolveContext, "input" | "targets">): string | null {
  const entry = shapingOf(ctx.input.shaping, "heightened-spell");
  if (!entry) return null;
  const target = heightenedTargetOf(
    entry,
    ctx.targets.map((creature) => creature.id)
  );
  return target !== null && ctx.targets.some((creature) => creature.id === target) ? target : null;
}

/** What a cast's shaping leaves on the area it opens (`SpellZone`): Transmuted Spell's type for damage of the listed
 *  types, and Heightened Spell's target, whose saves there have Disadvantage too. */
export function shapedZone(
  ctx: Pick<ResolveContext, "input" | "targets">,
  damage: ReadonlyArray<Readonly<{ type: string }>>
): Readonly<{ damageType?: string; heightened?: string }> {
  const type = shapingOf(ctx.input.shaping, "transmuted-spell")?.damageType;
  const transmutes =
    type !== undefined &&
    damage.length > 0 &&
    damage.every((part) => (TRANSMUTABLE as readonly string[]).includes(part.type));
  const heightened = heightenedTarget(ctx);
  return { ...(transmutes ? { damageType: type } : {}), ...(heightened !== null ? { heightened } : {}) };
}

/** What Empowered Spell has left to reroll in each resolve, and whether its point is paid. */
const empowerment = new WeakMap<ResolveContext, { left: number; paid: boolean }>();

/**
 * SRD Empowered Spell: "When you roll damage for a spell, you can spend 1 Sorcery Point to reroll a number of the
 * damage dice up to your Charisma modifier (minimum of one), and you must use the new rolls." Chosen with the cast, the
 * server rerolls the dice for the caster: the lowest that rolled under their die's average, as many as the modifier
 * allows across the cast's damage. The point is spent with the first reroll (free with Arcane Apotheosis's option).
 */
export function empowered(ctx: ResolveContext, rolled: DiceResolution): DiceResolution {
  const { input, action, attacker, state, deps } = ctx;
  if (action.spellId === undefined || !shapingOf(input.shaping, "empowered-spell")) return rolled;
  const budget = empowerment.get(ctx) ?? { left: Math.max(1, abilityModifier(deps.definition, "cha")), paid: false };
  empowerment.set(ctx, budget);
  if (budget.left <= 0) return rolled;
  const low: Array<{ term: number; die: number; face: number }> = [];
  rolled.terms.forEach((term, termIndex) => {
    if (term.kind !== "dice" || term.sign !== 1) return;
    term.dice.forEach((die, dieIndex) => {
      if (die.kept && die.face < (term.sides + 1) / 2) low.push({ term: termIndex, die: dieIndex, face: die.face });
    });
  });
  const picked = low.sort((left, right) => left.face - right.face).slice(0, budget.left);
  if (picked.length === 0) return rolled;
  const again = new Set(picked.map((entry) => `${entry.term}:${entry.die}`));
  const faces: number[] = [];
  rolled.terms.forEach((term, termIndex) => {
    if (term.kind !== "dice") return;
    term.dice.forEach((die, dieIndex) =>
      faces.push(again.has(`${termIndex}:${dieIndex}`) ? deps.random(term.sides) : die.face)
    );
  });
  const rerolled = resolveDice(parseDiceFormula(rolled.expression.source), () => faces.shift()!);
  recordRoll(ctx, rerolled, "damage", `${action.name}: Empowered Spell`);
  budget.left -= picked.length;
  if (!budget.paid) {
    budget.paid = true;
    const definition = deps.definition;
    if (freeOptionReady(state, attacker, definition)) useFreeOption(state);
    else
      attacker.actionUses = {
        ...attacker.actionUses,
        [SORCERY_POINTS]: (attacker.actionUses[SORCERY_POINTS] ?? 0) + 1
      };
    ctx.warnings.push(
      `Empowered Spell rerolls ${picked.length} of ${action.name}'s damage ${picked.length === 1 ? "die" : "dice"}.`
    );
  }
  return rerolled;
}

/** Commits a shaping plan with the economy: its Sorcery Points, this turn's free option, and Quickened Spell's turn. A
 *  level 1+ spell its turn's creature casts is marked too, which Quickened Spell reads. */
export function commitShaping(
  state: GameState,
  attacker: LiveActor,
  plan: ShapingPlan | null | undefined,
  leveledCast: boolean
): void {
  if (plan && plan.points > 0)
    attacker.actionUses = {
      ...attacker.actionUses,
      [SORCERY_POINTS]: (attacker.actionUses[SORCERY_POINTS] ?? 0) + plan.points
    };
  if (!state.combat.active || state.combat.turnActorId !== attacker.id) return;
  const marks = {
    ...(leveledCast ? { leveledCast: true as const } : {}),
    ...(plan?.quickened ? { quickened: true as const } : {}),
    ...(plan?.free ? { freeUsed: true as const } : {})
  };
  if (Object.keys(marks).length === 0) return;
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, metamagic: { ...state.combat.turn.metamagic, ...marks } }
  };
}
