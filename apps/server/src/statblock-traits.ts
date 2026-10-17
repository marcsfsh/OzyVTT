import type { Actor, GameState } from "@vtt/domain";
import { normalizeDamageType, parseDiceFormula, resolveDice, type RandomSource } from "@vtt/rules-5e";
import type { ActorDefinition, TraitMechanic } from "@vtt/schemas";
import { addEffect, makeEffect, turnEndDuration, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { createPendingSaves, rollSaveAtOnce } from "./saving-throws.js";

/**
 * What a stat block's traits do when damage lands (`ActorDefinition.traitMechanics`, read from the trait text when
 * the bundle is built): Regeneration stopped by the damage types it names, the troll's death that waits for its turn,
 * Undead Fortitude, and a Death Burst. What they do as turns start and end is in `turn-boundaries.ts`.
 */

/** "This trait doesn't function on the troll's next turn": the mark Acid or Fire leaves, lasting through that turn. */
export const REGENERATION_STOPPED_TAG = "regeneration-stopped";
/** A creature down at 0 Hit Points that dies only if its next turn starts without regenerating (the troll). */
export const REGENERATING_AT_ZERO_TAG = "regenerating-at-zero";

/** A success against an aura's save that earns immunity ("immune to this ghast's Stench for 24 hours"), kept for the
 *  fight. */
export const AURA_IMMUNE_TAG = "aura-immune";
/** The id an immunity or a trait's effect is keyed by, one per trait of a creature. */
export const traitActionId = (name: string) => `trait:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function traitMechanicsOf(definition: ActorDefinition | undefined): readonly TraitMechanic[] {
  return definition?.traitMechanics ?? [];
}

/** The creature's trait of one kind, if its stat block runs one. */
export function traitOf<Kind extends TraitMechanic["kind"]>(
  definition: ActorDefinition | undefined,
  kind: Kind
): Extract<TraitMechanic, { kind: Kind }> | undefined {
  return traitMechanicsOf(definition).find(
    (trait): trait is Extract<TraitMechanic, { kind: Kind }> => trait.kind === kind
  );
}

type WeighedPart = Readonly<{ type: string; adjusted: number }>;

/**
 * SRD Regeneration (the troll): "If the troll takes Acid or Fire damage, this trait doesn't function on the troll's
 * next turn." The mark lasts until the end of that turn, so the turn's start reads it; taken during the creature's
 * own turn, the next one is meant.
 */
export function stopRegeneration(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  parts: readonly WeighedPart[]
): EffectNarration[] {
  const regeneration = traitOf(definition, "regeneration");
  const stoppers = regeneration?.stoppedBy ?? [];
  const taken = parts.filter(
    (part) => part.adjusted > 0 && stoppers.some((type) => type === normalizeDamageType(part.type))
  );
  if (!regeneration || taken.length === 0) return [];
  const types = [...new Set(taken.map((part) => normalizeDamageType(part.type)))];
  const named = types.map((type) => `${type[0]!.toUpperCase()}${type.slice(1)}`).join(" and ");
  // One id a turn: a second hit in the same turn changes nothing, a later one refreshes the mark in place.
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${actor.id}:regeneration-stopped:${state.combat.round}:${state.combat.turnActorId ?? "none"}`,
      name: `${regeneration.name} stopped (${named})`,
      tags: [REGENERATION_STOPPED_TAG],
      sourceActorId: actor.id,
      sourceName: actor.name,
      sourceActionId: "trait:regeneration-stopped",
      startedRound: state.combat.round,
      duration: state.combat.active ? turnEndDuration(state, "until-bearer-turn-end", actor.id) : { type: "manual" }
    })
  );
  return [
    {
      kind: "effect",
      text: `${actor.name} took ${named} damage - its ${regeneration.name} won't work at the start of its next turn.`,
      actorId: actor.id,
      gmOnly: true
    }
  ];
}

/**
 * The troll at 0 Hit Points: "The troll dies only if it starts its turn with 0 Hit Points and doesn't regenerate." It
 * lies Unconscious until then, so it isn't dead (`isDead`) and its Regeneration can raise it. Null for a creature
 * whose trait doesn't say so, which dies at 0 as any monster does.
 */
export function holdOnAtZero(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  events: EffectNarration[]
): boolean {
  const regeneration = traitOf(definition, "regeneration");
  if (!regeneration?.deathWaitsForTurn) return false;
  addEffect(
    state,
    actor.id,
    makeEffect({
      id: `${actor.id}:regenerating-at-zero:${state.combat.round}:${state.combat.turnActorId ?? "none"}`,
      name: `Down at 0 HP (${regeneration.name})`,
      tags: [REGENERATING_AT_ZERO_TAG],
      sourceActorId: actor.id,
      sourceName: actor.name,
      sourceActionId: "trait:regenerating-at-zero",
      startedRound: state.combat.round,
      duration: { type: "manual" },
      linkedConditionIds: ["unconscious"]
    }),
    events
  );
  events.push({
    kind: "condition",
    text: `${actor.name} drops to 0 HP - it dies only if it starts its turn at 0 HP and doesn't regenerate.`,
    actorId: actor.id
  });
  return true;
}

export type TraitDamageDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  rollDie?: RandomSource;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
  newId?: () => string;
  now?: () => string;
}>;

/**
 * SRD Undead Fortitude: "If damage reduces the zombie to 0 Hit Points, it makes a Constitution saving throw (DC 5 plus
 * the damage taken) unless the damage is Radiant or from a Critical Hit. On a successful save, the zombie drops to 1 Hit
 * Point instead." The server rolls it as the damage lands. True when the creature held on at 1 Hit Point.
 */
export function undeadFortitude(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  hit: Readonly<{ taken: number; parts: readonly WeighedPart[]; critical: boolean }>,
  deps: TraitDamageDeps,
  events: EffectNarration[]
): boolean {
  const trait = traitOf(definition, "undead-fortitude");
  if (!trait || !deps.rollDie) return false;
  const excepted = hit.parts.find(
    (part) => part.adjusted > 0 && trait.exceptDamageTypes.some((type) => type === normalizeDamageType(part.type))
  );
  if (excepted || (hit.critical && trait.exceptCritical)) {
    events.push({
      kind: "condition",
      text: `${actor.name}'s ${trait.name} doesn't hold against ${excepted ? `${normalizeDamageType(excepted.type)} damage` : "a Critical Hit"}.`,
      actorId: actor.id
    });
    return false;
  }
  const dc = trait.dcBase + hit.taken;
  const save = rollSaveAtOnce(state, actor, trait.ability, { ...deps, rollDie: deps.rollDie });
  const held = save.total >= dc;
  if (held) actor.hp.current = 1;
  events.push({
    kind: "condition",
    text: `${actor.name}'s ${trait.name}: ${trait.ability.toUpperCase()} save ${save.total} (d20 ${save.natural}) vs DC ${dc} - ${held ? "it drops to 1 HP instead" : "it falls"}.`,
    actorId: actor.id
  });
  return held;
}

/**
 * SRD Death Burst (the mephits, the magmin) and the balor's Death Throes: as it dies, each creature in the Emanation
 * makes the save, the damage rolled once for them all. With a map the saves open for the creatures in reach; without
 * one the GM is told what to call for.
 */
export function deathBurst(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: TraitDamageDeps,
  events: EffectNarration[]
): void {
  const burst = traitOf(definition, "death-burst");
  if (!burst || !deps.rollDie || !deps.newId) return;
  const parts = burst.damage.map((part) => ({
    amount: Math.max(0, resolveDice(parseDiceFormula(part.formula), deps.rollDie!).total),
    type: part.type
  }));
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const ability = burst.save.ability.toUpperCase();
  const inFight = state.combat.initiative.map((entry) => entry.actorId);
  const caught = deps.distanceFeet
    ? inFight.filter((id) => {
        if (id === actor.id) return false;
        const apart = deps.distanceFeet!(actor.id, id);
        return apart !== null && apart <= burst.rangeFeet + 0.5;
      })
    : [];
  if (!deps.distanceFeet) {
    events.push({
      kind: "effect",
      text: `${actor.name} explodes (${burst.name}): each creature within ${burst.rangeFeet} feet makes a DC ${burst.save.dc} ${ability} save - ${total} damage on a failure, ${burst.save.successDamage === "half" ? "half" : "none"} on a success.`,
      actorId: actor.id,
      gmOnly: true
    });
    return;
  }
  events.push({
    kind: "effect",
    text: `${actor.name} explodes (${burst.name}): DC ${burst.save.dc} ${ability} save for ${caught.length === 0 ? "no one" : caught.length === 1 ? "1 creature" : `${caught.length} creatures`} within ${burst.rangeFeet} feet.`,
    actorId: actor.id
  });
  if (caught.length === 0) return;
  createPendingSaves(state, {
    sourceActorId: actor.id,
    sourceName: actor.name,
    actionName: burst.name,
    ability: burst.save.ability,
    dc: burst.save.dc,
    targetIds: caught,
    proposedDamage: total,
    proposedDamageParts: parts,
    halfOnSuccess: burst.save.successDamage === "half",
    conditionIds: [],
    newSaveId: deps.newId,
    createdAt: deps.now ? Date.parse(deps.now()) : Date.now()
  });
}
