import type { AnnotationPoint, AnnotationShapeKind } from "@vtt/domain";
import type { AreaTrigger } from "@vtt/schemas";
import { footprintCellCenters } from "./area-targeting.js";
import { imageToGrid, type GridPoint, type SquareGridCalibration } from "./grid-calibration.js";

/**
 * Lasting areas whose shape is more than their template (SRD 5.2.1): a ringed wall is the edge of its circle, 5 feet
 * thick ("a ringed wall up to 20 feet in diameter ... and 1 foot thick": Wall of Fire, Blade Barrier), and Wall of
 * Fire's burning side reaches "each creature that ends its turn within 10 feet of that side". Measured as the template
 * is (`area-targeting.ts`): a footprint is in when the centre of any of its cells is.
 */

type Placed = Readonly<{ origin: AnnotationPoint; target: AnnotationPoint }>;
type FootprintTest = (position: AnnotationPoint, sizeCells: number) => boolean;

const EPSILON = 1e-6;
/** How thick a ringed wall stands on the grid: one cell, as a thin straight wall is drawn 5 feet wide. */
export const RING_FEET = 5;

/** Whether any cell of the footprint has its centre where `inside` says. */
function anyCell(calibration: SquareGridCalibration, inside: (point: GridPoint) => boolean): FootprintTest {
  return (position, sizeCells) =>
    footprintCellCenters(calibration, position, sizeCells).some((center) => inside(center));
}

/** A ring's edge: the cells whose centres lie on the circle's last `RING_FEET`. */
export function ringTest(calibration: SquareGridCalibration, placed: Placed): FootprintTest {
  const origin = imageToGrid(calibration, placed.origin);
  const target = imageToGrid(calibration, placed.target);
  const radius = Math.hypot(target.column - origin.column, target.row - origin.row);
  const inner = radius - RING_FEET / calibration.distancePerCell;
  return anyCell(calibration, (point) => {
    const apart = Math.hypot(point.column - origin.column, point.row - origin.row);
    return apart <= radius + EPSILON && apart > inner + EPSILON;
  });
}

/**
 * The ground within `band.feet` of one side of a placed wall: the left or right of a straight wall as it was drawn
 * from its start (`origin`) toward its end, beyond its own thickness, or for a ring the ground inside or outside its
 * edge. Null for a shape with no sides.
 */
export function bandTest(
  calibration: SquareGridCalibration,
  placed: Placed,
  shape: AnnotationShapeKind,
  widthFeet: number | null,
  band: NonNullable<AreaTrigger["band"]>,
  ring: boolean
): FootprintTest | null {
  const origin = imageToGrid(calibration, placed.origin);
  const target = imageToGrid(calibration, placed.target);
  const reach = band.feet / calibration.distancePerCell;
  const dx = target.column - origin.column;
  const dy = target.row - origin.row;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  if (shape === "circle" && ring && (band.side === "inside" || band.side === "outside")) {
    const inner = length - RING_FEET / calibration.distancePerCell;
    return anyCell(calibration, (point) => {
      const apart = Math.hypot(point.column - origin.column, point.row - origin.row);
      return band.side === "inside"
        ? apart <= inner + EPSILON && apart > inner - reach - EPSILON
        : apart > length + EPSILON && apart <= length + reach + EPSILON;
    });
  }
  if (shape !== "line" || (band.side !== "left" && band.side !== "right")) return null;
  const half = (widthFeet ?? calibration.distancePerCell) / calibration.distancePerCell / 2;
  // Image rows grow downward, so the left of a wall drawn toward +x lies toward -y.
  const sign = band.side === "left" ? 1 : -1;
  return anyCell(calibration, (point) => {
    const vx = point.column - origin.column;
    const vy = point.row - origin.row;
    const along = (vx * dx + vy * dy) / length;
    const across = (sign * (vx * dy - vy * dx)) / length;
    return (
      along >= -EPSILON && along <= length + EPSILON && across > half + EPSILON && across <= half + reach + EPSILON
    );
  });
}
