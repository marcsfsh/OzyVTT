import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";

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
    .filter((id) => isSwarm(definitionOf(id)));
  return {
    ...(passesCreatures(definitionOf(actorId)) ? { passesCreatures: true as const } : {}),
    ...(swarmIds.length > 0 ? { swarmIds } : {})
  };
}
