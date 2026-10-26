import type { EffectInstance, GameState } from "@vtt/domain";
import type { ActorDefinition, ObjectStats, TraitMechanic } from "@vtt/schemas";
import { endEffectIfPresent, makeEffect, type EffectNarration } from "./effects.js";
import { traitMechanicsOf } from "./statblock-traits.js";
import { CARRIED_OBJECT_TAG, hasIntactObject } from "./timed-revival.js";

/**
 * What a stat block's creature carries with statistics of its own (SRD 5.2.1): a night hag's Soul Bag (AC 15, HP 20,
 * Resistance to all damage), an erinyes's Magic Rope (AC 20, HP 90), a mummy lord's heart (AC 17, HP 10, Immunity to all
 * damage except Fire) and a lich's spirit jar. Each is an effect on its creature, tagged with what it is, whose object
 * can be attacked like a Net that holds a creature (`objects.ts`); destroyed, it stays at 0 Hit Points, so what needs it
 * (Nightmare Haunting, Entangling Rope, a return to life) knows it is gone. A rope the erinyes throws holds its target
 * with the rope's own Hit Points, which a rest restores.
 */

type Actor = GameState["actors"][number];
type Carried = Extract<TraitMechanic, { kind: "carried-object" }>;

/** On the effect a thrown carried object leaves on the creature it holds (an erinyes's rope round its target). */
export const HELD_BY_CARRIED_TAG = "held-by-carried";

const carriedOf = (definition: ActorDefinition | undefined): Carried[] =>
  traitMechanicsOf(definition).filter((trait): trait is Carried => trait.kind === "carried-object");

const statsOf = (trait: Carried): ObjectStats | undefined =>
  trait.object
    ? { ...trait.object, hitPoints: { current: trait.object.hitPoints, maximum: trait.object.hitPoints } }
    : undefined;

/** The effects a creature joins the roster with for what it carries. */
export function carriedObjectEffects(
  actorId: string,
  name: string,
  definition: ActorDefinition | undefined
): EffectInstance[] {
  return carriedOf(definition).map((trait) => {
    const stats = statsOf(trait);
    return makeEffect({
      id: `${actorId}:carried:${trait.tag}`,
      name: trait.object?.name ?? trait.name,
      tags: [CARRIED_OBJECT_TAG, trait.tag],
      sourceActorId: actorId,
      sourceName: name,
      startedRound: 1,
      duration: { type: "manual" },
      ...(stats ? { heldBy: stats } : {})
    });
  });
}

/** The carried object tagged `tag` on its creature, whole or not. */
export function carriedObject(actor: Pick<Actor, "effects">, tag: string): EffectInstance | undefined {
  return actor.effects.find((effect) => effect.tags.includes(CARRIED_OBJECT_TAG) && effect.tags.includes(tag));
}

/** Why the creature can't use an action that needs a carried object now: it is destroyed or gone. Null when it can. */
export function carriedObjectViolation(
  attacker: Pick<Actor, "name" | "effects">,
  action: Readonly<{ name: string; needsObject?: string }>
): string | null {
  const tag = action.needsObject;
  if (tag === undefined || hasIntactObject(attacker, tag)) return null;
  const object = carriedObject(attacker, tag);
  const named = object?.name ?? tag.replace(/-/g, " ");
  return `${attacker.name} can't use ${action.name}: its ${named} is ${object ? "destroyed" : "gone"}.`;
}

/** The statistics a carried object holds a creature with (an erinyes's rope): its current ones, when its user has it. */
export function heldByCarried(user: Pick<Actor, "effects">, tag: string | undefined): ObjectStats | undefined {
  const object = tag ? carriedObject(user, tag) : undefined;
  return object?.heldBy ? structuredClone(object.heldBy) : undefined;
}

/**
 * Damage an object took that is a carried one, or holds a creature for one: the carrier's object and every hold it
 * makes keep the same Hit Points. A destroyed carried object stays on its creature at 0, and what it held is free.
 */
export function syncCarried(state: GameState, effect: EffectInstance, stats: ObjectStats): EffectNarration[] {
  const carrierId = effect.tags.includes(CARRIED_OBJECT_TAG)
    ? effect.sourceActorId
    : effect.tags.includes(HELD_BY_CARRIED_TAG)
      ? effect.sourceActorId
      : null;
  if (!carrierId) return [];
  const carrier = state.actors.find((actor) => actor.id === carrierId);
  const own = carrier?.effects.find(
    (candidate) => candidate.tags.includes(CARRIED_OBJECT_TAG) && candidate.heldBy?.name === stats.name
  );
  if (!carrier || !own) return [];
  carrier.effects = carrier.effects.map((candidate) =>
    candidate.id === own.id ? { ...candidate, heldBy: { ...stats, hitPoints: { ...stats.hitPoints } } } : candidate
  );
  const events: EffectNarration[] = [];
  for (const held of state.actors)
    for (const hold of held.effects.filter(
      (candidate) =>
        candidate.tags.includes(HELD_BY_CARRIED_TAG) &&
        candidate.sourceActorId === carrierId &&
        candidate.heldBy?.name === stats.name &&
        candidate.id !== effect.id
    )) {
      if (stats.hitPoints.current <= 0) events.push(...endEffectIfPresent(state, held.id, hold.id));
      else
        held.effects = held.effects.map((candidate) =>
          candidate.id === hold.id
            ? { ...candidate, heldBy: { ...stats, hitPoints: { ...stats.hitPoints } } }
            : candidate
        );
    }
  return events;
}

/** "If the rope is damaged or destroyed, the erinyes can fully restore it when finishing a Short or Long Rest." */
export function restoreCarriedAtRest(actor: Actor, definition: ActorDefinition | undefined): EffectNarration[] {
  const events: EffectNarration[] = [];
  for (const trait of carriedOf(definition).filter((candidate) => candidate.restoresAtRest)) {
    const stats = statsOf(trait);
    if (!stats) continue;
    const object = carriedObject(actor, trait.tag);
    if (object?.heldBy && object.heldBy.hitPoints.current >= stats.hitPoints.maximum) continue;
    actor.effects = object
      ? actor.effects.map((candidate) => (candidate.id === object.id ? { ...candidate, heldBy: stats } : candidate))
      : [
          ...actor.effects,
          ...carriedObjectEffects(actor.id, actor.name, definition).filter((e) => e.tags.includes(trait.tag))
        ];
    events.push({ kind: "effect", text: `${actor.name} restores its ${stats.name}.`, actorId: actor.id });
  }
  return events;
}
