import type { ActorMovementReply, EncounterToken, GmActor, PlayerActor } from "@vtt/domain";
import { footprintCenter, footprintOrigin, movementPath, pointInRects, spaceIsDifficultFor } from "@vtt/rules-5e";
import { gridToImagePreview, imageToGridPreview, type GridCalibration } from "./gridPreview";

type Point = Readonly<{ x: number; y: number }>;
type Rect = Readonly<{ x: number; y: number; width: number; height: number }>;

export type MovePreview = Readonly<{
  /** Footprint centres from start to end, in image pixels. */
  path: readonly Point[];
  feet: number;
  difficultFeet: number;
}>;

/**
 * The path and cost of a drag, with the function the server charges (`movementCost`): the cheapest grid path,
 * painted terrain and enemies' spaces costing double. The client sees only what it may (players get the
 * revealed terrain and no hidden creatures), and the server leaves hidden creatures out too, so the two agree
 * except where unrevealed terrain lies under the fog.
 */
export function previewMove(
  input: Readonly<{
    calibration: GridCalibration;
    size: Readonly<{ width: number; height: number }>;
    terrain: readonly Rect[];
    tokens: readonly EncounterToken[];
    actorsById: ReadonlyMap<string, GmActor | PlayerActor>;
    moverId: string;
    from: Point;
    to: Point;
  }>
): MovePreview | null {
  const { calibration, size, terrain, tokens, actorsById, moverId } = input;
  const mover = actorsById.get(moverId);
  const sizeCells = tokens.find((token) => token.actorId === moverId)?.sizeCells ?? 1;
  const occupied = new Set<string>();
  for (const token of tokens) {
    if (token.actorId === moverId || !token.position) continue;
    const occupant = actorsById.get(token.actorId);
    if (!mover || !occupant || occupant.visibility === "gm-only" || !spaceIsDifficultFor(mover, occupant)) continue;
    const origin = footprintOrigin(imageToGridPreview(calibration, token.position), token.sizeCells);
    for (let column = 0; column < token.sizeCells; column++)
      for (let row = 0; row < token.sizeCells; row++) occupied.add(`${origin.column + column},${origin.row + row}`);
  }
  const center = (column: number, row: number) =>
    gridToImagePreview(calibration, { column: column + 0.5, row: row + 0.5 });
  const path = movementPath({
    from: footprintOrigin(imageToGridPreview(calibration, input.from), sizeCells),
    to: footprintOrigin(imageToGridPreview(calibration, input.to), sizeCells),
    sizeCells,
    isDifficult: (column, row) => occupied.has(`${column},${row}`) || pointInRects(center(column, row), terrain),
    isOpen: (column, row) => {
      const point = center(column, row);
      return point.x >= 0 && point.y >= 0 && point.x <= size.width && point.y <= size.height;
    }
  });
  if (!path) return null;
  return {
    path: path.steps.map((step) => gridToImagePreview(calibration, footprintCenter(step, sizeCells))),
    feet: path.costCells * calibration.distancePerCell,
    difficultFeet: path.difficultSteps * calibration.distancePerCell
  };
}

/** The label beside a dragged token: what the move costs, and what that leaves of this turn's movement. */
export function moveLabel(preview: MovePreview, budget: ActorMovementReply | null): { text: string; over: boolean } {
  const cost =
    preview.difficultFeet > 0 ? `${preview.feet} ft (${preview.difficultFeet} ft difficult)` : `${preview.feet} ft`;
  if (!budget?.counted || budget.speedFeet === null) return { text: cost, over: false };
  const left = budget.speedFeet - budget.usedFeet - preview.feet;
  return left >= 0
    ? { text: `${cost} · ${left} ft left`, over: false }
    : { text: `${cost} · ${-left} ft too far`, over: true };
}
