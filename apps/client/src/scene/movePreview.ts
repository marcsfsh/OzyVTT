import type { ActorMovementReply, EncounterToken, GmActor, PlayerActor } from "@vtt/domain";
import {
  climbCells,
  costWithClimb,
  footprintCenter,
  footprintOrigin,
  footprintStepPassage,
  movementPath,
  pointInRects,
  spaceHeightCells,
  spacePassage,
  spansOverlap,
  slipsThroughStep,
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
export type MoveMode = "walk" | "fly" | "swim" | "climb" | "burrow" | "jump" | "teleport" | "forced";

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
 * foot, Gust of Wind's Line toward its caster) is charged as the server's movement reply says (`areaGround`), for the
 * areas the asker can see.
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
    /** A jump: a straight line over what lies between, a foot of movement for each foot. */
    straight?: boolean;
    /** The mover passes through walls and creatures as through Difficult Terrain (Incorporeal Movement). */
    throughWalls?: boolean;
    /** The mover passes through walls at no extra cost (Earth Glide, burrowing). */
    throughWallsFree?: boolean;
    /** How narrow an opening the mover passes with no extra movement (the movement reply's). */
    opening?: "point" | "tiny";
    /** Difficult Terrain costs the mover nothing extra (Freedom of Movement). */
    ignoresDifficult?: boolean;
    /** Walls that bar the way while the scene's dynamic vision is on (`movementWallsOf`). */
    walls?: readonly MoveWall[];
    /** The mover's height as it sets off and where the move ends, in feet; on the ground when absent. */
    altitude?: Readonly<{ fromFeet: number; toFeet: number }>;
    /** The mover may end a move in another creature's space, so none bars its way (the movement reply's). */
    passesCreatures?: boolean;
    /** The swarms on the map, whose spaces any creature may cross (the movement reply's). */
    swarmIds?: readonly string[];
    /** The ground the spell areas change for the mover (the movement reply's). */
    areaGround?: ActorMovementReply["areaGround"];
  }>
): MovePreview | null {
  const { calibration, size, terrain, tokens, actorsById, moverId } = input;
  const mover = actorsById.get(moverId);
  const sizeCells = tokens.find((token) => token.actorId === moverId)?.sizeCells ?? 1;
  const from = footprintOrigin(imageToGridPreview(calibration, input.from), sizeCells);
  const to = footprintOrigin(imageToGridPreview(calibration, input.to), sizeCells);
  const centerOf = (cell: Readonly<{ column: number; row: number }>) =>
    gridToImagePreview(calibration, footprintCenter(cell, sizeCells));
  // Height, as the server counts it: rising or falling costs by the diagonal rule, a creature wholly above or below
  // the mover's way is no obstacle, and a mover off the ground the whole way passes over painted terrain.
  const feetPerCell = calibration.distancePerCell;
  const fromFeet = input.altitude?.fromFeet ?? 0;
  const toFeet = input.altitude?.toFeet ?? fromFeet;
  const climb = climbCells(fromFeet, toFeet, feetPerCell);
  const lowFeet = Math.min(fromFeet, toFeet);
  const highFeet = Math.max(fromFeet, toFeet) + spaceHeightCells(sizeCells) * feetPerCell;
  if (input.free || input.straight) {
    const cells = Math.max(Math.abs(to.column - from.column), Math.abs(to.row - from.row), climb);
    return {
      path: [centerOf(from), centerOf(to)],
      feet: cells * feetPerCell,
      difficultFeet: 0,
      ...(input.free ? { free: true as const } : {})
    };
  }
  const isAlly = input.isAlly ?? alliesByKind;
  const difficultCells = new Set<string>();
  const closedCells = new Set<string>();
  for (const token of tokens) {
    if (token.actorId === moverId || !token.position || input.carried?.includes(token.actorId)) continue;
    const occupant = actorsById.get(token.actorId);
    if (!mover || !occupant || occupant.visibility === "gm-only") continue;
    const occupantLow = token.altitudeFeet ?? 0;
    if (!spansOverlap(lowFeet, highFeet, occupantLow, occupantLow + spaceHeightCells(token.sizeCells) * feetPerCell))
      continue;
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
    const cells = passage === "blocked" && !input.throughWalls ? closedCells : difficultCells;
    const origin = footprintOrigin(imageToGridPreview(calibration, token.position), token.sizeCells);
    for (let column = 0; column < token.sizeCells; column++)
      for (let row = 0; row < token.sizeCells; row++) cells.add(`${origin.column + column},${origin.row + row}`);
  }
  const center = (column: number, row: number) =>
    gridToImagePreview(calibration, { column: column + 0.5, row: row + 0.5 });
  const gridWalls = (input.walls ?? []).map((wall) => ({
    a: imageToGridPreview(calibration, wall.a),
    b: imageToGridPreview(calibration, wall.b)
  }));
  const crosses = wallCrossing(gridWalls);
  // The spell areas' ground, on the ground: a mover off it passes over, as the server charges it.
  const cellKey = (cell: Readonly<{ column: number; row: number }>) => `${cell.column},${cell.row}`;
  const ground = input.areaGround;
  const areaDifficult = new Set(lowFeet <= 0 ? (ground?.difficult ?? []).map(cellKey) : []);
  // Painted Difficult Terrain an area lifts (Speak with Plants' clearing).
  const cleared = new Set((ground?.cleared ?? []).map(cellKey));
  const halved = new Set([
    ...(ground?.halved ?? []).map(cellKey),
    ...(lowFeet <= 0 ? (ground?.costlyGround ?? []).map(cellKey) : [])
  ]);
  const toward = (ground?.toward ?? []).map((entry) => ({
    caster: entry.caster,
    cells: new Set(entry.cells.map(cellKey))
  }));
  const apart = (point: Point, caster: Point) => Math.hypot(point.x - caster.x, point.y - caster.y);
  const passesWalls = input.throughWalls === true || input.throughWallsFree === true;
  const path = movementPath({
    from,
    to,
    sizeCells,
    isDifficult: (column, row) =>
      input.ignoresDifficult !== true &&
      (difficultCells.has(`${column},${row}`) ||
        areaDifficult.has(`${column},${row}`) ||
        (lowFeet <= 0 && pointInRects(center(column, row), terrain) && !cleared.has(`${column},${row}`))),
    ...(halved.size > 0 ? { isHalved: (column: number, row: number) => halved.has(`${column},${row}`) } : {}),
    // Gust of Wind: a step closer to the Line's caster, from or into the Line, costs double.
    ...(toward.length > 0
      ? {
          isStepCostly: (
            stepFrom: Readonly<{ column: number; row: number }>,
            stepTo: Readonly<{ column: number; row: number }>
          ) =>
            toward.some(
              (entry) =>
                (entry.cells.has(cellKey(stepFrom)) || entry.cells.has(cellKey(stepTo))) &&
                apart(centerOf(stepTo), entry.caster) < apart(centerOf(stepFrom), entry.caster) - 0.5
            )
        }
      : {}),
    isOpen: (column, row) => {
      if (closedCells.has(`${column},${row}`)) return false;
      const point = center(column, row);
      return point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height;
    },
    isStepOpen: (stepFrom, stepTo) =>
      passesWalls ||
      footprintStepPassage(stepFrom, stepTo, sizeCells, crosses, gridWalls) !== "blocked" ||
      (input.opening !== undefined && slipsThroughStep(stepFrom, stepTo, sizeCells, crosses, input.opening)),
    // A footprint that fits only as a creature one size smaller squeezes through, as through Difficult Terrain, and
    // so does a wall an incorporeal mover passes.
    isStepSqueezed: (stepFrom, stepTo) => {
      if (input.ignoresDifficult === true || input.throughWallsFree === true) return false;
      if (input.opening && slipsThroughStep(stepFrom, stepTo, sizeCells, crosses, input.opening)) return false;
      const passage = footprintStepPassage(stepFrom, stepTo, sizeCells, crosses, gridWalls);
      return passage === "squeeze" || (input.throughWalls === true && passage === "blocked");
    },
    extraPerStep: input.extraPerStep ?? 0
  });
  if (!path) return null;
  if (path.blocked) return { path: [centerOf(from), centerOf(to)], feet: 0, difficultFeet: 0, blocked: true };
  return {
    path: path.steps.map(centerOf),
    feet: costWithClimb(path.costCells, path.steps.length - 1, climb, input.extraPerStep ?? 0) * feetPerCell,
    difficultFeet: path.difficultSteps * feetPerCell
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
  // A teleport an action granted this turn (Misty Step) goes as far as it says.
  const teleport = mode === "teleport" ? budget?.teleport : undefined;
  if (preview.free && teleport)
    return preview.feet <= teleport.feet
      ? { text: `${teleport.name} ${preview.feet} ft`, over: false }
      : { text: `${teleport.name} ${preview.feet} ft · ${preview.feet - teleport.feet} ft too far`, over: true };
  if (preview.free) return { text: `${mode === "teleport" ? "Teleport" : "Moved"} ${preview.feet} ft`, over: false };
  const cost =
    preview.difficultFeet > 0 ? `${preview.feet} ft (${preview.difficultFeet} ft difficult)` : `${preview.feet} ft`;
  // A move an action granted this turn (Pounce) is taken with that grant when it fits, as the server takes it.
  const grant = budget?.granted;
  const grantFits =
    grant !== undefined &&
    (grant.jump === true ? mode === "jump" : mode !== "jump" && (grant.mode === undefined || grant.mode === mode)) &&
    preview.feet <= grant.feet;
  if (grantFits) return { text: `${cost} · ${grant.name}`, over: false };
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
  if (!budget || mode === "teleport" || mode === "forced" || mode === "jump") return 0;
  const slowed = budget.crawling === true || budget.modes?.find((entry) => entry.mode === mode)?.extraCost === true;
  return (slowed ? 1 : 0) + (budget.dragging ? 1 : 0);
}
