import type { Actor } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";

/** Who fights alongside whom. */
export type Side = "party" | "foes";

/**
 * The side a creature fights on: player characters with the party; any other creature by its stat block's
 * disposition, so a friendly NPC or a summoned ally stands with the party and a hostile NPC against it. A monster
 * is a foe unless its stat block says friendly; an NPC with no hostile or friendly disposition is on neither side,
 * left to the GM.
 */
export function sideOf(
  actor: Pick<Actor, "kind" | "definitionId">,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): Side | null {
  if (actor.kind === "player-character") return "party";
  const disposition = actor.definitionId ? resolveDefinition?.(actor.definitionId)?.token.disposition : undefined;
  if (disposition === "friendly") return "party";
  if (disposition === "hostile") return "foes";
  return actor.kind === "monster" ? "foes" : null;
}

/** Two creatures on opposite sides. */
export function areEnemies(
  a: Pick<Actor, "kind" | "definitionId">,
  b: Pick<Actor, "kind" | "definitionId">,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): boolean {
  const sideA = sideOf(a, resolveDefinition);
  const sideB = sideOf(b, resolveDefinition);
  return sideA !== null && sideB !== null && sideA !== sideB;
}

/** Two creatures on the same side. */
export function areAllies(
  a: Pick<Actor, "kind" | "definitionId">,
  b: Pick<Actor, "kind" | "definitionId">,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): boolean {
  const sideA = sideOf(a, resolveDefinition);
  return sideA !== null && sideA === sideOf(b, resolveDefinition);
}
