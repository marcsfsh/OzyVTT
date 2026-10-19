// Height above a flat map (SRD 5.2.1 Flying, Climbing, Jumping). A creature's altitude is how far its lowest point is
// above the ground, and its space rises as tall as it is wide (Creature Size: a creature's space is a cube on the grid).
// Height is measured with the grid's own diagonal rule: every diagonal step costs one square, up and down as across the
// floor, so a creature one square up and one across is one square away. The server and the map's drag preview share
// these, so both count height the same way.

/** How tall a creature's space is, in grid cells: as many as it is wide. */
export const spaceHeightCells = (sizeCells: number) => Math.max(1, Math.round(sizeCells));

/** Whether two vertical spans, each from its low end up to (not including) its high end, overlap. */
export function spansOverlap(aLow: number, aHigh: number, bLow: number, bHigh: number): boolean {
  return aLow < bHigh - 1e-6 && bLow < aHigh - 1e-6;
}

/** How many squares apart two creatures are straight up or down, counted as the floor's distance is: from the nearest
 *  square of one space to the nearest of the other, so a creature one square higher is one square (5 feet) away, and 0
 *  when their heights overlap. */
export function verticalEdgeCells(
  a: Readonly<{ altitudeFeet?: number | undefined; sizeCells: number }>,
  b: Readonly<{ altitudeFeet?: number | undefined; sizeCells: number }>,
  feetPerCell: number
): number {
  const height = (creature: typeof a) => spaceHeightCells(creature.sizeCells);
  const centre = (creature: typeof a) => (creature.altitudeFeet ?? 0) / feetPerCell + height(creature) / 2;
  return Math.max(0, Math.abs(centre(a) - centre(b)) - (height(a) - 1) / 2 - (height(b) - 1) / 2);
}

/** How many squares a move rises or falls. */
export function climbCells(fromFeet: number, toFeet: number, feetPerCell: number): number {
  return Math.ceil(Math.abs(toFeet - fromFeet) / feetPerCell - 1e-6);
}

/** A move's cost in squares once it also changes height: each step across the floor may rise or fall one square at no
 *  extra cost (the diagonal rule), and the height left over costs a square for each square, plus `extraPerStep` for
 *  each (climbing without a Climb Speed, crawling). */
export function costWithClimb(floorCostCells: number, floorSteps: number, climb: number, extraPerStep = 0): number {
  return floorCostCells + Math.max(0, climb - floorSteps) * (1 + Math.max(0, extraPerStep));
}
