import type { Actor } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";

/** Who fights alongside whom. */
export type Side = "party" | "foes";

/** What a side is read from: the creature's kind and stat block, who commands it, when someone does, and its effects. */
type Sided = Pick<Actor, "kind" | "definitionId"> & Partial<Pick<Actor, "control" | "effects">>;

/** On an effect, its bearer is the GM's to run while it lasts, against the party (a lycanthrope's curse at 0 Hit
 *  Points: "it instead becomes a Werewolf under the DM's control"). */
export const GM_CONTROLLED_TAG = "gm-controlled";

/**
 * The side a creature fights on. A creature under another's command (a summoned spirit, a dominated ogre) fights on
 * its commander's side while the command lasts. Otherwise player characters stand with the party, and any other
 * creature by its stat block's disposition, so a friendly NPC stands with the party and a hostile NPC against it. A
 * monster is a foe unless its stat block says friendly; an NPC with no hostile or friendly disposition is on neither
 * side, left to the GM.
 */
export function sideOf(
  actor: Sided,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): Side | null {
  if (actor.control) return actor.control.side;
  if (actor.effects?.some((effect) => effect.tags.includes(GM_CONTROLLED_TAG))) return "foes";
  if (actor.kind === "player-character") return "party";
  const disposition = actor.definitionId ? resolveDefinition?.(actor.definitionId)?.token.disposition : undefined;
  if (disposition === "friendly") return "party";
  if (disposition === "hostile") return "foes";
  return actor.kind === "monster" ? "foes" : null;
}

/** Two creatures on opposite sides. */
export function areEnemies(
  a: Sided,
  b: Sided,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): boolean {
  const sideA = sideOf(a, resolveDefinition);
  const sideB = sideOf(b, resolveDefinition);
  return sideA !== null && sideB !== null && sideA !== sideB;
}

/** Two creatures on the same side. */
export function areAllies(
  a: Sided,
  b: Sided,
  resolveDefinition?: (definitionId: string) => ActorDefinition | undefined
): boolean {
  const sideA = sideOf(a, resolveDefinition);
  return sideA !== null && sideA === sideOf(b, resolveDefinition);
}
