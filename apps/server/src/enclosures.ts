import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { CONCENTRATING_TAG, endEffectIfPresent, type EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";

/**
 * A sphere of force around one creature (SRD 5.2.1 Resilient Sphere: no physical object, energy or other spell effect
 * "can pass through the barrier, in or out"; Bead of Force: "No attack or other effect can pass through"). The creature carries it as an effect tagged `enclosed`. Nothing reaches across it either way, and
 * Disintegrate aimed at it "destroys it without harming anything inside", ending the spell.
 */

export const ENCLOSED_TAG = "enclosed";

type Actor = GameState["actors"][number];
type Effect = Actor["effects"][number];

/** The sphere around a creature, or undefined. */
export const enclosureOf = (actor: Pick<Actor, "effects">): Effect | undefined =>
  actor.effects.find((effect) => effect.tags.includes(ENCLOSED_TAG));

/** Whether the action is a cast of a spell that destroys walls of force (Disintegrate). */
function breaksForce(action: Pick<ActorAction, "spellId">, catalog: EquipmentCatalog | undefined): boolean {
  return action.spellId !== undefined && catalog?.spellRecord?.(action.spellId)?.walls?.disintegrates === true;
}

/** Why the action can't reach across a sphere between its user and its targets, or null: a target in a sphere the user
 *  isn't in, or a user in a sphere aiming at anyone else. Disintegrate aims at the sphere itself. */
export function enclosureBlocks(
  attacker: Actor,
  action: Pick<ActorAction, "spellId">,
  targets: readonly Actor[],
  catalog: EquipmentCatalog | undefined
): string | null {
  const own = enclosureOf(attacker);
  for (const target of targets) {
    if (target.id === attacker.id) continue;
    if (own) return `Nothing passes the wall of ${own.name} around ${attacker.name}.`;
    const sphere = enclosureOf(target);
    if (sphere && !breaksForce(action, catalog))
      return `Nothing passes the wall of ${sphere.name} around ${target.name}.`;
  }
  return null;
}

/** The creatures among `targetIds` that a sphere keeps an area or effect from, as `actorId` with the sphere's name: each
 *  inside one but the user, and every other creature when the user is inside one. */
export function enclosedFrom(
  state: GameState,
  userId: string,
  targetIds: readonly string[]
): Array<Readonly<{ actorId: string; sphere: string }>> {
  const user = state.actors.find((actor) => actor.id === userId);
  const own = user ? enclosureOf(user) : undefined;
  return targetIds.flatMap((actorId) => {
    if (actorId === userId) return [];
    if (own) return [{ actorId, sphere: own.name }];
    const target = state.actors.find((actor) => actor.id === actorId);
    const sphere = target ? enclosureOf(target) : undefined;
    return sphere ? [{ actorId, sphere: sphere.name }] : [];
  });
}

/** Disintegrate aimed at a creature in a sphere destroys the sphere and harms nothing inside: the sphere's effect and the
 *  Concentration that keeps it end. Null when the action isn't that. */
export function breakEnclosure(
  state: GameState,
  action: Pick<ActorAction, "spellId" | "name">,
  targets: readonly Actor[],
  catalog: EquipmentCatalog | undefined
): EffectNarration[] | null {
  if (targets.length !== 1 || !breaksForce(action, catalog)) return null;
  const target = targets[0];
  const sphere = enclosureOf(target);
  if (!sphere) return null;
  const events: EffectNarration[] = [
    { kind: "effect", text: `${action.name} destroys the ${sphere.name} around ${target.name}.`, actorId: target.id }
  ];
  events.push(...endEffectIfPresent(state, target.id, sphere.id));
  const casterId = sphere.sourceActorId;
  const caster = casterId ? state.actors.find((actor) => actor.id === casterId) : undefined;
  const concentration =
    sphere.castId !== undefined
      ? caster?.effects.find((effect) => effect.castId === sphere.castId && effect.tags.includes(CONCENTRATING_TAG))
      : undefined;
  if (caster && concentration) events.push(...endEffectIfPresent(state, caster.id, concentration.id));
  return events;
}
