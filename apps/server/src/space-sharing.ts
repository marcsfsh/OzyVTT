import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";
import { formEffectOf } from "./transform/forms.js";
import { traitOf } from "./statblock-traits.js";

/**
 * Creatures that share spaces, as the map's drag preview needs to know them. SRD 5.2.1 Air Form: "The elemental can
 * enter a creature's space and stop there"; Swarm: "The swarm can occupy another creature's space and vice versa".
 * movement-rules.ts and terrain.ts charge a move with the same traits: such a mover is never barred by a creature, and
 * any mover may cross a swarm's space, each as Difficult Terrain.
 */

const SHARES_SPACE = ["Air Form", "Fire Form", "Water Form", "Swarm"] as const;

/** Whether a creature with this stat block may end its move in another creature's space. */
export const passesCreatures = (definition: ActorDefinition | undefined): boolean =>
  SHARES_SPACE.some((name) => holdsFeature(definition, name, name));

/** Whether a creature with this stat block is a swarm, whose space any creature may cross. */
export const isSwarm = (definition: ActorDefinition | undefined): boolean => holdsFeature(definition, "swarm", "Swarm");

/** Whether other creatures may enter and stop in this creature's space: a swarm's, or a gelatinous cube's ("Other
 *  creatures can enter that space", which subjects them to its Engulf). */
export const opensItsSpace = (definition: ActorDefinition | undefined): boolean =>
  isSwarm(definition) || traitOf(definition, "engulfs-entrants") !== undefined;

/** What the drag preview needs for `actorId`'s move: whether it passes creatures, and the swarms on the map among the
 *  creatures `hidden` leaves the asker. */
export function spaceSharingFor(
  state: GameState,
  actorId: string,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  hidden: (actorId: string) => boolean
): Readonly<{ passesCreatures?: true; swarmIds?: string[] }> {
  const definitionOf = (id: string) => {
    const definitionId = state.actors.find((actor) => actor.id === id)?.definitionId;
    return definitionId ? resolveDefinition(definitionId) : undefined;
  };
  const swarmIds = state.combat.tokens
    .filter((token) => token.actorId !== actorId && token.position && !hidden(token.actorId))
    .map((token) => token.actorId)
    .filter((id) => opensItsSpace(definitionOf(id)));
  // A form that can enter a creature's space and stop there (a vampire's mist, Gaseous Form's cloud) passes them too.
  const mover = state.actors.find((actor) => actor.id === actorId);
  const formShares = mover !== undefined && formEffectOf(mover)?.form?.sharesSpaces === true;
  return {
    ...(passesCreatures(definitionOf(actorId)) || formShares ? { passesCreatures: true as const } : {}),
    ...(swarmIds.length > 0 ? { swarmIds } : {})
  };
}
