import type { GameState } from "@vtt/domain";
import { footprintOrigin } from "@vtt/rules-5e";
import type { ActorDefinition } from "@vtt/schemas";
import { sharesHeight } from "./altitude.js";
import { holdsFeature } from "./class-features.js";
import { applyCondition, type EffectNarration } from "./effects.js";
import { imageToGrid, type SquareGridCalibration } from "./grid-calibration.js";
import { sizeRank } from "./resolution/context.js";

/**
 * SRD 5.2.1 Moving around Other Creatures: "If you somehow end a turn in a space with another creature, you have the
 * Prone condition unless you are Tiny or are of a larger size than the other creature." Read as a creature's turn ends,
 * on a grid. A creature that may share spaces (a swarm, an elemental's Air Form) is exempt, and so are two creatures
 * one of which holds the other (a grapple, an engulf).
 */

type Point = Readonly<{ x: number; y: number }>;

const SHARES_SPACE = ["Air Form", "Fire Form", "Water Form", "Swarm"] as const;

function cellsOf(calibration: SquareGridCalibration, position: Point, sizeCells: number): Set<string> {
  const origin = footprintOrigin(imageToGrid(calibration, position), sizeCells);
  const cells = new Set<string>();
  for (let column = 0; column < sizeCells; column++)
    for (let row = 0; row < sizeCells; row++) cells.add(`${origin.column + column},${origin.row + row}`);
  return cells;
}

export function proneInSharedSpace(
  state: GameState,
  actorId: string,
  calibration: SquareGridCalibration,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined,
  events: EffectNarration[]
): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId);
  if (!actor || !token?.position || actor.size === "tiny" || actor.hp.current <= 0) return;
  if (actor.conditions.some((condition) => condition.id === "prone")) return;
  const sharer = (id: string) => {
    const owner = state.actors.find((candidate) => candidate.id === id);
    const definition = owner?.definitionId ? resolveDefinition(owner.definitionId) : undefined;
    return SHARES_SPACE.some((name) => holdsFeature(definition, name, name));
  };
  if (sharer(actorId)) return;
  const holds = (holderId: string, heldId: string) =>
    state.actors
      .find((candidate) => candidate.id === heldId)
      ?.effects.some((effect) => effect.sourceActorId === holderId && effect.linkedConditionIds.length > 0) === true;
  const mine = cellsOf(calibration, token.position, token.sizeCells ?? 1);
  const crowded = state.combat.tokens.find((other) => {
    if (other.actorId === actorId || !other.position) return false;
    const occupant = state.actors.find((candidate) => candidate.id === other.actorId);
    if (!occupant || (occupant.hp.current <= 0 && occupant.kind === "monster")) return false;
    if (sizeRank(actor.size) > sizeRank(occupant.size)) return false;
    if (sharer(other.actorId) || holds(actorId, other.actorId) || holds(other.actorId, actorId)) return false;
    if (!sharesHeight(token, other, calibration.distancePerCell)) return false;
    for (const cell of cellsOf(calibration, other.position, other.sizeCells ?? 1)) if (mine.has(cell)) return true;
    return false;
  });
  if (!crowded) return;
  if (applyCondition(actor, "prone") !== "applied") return;
  events.push({
    kind: "condition",
    text: `${actor.name} ends its turn in another creature's space and falls Prone.`,
    actorId
  });
}
