import type { GameState } from "@vtt/domain";
import { GIBBERING_TAG } from "./random-outcomes.js";
import { parseDiceFormula, resolveDice, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition, TraitMechanic } from "@vtt/schemas";
import { conditionLabel, isIncapacitated } from "./condition-rules.js";
import { areEnemies } from "./creature-sides.js";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { HAZARDS } from "./hazards.js";
import { applyDamageDetailed, damageAdjustmentDetail, healActor } from "./hit-points.js";
import { DISTANCE_TOLERANCE_FEET } from "./movement-narration.js";
import { applyFailureEffect, createPendingSaves } from "./saving-throws.js";
import { insideAnObject } from "./wall-passage.js";
import { creatureTypeOf } from "./statblock-facts.js";
import type { SightContent } from "./vision/senses.js";
import { sightRules } from "./vision/rules.js";
import {
  AURA_IMMUNE_TAG,
  REGENERATING_AT_ZERO_TAG,
  REGENERATION_STOPPED_TAG,
  traitActionId,
  traitMechanicsOf,
  traitOf
} from "./statblock-traits.js";

/**
 * What a stat block's traits do as turns start and end (`ActorDefinition.traitMechanics`): Regeneration and Berserk at
 * the start of the creature's own turn, Barbed Hide on what it grapples, the auras another creature starts its turn
 * in (Stench, Fear Aura, Gibbering) and the ones that burn at the end of the bearer's turn (Fire Aura, Heat Aura).
 * Called from `turn-boundaries.ts`.
 */

type Actor = GameState["actors"][number];
type Aura = Extract<TraitMechanic, { kind: "aura" }>;

export type TraitTurnDeps = Readonly<{
  rollDie: RandomSource;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  /** Creature-to-creature distance on the map; without it no aura reaches anyone, and the GM is told. */
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  newId?: () => string;
  now?: () => string;
}>;

/** A golem gone berserk: it attacks the nearest creature it can see until it is no longer Bloodied. */
export const BERSERK_TAG = "berserk";

const definitionOf = (actor: Actor, deps: TraitTurnDeps) =>
  actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
const fighting = (state: GameState) =>
  state.combat.initiative.flatMap((entry) => state.actors.filter((actor) => actor.id === entry.actorId));
const bloodied = (actor: Actor) => actor.hp.current > 0 && actor.hp.current * 2 <= actor.hp.maximum;

/** The start of `actorId`'s turn: its own Regeneration, Berserk and Barbed Hide, then the auras it starts its turn
 *  in. */
export function traitsAtTurnStart(state: GameState, actorId: string, deps: TraitTurnDeps): EffectNarration[] {
  return [
    ...ownTraitsAtTurnStart(state, actorId, deps).flatMap((trait) => trait.run()),
    ...aurasAtTurnStart(state, actorId, deps)
  ];
}

/** One trait's part of a turn's start or end, run on its own so the turn's controller can order it among the turn's
 *  other steps. */
export type TraitStep = Readonly<{ name: string; run: () => EffectNarration[] }>;

/** The traits of `actorId`'s own stat block that act as its turn starts, each only when it would do something now:
 *  Regeneration, Berserk, Barbed Hide and Sunlight. */
export function ownTraitsAtTurnStart(state: GameState, actorId: string, deps: TraitTurnDeps): TraitStep[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const definition = definitionOf(actor, deps);
  // Each runs against the creature as it is when its turn in the order comes.
  const step = (name: string, body: (now: Actor, events: EffectNarration[]) => void): TraitStep => ({
    name,
    run: () => {
      const now = state.actors.find((candidate) => candidate.id === actorId);
      if (!now) return [];
      const events: EffectNarration[] = [];
      body(now, events);
      return events;
    }
  });
  const steps: TraitStep[] = [];
  const regeneration = traitOf(definition, "regeneration");
  if (regeneration && regenerationActs(actor))
    steps.push(step(regeneration.name, (now, events) => regenerate(state, now, definition, events)));
  const berserk = traitOf(definition, "berserk");
  const raging = actor.effects.some((effect) => effect.tags.includes(BERSERK_TAG));
  if (berserk && actor.hp.current > 0 && raging !== bloodied(actor))
    steps.push(step(berserk.name, (now, events) => goBerserk(state, now, definition, deps, events)));
  for (const aura of traitMechanicsOf(definition))
    if (aura.kind === "aura" && aura.trigger === "bearer-turn-start" && grapplePartners(state, actor, aura).length > 0)
      steps.push(step(aura.name, (now, events) => grappleDamage(state, now, aura, deps, events)));
  const sunlight = traitMechanicsOf(definition).find(
    (trait) => trait.kind === "light-sensitivity" && trait.damageAtTurnStart !== undefined
  );
  if (
    sunlight &&
    actor.hp.current > 0 &&
    sightRules(state, sightContentOf(deps), deps.distanceFeet).lightAt(actor.id)?.sunlight === true
  )
    steps.push(step(sunlight.name, (now, events) => burnInSunlight(state, now, definition, deps, events)));
  return steps;
}

/** Whether Regeneration does anything as this turn starts: Hit Points to regain, or a stopped one that leaves a
 *  creature at 0 Hit Points dead. */
function regenerationActs(actor: Actor): boolean {
  const stopped = actor.effects.some((effect) => effect.tags.includes(REGENERATION_STOPPED_TAG));
  const down = actor.effects.some((effect) => effect.tags.includes(REGENERATING_AT_ZERO_TAG));
  if (actor.hp.current <= 0 && !down) return false;
  return stopped || actor.hp.current < actor.hp.maximum;
}

/** The saves of the auras `actorId` starts its turn in (Stench, Fear Aura, Gibbering). */
export function aurasAtTurnStart(state: GameState, actorId: string, deps: TraitTurnDeps): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [];
  aurasStartedIn(state, actor, deps, events);
  return events;
}

const sightContentOf = (deps: TraitTurnDeps): SightContent => ({
  definition: deps.resolveDefinition,
  ...(deps.catalog ? { catalog: deps.catalog } : {})
});

/** A vampire's Sunlight: "The vampire takes 20 Radiant damage if it starts its turn in sunlight", read from where it
 *  stands with dynamic vision on (with it off, the light is the GM's). */
function burnInSunlight(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: TraitTurnDeps,
  events: EffectNarration[]
): void {
  const burning = traitMechanicsOf(definition).filter(
    (trait) => trait.kind === "light-sensitivity" && trait.damageAtTurnStart !== undefined
  );
  if (burning.length === 0 || actor.hp.current <= 0) return;
  if (sightRules(state, sightContentOf(deps), deps.distanceFeet).lightAt(actor.id)?.sunlight !== true) return;
  for (const trait of burning)
    if (trait.kind === "light-sensitivity" && trait.damageAtTurnStart)
      events.push(
        ...dealTraitDamage(state, actor, actor, trait.name, [{ ...trait.damageAtTurnStart }], deps, {
          fromSunlight: true
        })
      );
}

/** The end of `actorId`'s turn: its auras that burn what is near it, or ask a save of it (Mucus Cloud). */
export function traitsAtTurnEnd(state: GameState, actorId: string, deps: TraitTurnDeps): EffectNarration[] {
  return [
    ...aurasSavingAtTurnEnd(state, actorId, deps),
    ...burningTraitsAtTurnEnd(state, actorId, deps).flatMap((trait) => trait.run()),
    // A ghost that ends its turn in a wall (Incorporeal Movement).
    ...insideAnObject(state, actorId, {
      resolveDefinition: deps.resolveDefinition,
      rollDie: deps.rollDie,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.newId ? { newId: deps.newId } : {}),
      ...(deps.now ? { now: deps.now } : {})
    })
  ];
}

/** The auras that burn what is near `actorId` as its turn ends (Fire Aura, Heat Aura), each only when it reaches
 *  someone or the map can't say. */
export function burningTraitsAtTurnEnd(state: GameState, actorId: string, deps: TraitTurnDeps): TraitStep[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  return endAuras(state, actor, deps)
    .filter(
      (aura) =>
        !aura.save && aura.damage && auraActive(actor, aura) && (reached(state, actor, aura, deps)?.length ?? 1) > 0
    )
    .map((aura) => ({
      name: aura.name,
      run: () => {
        const now = state.actors.find((candidate) => candidate.id === actorId);
        const events: EffectNarration[] = [];
        if (now) burnAround(state, now, aura, deps, events);
        return events;
      }
    }));
}

/** The auras that ask a save of what is near `actorId` as its turn ends (Mucus Cloud): prompts, answered in any
 *  order. */
export function aurasSavingAtTurnEnd(state: GameState, actorId: string, deps: TraitTurnDeps): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return [];
  const events: EffectNarration[] = [];
  for (const aura of endAuras(state, actor, deps)) if (aura.save) saveAround(state, actor, aura, deps, events);
  return events;
}

function endAuras(state: GameState, actor: Actor, deps: TraitTurnDeps): Aura[] {
  return traitMechanicsOf(definitionOf(actor, deps)).filter(
    (aura): aura is Aura =>
      aura.kind === "aura" &&
      aura.trigger === "bearer-turn-end" &&
      // "While underwater": only in an underwater fight.
      (!aura.underwaterOnly || state.combat.underwater)
  );
}

/** "Constitution Saving Throw: DC 14, each creature in a 5-foot Emanation originating from the aboleth at the end of
 *  the aboleth's turn": a save for each creature in reach, its failure the trait's declared effect. */
function saveAround(state: GameState, bearer: Actor, aura: Aura, deps: TraitTurnDeps, events: EffectNarration[]) {
  if (!aura.save || !auraActive(bearer, aura) || !deps.newId) return;
  const targets = reached(state, bearer, aura, deps);
  if (targets === null) {
    events.push({
      kind: "effect",
      text: `${bearer.name}'s ${aura.name}: each creature within ${aura.rangeFeet} feet makes a DC ${aura.save.dc} ${aura.save.ability.toUpperCase()} save. The map can't measure, so call for it by hand.`,
      actorId: bearer.id,
      gmOnly: true
    });
    return;
  }
  if (targets.length === 0) return;
  const save = aura.save;
  const declared = save.failureEffect;
  createPendingSaves(state, {
    sourceActorId: bearer.id,
    sourceName: bearer.name,
    actionName: aura.name,
    ability: save.ability,
    dc: save.dc,
    targetIds: targets.map((target) => target.id),
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: save.failureConditions,
    ...(declared
      ? {
          onFailEffect: {
            name: `${declared.name} by ${bearer.name}`.slice(0, 120),
            tags: [...declared.tags],
            linkedConditionIds: save.failureConditions.filter((id) => id !== "prone"),
            escapeDc: null,
            sourceActorId: bearer.id,
            sourceName: bearer.name,
            sourceActionId: traitActionId(aura.name),
            modifiers: [...declared.modifiers]
          }
        }
      : {}),
    newSaveId: deps.newId,
    createdAt: Date.parse((deps.now ?? (() => new Date().toISOString()))())
  });
  events.push({
    kind: "condition",
    text: `${bearer.name}'s ${aura.name}: ${targets.map((target) => target.name).join(", ")} ${targets.length === 1 ? "makes" : "make"} a DC ${save.dc} ${save.ability.toUpperCase()} save.`,
    actorId: bearer.id
  });
  if (aura.reminder)
    events.push({
      kind: "effect",
      text: `${bearer.name}'s ${aura.name}: ${aura.reminder}`,
      actorId: bearer.id,
      gmOnly: true
    });
}

/**
 * SRD Regeneration: "The troll regains 15 Hit Points at the start of each of its turns. If the troll takes Acid or
 * Fire damage, this trait doesn't function on the troll's next turn. The troll dies only if it starts its turn with
 * 0 Hit Points and doesn't regenerate." The oni's needs at least 1 Hit Point, and a monster at 0 without the troll's
 * wording is dead already.
 */
function regenerate(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  events: EffectNarration[]
): void {
  const regeneration = traitOf(definition, "regeneration");
  if (!regeneration) return;
  const stopped = actor.effects.find((effect) => effect.tags.includes(REGENERATION_STOPPED_TAG));
  const down = actor.effects.find((effect) => effect.tags.includes(REGENERATING_AT_ZERO_TAG));
  if (actor.hp.current <= 0 && !down) return;
  const types = (regeneration.stoppedBy ?? []).map((type) => `${type[0]!.toUpperCase()}${type.slice(1)}`);
  const why = `it took ${types.join(" or ")} damage`;
  if (stopped) {
    if (down) {
      events.push(...endEffect(state, actor.id, down.id));
      events.push({
        kind: "condition",
        text: `${actor.name} dies. It started its turn at 0 HP and its ${regeneration.name} didn't work (${why}).`,
        actorId: actor.id
      });
    } else
      events.push({
        kind: "effect",
        text: `${actor.name}'s ${regeneration.name} doesn't work this turn (${why}).`,
        actorId: actor.id
      });
    return;
  }
  if (actor.hp.current >= actor.hp.maximum) return;
  const before = actor.hp.current;
  const healed = healActor(state, actor.id, regeneration.hitPoints, { role: "gm" });
  events.push({
    kind: "effect",
    text: `${actor.name} regains ${actor.hp.current - before} hit points (${regeneration.name}).`,
    actorId: actor.id
  });
  events.push(...healed);
}

/** SRD Berserk (the golems): "Whenever the golem starts its turn Bloodied, roll 1d6. On a 6, the golem goes berserk
 *  ... until it is destroyed or it is no longer Bloodied." The server rolls the d6, and its attacks then go to the
 *  nearest creature it sees (`action-targets.ts`); what it smashes with none in sight is the GM's. */
function goBerserk(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: TraitTurnDeps,
  events: EffectNarration[]
): void {
  const trait = traitOf(definition, "berserk");
  if (!trait || actor.hp.current <= 0) return;
  const raging = actor.effects.find((effect) => effect.tags.includes(BERSERK_TAG));
  if (raging) {
    if (!bloodied(actor)) events.push(...endEffect(state, actor.id, raging.id));
    return;
  }
  if (!bloodied(actor)) return;
  const die = deps.rollDie(6);
  if (die < trait.on) {
    events.push({
      kind: "effect",
      text: `${actor.name} keeps its head (${trait.name}: rolled ${die}, needs ${trait.on}).`,
      actorId: actor.id,
      gmOnly: true
    });
    return;
  }
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${actor.id}:berserk:${state.combat.round}`,
      name: trait.name,
      tags: [BERSERK_TAG],
      sourceActorId: actor.id,
      sourceName: actor.name,
      sourceActionId: traitActionId(trait.name),
      startedRound: state.combat.round,
      duration: { type: "manual" },
      // "The golem's creator ... can try to calm it by taking an action": End an Effect within reach of its words.
      ...(trait.calm
        ? {
            endedBy: {
              name: "Calm the golem",
              by: "others" as const,
              withinFeet: trait.calm.withinFeet,
              check: { ability: "cha" as const, skill: "persuasion", dc: trait.calm.dc }
            }
          }
        : {})
    })
  );
  events.push({
    kind: "effect",
    text: `${actor.name} goes berserk (rolled ${die}). It attacks the nearest creature it can see until it is no longer Bloodied.`,
    actorId: actor.id
  });
}

/** Rolls a trait's damage once for everyone it reaches (SRD: an effect that damages several targets at once rolls
 *  once for them all). */
function rollTraitDamage(damage: NonNullable<Aura["damage"]>, rollDie: RandomSource) {
  return damage.map((part) => ({
    amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), rollDie).total),
    type: part.type
  }));
}

/** Deals a trait's rolled damage to one creature through its defences, and says so with the trait's bearer named. */
function dealTraitDamage(
  state: GameState,
  bearer: Actor,
  target: Actor,
  traitName: string,
  parts: ReadonlyArray<{ amount: number; type: string }>,
  deps: TraitTurnDeps,
  extra: Readonly<{ fromSunlight?: true }> = {}
): EffectNarration[] {
  const { application, events } = applyDamageDetailed(
    state,
    target.id,
    {
      amount: parts.reduce((sum, part) => sum + part.amount, 0),
      parts,
      sourceName: bearer.name,
      sourceActorId: bearer.id,
      ...extra
    },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition,
      rollDie: deps.rollDie,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      ...(deps.newId ? { newId: deps.newId } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.distanceFeet ? { distanceFeet: deps.distanceFeet } : {})
    }
  );
  const typed = parts.length === 1 ? ` ${parts[0]!.type[0]!.toUpperCase()}${parts[0]!.type.slice(1)}` : "";
  return [
    {
      kind: "damage",
      text: `${target.name} takes ${application.totalApplied}${typed} damage from ${bearer.name}'s ${traitName}${damageAdjustmentDetail(application)}.`,
      actorId: target.id,
      source: { actorId: bearer.id, name: bearer.name }
    },
    ...events
  ];
}

/** Who an aura of `bearer` reaches among the fight, by its range and whom it affects; null when the map can't say. */
function reached(state: GameState, bearer: Actor, aura: Aura, deps: TraitTurnDeps): Actor[] | null {
  const distanceFeet = deps.distanceFeet;
  if (!distanceFeet) return null;
  return fighting(state).filter((other) => {
    if (other.id === bearer.id || other.hp.current <= 0) return false;
    // "Of the azer's choice": it chooses its enemies. "Any enemy": the same.
    if (aura.affects !== "all" && !areEnemies(bearer, other, deps.resolveDefinition)) return false;
    // "Any Beast or Humanoid": a creature of another type is spared; one whose type nothing says is the GM's.
    const type = aura.creatureTypes ? creatureTypeOf(other, definitionOf(other, deps), "true") : null;
    if (type !== null && !aura.creatureTypes!.includes(type)) return false;
    const apart = distanceFeet(bearer.id, other.id);
    return apart !== null && apart <= aura.rangeFeet + DISTANCE_TOLERANCE_FEET;
  });
}

/** An aura is silent while its bearer is down, or Incapacitated when its text says so. */
const auraActive = (bearer: Actor, aura: Aura) =>
  bearer.hp.current > 0 && !(aura.notWhileIncapacitated && isIncapacitated(bearer));

/** SRD Fire Aura and Heat Aura: "At the end of each of the balor's turns, each creature in a 5-foot Emanation
 *  originating from the balor takes 13 (3d8) Fire damage." A fire elemental's also sets them burning. */
function burnAround(state: GameState, bearer: Actor, aura: Aura, deps: TraitTurnDeps, events: EffectNarration[]) {
  if (!aura.damage || !auraActive(bearer, aura)) return;
  const targets = reached(state, bearer, aura, deps);
  if (targets === null) {
    events.push({
      kind: "effect",
      text: `${bearer.name}'s ${aura.name}: each creature within ${aura.rangeFeet} feet takes ${aura.damage.map((part) => `${part.formula} ${part.type}`).join(" plus ")} damage. The map can't measure, so apply it by hand.`,
      actorId: bearer.id,
      gmOnly: true
    });
    return;
  }
  if (targets.length === 0) return;
  const parts = rollTraitDamage(aura.damage, deps.rollDie);
  for (const target of targets) {
    events.push(...dealTraitDamage(state, bearer, target, aura.name, parts, deps));
    if (aura.hazard !== "burning") continue;
    const hazard = HAZARDS.burning;
    events.push(
      ...applyFailureEffect(
        state,
        target.id,
        {
          name: hazard.name,
          tags: [hazard.tag],
          linkedConditionIds: [],
          escapeDc: null,
          sourceActorId: bearer.id,
          sourceName: bearer.name,
          ...(hazard.ongoingDamage ? { ongoingDamage: hazard.ongoingDamage } : {}),
          modifiers: []
        },
        `${bearer.id}:${traitActionId(aura.name)}:${state.combat.round}:${target.id}`,
        { resolveDefinition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) }
      )
    );
  }
}

/** SRD Barbed Hide: "At the start of each of its turns, the devil deals 5 (1d10) Piercing damage to any creature it
 *  is grappling or any creature grappling it." */
function grappleDamage(state: GameState, bearer: Actor, aura: Aura, deps: TraitTurnDeps, events: EffectNarration[]) {
  const partners = grapplePartners(state, bearer, aura);
  if (partners.length === 0 || !aura.damage) return;
  const parts = rollTraitDamage(aura.damage, deps.rollDie);
  for (const partner of partners) events.push(...dealTraitDamage(state, bearer, partner, aura.name, parts, deps));
}

/** The creatures Barbed Hide reaches: any the bearer grapples or that grapples it, while the aura acts. */
function grapplePartners(state: GameState, bearer: Actor, aura: Aura): Actor[] {
  if (!aura.damage || !auraActive(bearer, aura)) return [];
  const grapples = (holder: Actor, held: Actor) =>
    held.effects.some((effect) => effect.sourceActorId === holder.id && effect.linkedConditionIds.includes("grappled"));
  return fighting(state).filter(
    (other) => other.id !== bearer.id && other.hp.current > 0 && (grapples(bearer, other) || grapples(other, bearer))
  );
}

/**
 * SRD Stench, Fear Aura, Gibbering: "any creature that starts its turn in a 5-foot Emanation originating from the
 * ghast" makes the save. It opens as a prompt for the creature whose turn starts; a failure's condition lasts until
 * the start of its next turn, and a success can make it immune to that creature's aura for the rest of the fight
 * (the SRD's 24 hours). A failure the engine can't play out (the mouther's d8 table) is put to the GM.
 */
function aurasStartedIn(state: GameState, actor: Actor, deps: TraitTurnDeps, events: EffectNarration[]): void {
  if (actor.hp.current <= 0 || !deps.newId) return;
  for (const bearer of fighting(state)) {
    if (bearer.id === actor.id) continue;
    for (const aura of traitMechanicsOf(definitionOf(bearer, deps))) {
      if (aura.kind !== "aura" || aura.trigger !== "turn-start-inside" || !aura.save) continue;
      if (!auraActive(bearer, aura) || !(reached(state, bearer, aura, deps) ?? []).some((one) => one.id === actor.id))
        continue;
      // A gaze that works only on a creature that sees its bearer (Vile Appearance).
      if (aura.seenOnly && !sightRules(state, sightContentOf(deps), deps.distanceFeet).canSee(actor.id, bearer.id))
        continue;
      const key = traitActionId(aura.name);
      if (
        actor.effects.some(
          (effect) =>
            effect.tags.includes(AURA_IMMUNE_TAG) && effect.sourceActorId === bearer.id && effect.sourceActionId === key
        )
      )
        continue;
      const save = aura.save;
      const linked = save.failureConditions.filter((id) => id !== "prone");
      createPendingSaves(state, {
        sourceActorId: bearer.id,
        sourceName: bearer.name,
        actionName: aura.name,
        ability: save.ability,
        dc: save.dc,
        targetIds: [actor.id],
        proposedDamage: 0,
        halfOnSuccess: false,
        conditionIds: save.failureConditions,
        ...(linked.length > 0
          ? {
              onFailEffect: {
                name: `${conditionLabel(linked[0]!)} by ${bearer.name} (${aura.name})`.slice(0, 120),
                tags: [],
                linkedConditionIds: linked,
                escapeDc: null,
                sourceActorId: bearer.id,
                sourceName: bearer.name,
                ...(save.failureDuration ? { duration: save.failureDuration } : {}),
                sourceActionId: key
              }
            }
          : aura.failureTable === "gibbering"
            ? {
                // "What it does during the current turn": the roll's limits last until this turn ends.
                onFailEffect: {
                  name: `${aura.name} (${bearer.name})`.slice(0, 120),
                  tags: [GIBBERING_TAG],
                  linkedConditionIds: [],
                  escapeDc: null,
                  sourceActorId: bearer.id,
                  sourceName: bearer.name,
                  duration: { type: "until-bearer-turn-end" },
                  currentTurn: true,
                  sourceActionId: key
                }
              }
            : {}),
        ...(save.immuneOnSuccess ? { immuneOnSuccess: true } : {}),
        newSaveId: deps.newId,
        createdAt: Date.parse((deps.now ?? (() => new Date().toISOString()))())
      });
      events.push({
        kind: "condition",
        text: `${actor.name} starts its turn in ${bearer.name}'s ${aura.name}: DC ${save.dc} ${save.ability.toUpperCase()} save.`,
        actorId: actor.id,
        source: { actorId: bearer.id, name: bearer.name }
      });
      if (aura.reminder)
        events.push({
          kind: "effect",
          text: `${bearer.name}'s ${aura.name}: ${aura.reminder}`,
          actorId: actor.id,
          gmOnly: true
        });
    }
  }
}
