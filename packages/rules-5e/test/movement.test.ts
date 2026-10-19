import { describe, expect, it } from "vitest";
import {
  footprintCenter,
  footprintOrigin,
  footprintStepBlocked,
  footprintStepPassage,
  movementPath,
  pointInRects,
  segmentsMeet,
  spacePassage,
  wallCrossing
} from "../src/movement.js";

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

  it("charges twice a step's cost where the mover's Speed is halved, difficult terrain included", () => {
    // Halved from column 3 on (Spirit Guardians' Emanation); column 4 is also rubble.
    const path = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      sizeCells: 1,
      isDifficult: (column) => column === 4,
      isHalved: (column) => column >= 3
    });
    // Two open steps, one halved step (2) and one halved step into rubble (4).
    expect(path?.costCells).toBe(8);
    expect(path?.difficultSteps).toBe(1);
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

  it("opens an ally's or a Tiny creature's space, and lets a mover through anyone else's only as the SRD says", () => {
    const enemy = { ally: false, incapacitated: false, moverSize: "medium" };
    expect(spacePassage({ ...enemy, ally: true, occupantSize: "medium" })).toBe("open");
    expect(spacePassage({ ...enemy, occupantSize: "tiny" })).toBe("open");
    // A hostile creature within one size bars the way...
    expect(spacePassage({ ...enemy, occupantSize: "medium" })).toBe("blocked");
    expect(spacePassage({ ...enemy, occupantSize: "large" })).toBe("blocked");
    // ...unless it is Incapacitated or two sizes apart, and then its space is Difficult Terrain.
    expect(spacePassage({ ...enemy, incapacitated: true, occupantSize: "medium" })).toBe("difficult");
    expect(spacePassage({ ...enemy, occupantSize: "huge" })).toBe("difficult");
    expect(spacePassage({ ...enemy, moverSize: "huge", occupantSize: "medium" })).toBe("difficult");
  });

  it("goes round a creature it can't pass, and says when there is no way through", () => {
    const orc = cellSet([[2, 0]]);
    const round = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      sizeCells: 1,
      isDifficult: open,
      isOpen: (column, row) => !orc(column, row)
    });
    expect(round?.costCells).toBe(4);
    expect(round?.steps.some((step) => step.column === 2 && step.row === 0)).toBe(false);
    // A corridor one cell wide, held by the orc.
    const shut = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      sizeCells: 1,
      isDifficult: open,
      isOpen: (column, row) => row === 0 && !orc(column, row)
    });
    expect(shut).toEqual({ steps: [], costCells: 0, difficultSteps: 0, blocked: true });
  });

  it("adds a cell to every step while crawling, and two in difficult terrain", () => {
    const rubble = cellSet([[2, 0]]);
    const crawl = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 3, row: 0 },
      sizeCells: 1,
      isDifficult: rubble,
      isOpen: (_column, row) => row === 0,
      extraPerStep: 1
    });
    // Three steps at 2 each, one of them into rubble (3): 2 + 3 + 2.
    expect(crawl?.costCells).toBe(7);
    expect(crawl?.difficultSteps).toBe(1);
  });

  it("tests points against rects, edges included", () => {
    const rects = [{ x: 10, y: 10, width: 20, height: 20 }];
    expect(pointInRects({ x: 10, y: 30 }, rects)).toBe(true);
    expect(pointInRects({ x: 31, y: 20 }, rects)).toBe(false);
  });
});

describe("walls in the way of a move", () => {
  // A wall along the grid line x = 2 from row 0 to row 3. The way round below it is open.
  const wall = { a: { column: 2, row: 0 }, b: { column: 2, row: 3 } };
  const crosses = wallCrossing([wall]);
  const blockedBy =
    (sizeCells: number) => (from: { column: number; row: number }, to: { column: number; row: number }) =>
      !footprintStepBlocked(from, to, sizeCells, crosses);

  it("walks round the end of a wall", () => {
    const path = movementPath({
      from: { column: 0, row: 1 },
      to: { column: 4, row: 1 },
      sizeCells: 1,
      isDifficult: open,
      isStepOpen: blockedBy(1)
    });
    // Straight across is 4; round either end of the wall costs 5, since grazing its end is barred too.
    expect(path?.costCells).toBe(5);
    const steps = path?.steps ?? [];
    for (let index = 1; index < steps.length; index++) {
      const [from, to] = [steps[index - 1]!, steps[index]!];
      if (from.column <= 1 && to.column >= 2) expect(to.row < 0 || to.row > 2).toBe(true);
    }
  });

  it("is shut when walls close the way off", () => {
    const box = wallCrossing([
      { a: { column: 2, row: -10 }, b: { column: 2, row: 10 } },
      { a: { column: -10, row: -10 }, b: { column: 2, row: -10 } },
      { a: { column: -10, row: 10 }, b: { column: 2, row: 10 } },
      { a: { column: -10, row: -10 }, b: { column: -10, row: 10 } }
    ]);
    const path = movementPath({
      from: { column: 0, row: 0 },
      to: { column: 4, row: 0 },
      sizeCells: 1,
      isDifficult: open,
      isStepOpen: (from, to) => !footprintStepBlocked(from, to, 1, box)
    });
    expect(path?.blocked).toBe(true);
  });

  it("does not slip diagonally past the corner where two walls meet", () => {
    const corner = wallCrossing([
      { a: { column: 0, row: 1 }, b: { column: 1, row: 1 } },
      { a: { column: 1, row: 1 }, b: { column: 1, row: 2 } }
    ]);
    // From cell (0,0) to (1,1) the diagonal passes through the corner point (1,1).
    expect(footprintStepBlocked({ column: 0, row: 0 }, { column: 1, row: 1 }, 1, corner)).toBe(true);
    // The orthogonal step from (0,0) to (1,0) crosses nothing.
    expect(footprintStepBlocked({ column: 0, row: 0 }, { column: 1, row: 0 }, 1, corner)).toBe(false);
  });

  it("lets a Large creature squeeze through a 5-foot door at the cost of Difficult Terrain", () => {
    // A wall along x = 2 with a one-cell door between rows 0 and 1.
    const walls = [
      { a: { column: 2, row: -10 }, b: { column: 2, row: 0 } },
      { a: { column: 2, row: 1 }, b: { column: 2, row: 10 } }
    ];
    const door = wallCrossing(walls);
    const passage = (from: { column: number; row: number }, to: { column: number; row: number }) =>
      footprintStepPassage(from, to, 2, door, walls);
    expect(passage({ column: 0, row: 0 }, { column: 1, row: 0 })).toBe("squeeze");
    // A Medium creature walks through the same door.
    expect(footprintStepPassage({ column: 1, row: 0 }, { column: 2, row: 0 }, 1, door, walls)).toBe("open");
    const path = movementPath({
      from: { column: -2, row: 0 },
      to: { column: 3, row: 0 },
      sizeCells: 2,
      isDifficult: open,
      isStepOpen: (from, to) => passage(from, to) !== "blocked",
      isStepSqueezed: (from, to) => passage(from, to) === "squeeze"
    });
    expect(path?.blocked).toBeUndefined();
    expect(path?.difficultSteps).toBeGreaterThan(0);
    // A wall running clean across the footprint is no opening.
    expect(footprintStepPassage({ column: 0, row: 0 }, { column: 1, row: 0 }, 2, crosses, [wall])).toBe("blocked");
  });

  it("keeps a Large creature from straddling a wall", () => {
    // A 2x2 footprint whose cells would sit either side of the wall at x = 2.
    expect(footprintStepBlocked({ column: 0, row: 0 }, { column: 1, row: 0 }, 2, crosses)).toBe(true);
    expect(footprintStepBlocked({ column: 0, row: 4 }, { column: 1, row: 4 }, 2, crosses)).toBe(false);
  });

  it("meets at touching ends and on overlapping lines, and not when apart", () => {
    const p = (column: number, row: number) => ({ column, row });
    expect(segmentsMeet(p(0, 0), p(2, 2), p(0, 2), p(2, 0))).toBe(true);
    expect(segmentsMeet(p(0, 0), p(1, 1), p(1, 1), p(3, 0))).toBe(true);
    expect(segmentsMeet(p(0, 0), p(2, 0), p(1, 0), p(3, 0))).toBe(true);
    expect(segmentsMeet(p(0, 0), p(1, 0), p(0, 1), p(1, 1))).toBe(false);
  });
});
