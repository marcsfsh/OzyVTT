import type { ActorMovementReply, EncounterToken, GmActor, PlayerActor } from "@vtt/domain";
import {
  footprintCenter,
  footprintOrigin,
  footprintStepBlocked,
  movementPath,
  pointInRects,
  spacePassage,
  wallCrossing
} from "@vtt/rules-5e";
import { gridToImagePreview, imageToGridPreview, type GridCalibration } from "./gridPreview";

type Point = Readonly<{ x: number; y: number }>;
type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;
type MapActor = GmActor | PlayerActor;

/** A wall, closed door or window that bars a move, in image pixels. */
export type MoveWall = Readonly<{ a: Point; b: Point }>;

/** The walls that bar a move among those the view has (dynamic vision): every one but an open door. A door whose state
 *  a player wasn't sent counts as closed. */
export function movementWallsOf(
  walls: ReadonlyArray<Readonly<{ kind: "wall" | "door" | "window"; a: Point; b: Point; open?: boolean }>>
): MoveWall[] {
  return walls.filter((wall) => wall.kind !== "door" || wall.open !== true).map((wall) => ({ a: wall.a, b: wall.b }));
}

/** How a drag travels, as `token.move` takes it. */
export type MoveMode = "walk" | "fly" | "swim" | "climb" | "burrow" | "teleport" | "forced";

export type MovePreview = Readonly<{
  /** Footprint centres from start to end, in image pixels. */
  path: readonly Point[];
  feet: number;
  difficultFeet: number;
  /** Teleporting or moved by force: measured straight, and spends no movement. */
  free?: true;
  /** No way there past creatures the mover can't pass. */
  blocked?: true;
}>;

/** Conditions that leave a creature Incapacitated, so others may pass through its space. */
const INCAPACITATING = new Set(["incapacitated", "paralyzed", "petrified", "stunned", "unconscious"]);

/** The side a creature fights on as the view can tell it: player characters with the party, monsters against
 *  it, an NPC on neither (its disposition is the GM's to know). */
const sideByKind = (actor: MapActor) =>
  actor.kind === "player-character" ? "party" : actor.kind === "monster" ? "foes" : null;
export const alliesByKind = (mover: MapActor, occupant: MapActor) => {
  const side = sideByKind(mover);
  return side !== null && side === sideByKind(occupant);
};

/**
 * The path and cost of a drag, with the function the server charges (`movementCost`): the cheapest grid path,
 * painted terrain and other creatures' spaces costing double or barring the way as the SRD says (`spacePassage`), an
 * extra foot per foot while crawling, climbing or swimming without the speed, or dragging. The client sees only what
 * it may (players get the revealed terrain, no hidden creatures, and no NPC's side), and the server leaves hidden
 * creatures out too, so the two agree except where unrevealed terrain lies under the fog or an NPC's side matters.
 * A creature that shares spaces (Air Form, a swarm) and any creature crossing a swarm pay Difficult Terrain where they
 * would be barred, as the server's movement reply says (`passesCreatures`, `swarmIds`).
 * With dynamic vision on, the walls the view has bar the way as the server's do. A spell's area that halves the
 * mover's Speed (Spirit Guardians) or changes the ground (Web's Difficult Terrain, Plant Growth's 4 feet for every
 * foot) is charged by the server alone.
 */
export function previewMove(
  input: Readonly<{
    calibration: GridCalibration;
    size: Readonly<{ width: number; height: number }>;
    terrain: readonly Rect[];
    tokens: readonly EncounterToken[];
    actorsById: ReadonlyMap<string, MapActor>;
    moverId: string;
    from: Point;
    to: Point;
    /** Whether two creatures fight on the same side; by kind when absent. */
    isAlly?: (mover: MapActor, occupant: MapActor) => boolean;
    /** Feet added to every foot moved. */
    extraPerStep?: number;
    /** Creatures moving along with the mover, whose spaces are no obstacle. */
    carried?: readonly string[];
    /** Teleporting or moved by force: a straight line that spends nothing. */
    free?: boolean;
    /** Walls that bar the way while the scene's dynamic vision is on (`movementWallsOf`). */
    walls?: readonly MoveWall[];
    /** The mover may end a move in another creature's space, so none bars its way (the movement reply's). */
    passesCreatures?: boolean;
    /** The swarms on the map, whose spaces any creature may cross (the movement reply's). */
    swarmIds?: readonly string[];
  }>
): MovePreview | null {
  const { calibration, size, terrain, tokens, actorsById, moverId } = input;
  const mover = actorsById.get(moverId);
  const sizeCells = tokens.find((token) => token.actorId === moverId)?.sizeCells ?? 1;
  const from = footprintOrigin(imageToGridPreview(calibration, input.from), sizeCells);
  const to = footprintOrigin(imageToGridPreview(calibration, input.to), sizeCells);
  const centerOf = (cell: Readonly<{ column: number; row: number }>) =>
    gridToImagePreview(calibration, footprintCenter(cell, sizeCells));
  if (input.free) {
    const cells = Math.max(Math.abs(to.column - from.column), Math.abs(to.row - from.row));
    return {
      path: [centerOf(from), centerOf(to)],
      feet: cells * calibration.distancePerCell,
      difficultFeet: 0,
      free: true
    };
  }
  const isAlly = input.isAlly ?? alliesByKind;
  const difficultCells = new Set<string>();
  const closedCells = new Set<string>();
  for (const token of tokens) {
    if (token.actorId === moverId || !token.position || input.carried?.includes(token.actorId)) continue;
    const occupant = actorsById.get(token.actorId);
    if (!mover || !occupant || occupant.visibility === "gm-only") continue;
    const printed = spacePassage({
      ally: isAlly(mover, occupant),
      incapacitated: occupant.conditions.some((condition) => INCAPACITATING.has(condition.id)),
      moverSize: mover.size,
      occupantSize: occupant.size
    });
    // A space the mover may share is still another creature's, so it costs as Difficult Terrain.
    const passage =
      printed === "blocked" && (input.passesCreatures || input.swarmIds?.includes(occupant.id)) ? "difficult" : printed;
    if (passage === "open") continue;
    const cells = passage === "blocked" ? closedCells : difficultCells;
    const origin = footprintOrigin(imageToGridPreview(calibration, token.position), token.sizeCells);
    for (let column = 0; column < token.sizeCells; column++)
      for (let row = 0; row < token.sizeCells; row++) cells.add(`${origin.column + column},${origin.row + row}`);
  }
  const center = (column: number, row: number) =>
    gridToImagePreview(calibration, { column: column + 0.5, row: row + 0.5 });
  const crosses = wallCrossing(
    (input.walls ?? []).map((wall) => ({
      a: imageToGridPreview(calibration, wall.a),
      b: imageToGridPreview(calibration, wall.b)
    }))
  );
  const path = movementPath({
    from,
    to,
    sizeCells,
    isDifficult: (column, row) => difficultCells.has(`${column},${row}`) || pointInRects(center(column, row), terrain),
    isOpen: (column, row) => {
      if (closedCells.has(`${column},${row}`)) return false;
      const point = center(column, row);
      return point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height;
    },
    isStepOpen: (stepFrom, stepTo) => !footprintStepBlocked(stepFrom, stepTo, sizeCells, crosses),
    extraPerStep: input.extraPerStep ?? 0
  });
  if (!path) return null;
  if (path.blocked) return { path: [centerOf(from), centerOf(to)], feet: 0, difficultFeet: 0, blocked: true };
  return {
    path: path.steps.map(centerOf),
    feet: path.costCells * calibration.distancePerCell,
    difficultFeet: path.difficultSteps * calibration.distancePerCell
  };
}

/** The budget a drag is charged against, for the way it travels: that mode's (Fly Speed, Dash included), else the
 *  walking budget. */
export function budgetFor(budget: ActorMovementReply | null, mode: MoveMode): number | null {
  if (!budget) return null;
  return budget.modes?.find((entry) => entry.mode === mode)?.budgetFeet ?? budget.speedFeet;
}

/** The label beside a dragged token: what the move costs, and what that leaves of this turn's movement. */
export function moveLabel(
  preview: MovePreview,
  budget: ActorMovementReply | null,
  mode: MoveMode = "walk"
): { text: string; over: boolean } {
  if (preview.blocked) return { text: "No way through", over: true };
  if (preview.free) return { text: `${mode === "teleport" ? "Teleport" : "Moved"} ${preview.feet} ft`, over: false };
  const cost =
    preview.difficultFeet > 0 ? `${preview.feet} ft (${preview.difficultFeet} ft difficult)` : `${preview.feet} ft`;
  const total = budgetFor(budget, mode);
  if (!budget?.counted || total === null) return { text: cost, over: false };
  const left = total - budget.usedFeet - preview.feet;
  return left >= 0
    ? { text: `${cost} · ${left} ft left`, over: false }
    : { text: `${cost} · ${-left} ft too far`, over: true };
}

/** Feet added to every foot of a counted move: crawling while Prone, climbing or swimming without the speed, and
 *  dragging a grappled creature (the server says which apply). */
export function extraPerStepFor(budget: ActorMovementReply | null, mode: MoveMode): number {
  if (!budget || mode === "teleport" || mode === "forced") return 0;
  const slowed = budget.crawling === true || budget.modes?.find((entry) => entry.mode === mode)?.extraCost === true;
  return (slowed ? 1 : 0) + (budget.dragging ? 1 : 0);
}
