import { describe, expect, it } from "vitest";
import { footprintCenter, footprintOrigin, movementPath, pointInRects, spaceIsDifficultFor } from "../src/movement.js";

const open = () => false;
const cellSet = (cells: ReadonlyArray<readonly [number, number]>) => {
  const keys = new Set(cells.map(([column, row]) => `${column},${row}`));
  return (column: number, row: number) => keys.has(`${column},${row}`);
};

describe("movement over a square grid", () => {
  it("counts open ground as one cell per step, diagonals included", () => {
    const path = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 2 },
      sizeCells: 1,
      isDifficult: open
    });
    expect(path?.costCells).toBe(4);
    expect(path?.difficultSteps).toBe(0);
    expect(path?.steps[0]).toEqual({ column: 0, row: 0 });
    expect(path?.steps.at(-1)).toEqual({ column: 4, row: 2 });
    expect(path?.steps).toHaveLength(5);
  });

  it("charges double for each step into difficult terrain when there is no way round", () => {
    // A wall of rubble three rows deep across the whole box: the cheapest path crosses it.
    const rubble = (column: number, row: number) => column >= 1 && column <= 3 && Math.abs(row) < 100;
    const path = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      sizeCells: 1,
      isDifficult: rubble
    });
    expect(path?.costCells).toBe(7);
    expect(path?.difficultSteps).toBe(3);
  });

  it("walks round a patch of difficult terrain when that is cheaper", () => {
    const patch = cellSet([
      [2, 0],
      [2, 1],
      [2, -1]
    ]);
    const path = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      sizeCells: 1,
      isDifficult: patch
    });
    // Straight through costs 5; stepping diagonally round the three-cell patch costs the straight-line 4.
    expect(path?.costCells).toBe(4);
    expect(path?.difficultSteps).toBe(0);
  });

  it("is the same path every time", () => {
    const patch = cellSet([[1, 1]]);
    const first = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 3, row: 3 },
      sizeCells: 1,
      isDifficult: patch
    });
    const second = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 3, row: 3 },
      sizeCells: 1,
      isDifficult: patch
    });
    expect(second).toEqual(first);
  });

  it("charges a large creature when any cell of its space enters difficult terrain", () => {
    // A 2x2 creature moving one step right puts its right half on column 2.
    const path = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 1, row: 0 },
      sizeCells: 2,
      isDifficult: cellSet([[2, 1]])
    });
    expect(path?.costCells).toBe(2);
  });

  it("costs nothing to stay put, and gives up past its node budget", () => {
    expect(
      movementPath({ from: { column: 3, row: 3 }, to: { column: 3, row: 3 }, sizeCells: 1, isDifficult: open })
    ).toEqual({
      steps: [{ column: 3, row: 3 }],
      costCells: 0,
      difficultSteps: 0
    });
    expect(
      movementPath({
        from: { column: 0, row: 0 },
        to: { column: 40, row: 0 },
        sizeCells: 1,
        isDifficult: () => true,
        maxNodes: 10
      })
    ).toBeNull();
  });

  it("keeps every cell of the footprint on open cells", () => {
    // Only rows 0 and 1 exist, and a difficult cell sits in the way: the path must cross it.
    const path = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 2, row: 0 },
      sizeCells: 1,
      isDifficult: cellSet([
        [1, 0],
        [1, 1]
      ]),
      isOpen: (_column, row) => row >= 0 && row <= 1
    });
    expect(path?.costCells).toBe(3);
    expect(path?.steps.every((step) => step.row >= 0 && step.row <= 1)).toBe(true);
  });

  it("finds a footprint's top-left cell from its centre, odd and even", () => {
    expect(footprintOrigin({ column: 3.5, row: 2.5 }, 1)).toEqual({ column: 3, row: 2 });
    expect(footprintOrigin({ column: 4, row: 4 }, 2)).toEqual({ column: 3, row: 3 });
    expect(footprintOrigin({ column: 5.5, row: 5.5 }, 3)).toEqual({ column: 4, row: 4 });
    expect(footprintCenter({ column: 3, row: 3 }, 2)).toEqual({ column: 4, row: 4 });
    expect(footprintCenter({ column: 3, row: 2 }, 1)).toEqual({ column: 3.5, row: 2.5 });
  });

  it("treats a creature's space as difficult only for its enemies, and never a Tiny one", () => {
    const fighter = { kind: "player-character" };
    expect(spaceIsDifficultFor(fighter, { kind: "monster", size: "medium" })).toBe(true);
    expect(spaceIsDifficultFor(fighter, { kind: "monster", size: "tiny" })).toBe(false);
    expect(spaceIsDifficultFor(fighter, { kind: "player-character", size: "medium" })).toBe(false);
    expect(spaceIsDifficultFor({ kind: "monster" }, { kind: "player-character" })).toBe(true);
    // An NPC's side is the GM's call, so its space and its own movement are left alone.
    expect(spaceIsDifficultFor(fighter, { kind: "npc", size: "medium" })).toBe(false);
    expect(spaceIsDifficultFor({ kind: "npc" }, { kind: "monster", size: "large" })).toBe(false);
  });

  it("tests points against rects, edges included", () => {
    const rects = [{ x: 10, y: 10, width: 20, height: 20 }];
    expect(pointInRects({ x: 10, y: 30 }, rects)).toBe(true);
    expect(pointInRects({ x: 31, y: 20 }, rects)).toBe(false);
  });
});
