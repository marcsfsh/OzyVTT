import { describe, expect, it } from "vitest";
import { GameStateSchema, type AnnotationShapeKind } from "@vtt/domain";
import { shapeGeometry, templateOfArea } from "../../../server/src/annotations";
import { tokensInTemplate } from "../../../server/src/area-targeting";
import { creatureDistance } from "../../../server/src/movement-narration";
import { caughtByArea, creatureDistanceFeet } from "./targetHints";

// The target list's distances and the area hint must say what the server will decide, so they run its scenarios.

const CALIBRATION = { origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
const GRID = { kind: "square" as const, ...CALIBRATION };
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });
const ids = Array.from({ length: 9 }, (_, index) => `10000000-0000-4000-8000-00000000000${index + 1}`);

function table(positions: ReadonlyArray<Readonly<{ x: number; y: number }>>, sizes: readonly number[] = []) {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: positions.map((_, index) => ({
      id: ids[index],
      name: `Creature ${index + 1}`,
      kind: "monster",
      hp: { current: 10, maximum: 10 }
    })),
    combat: {
      active: true,
      round: 1,
      turnActorId: ids[0],
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: positions.map((_, index) => ({ actorId: ids[index], score: 10 - index })),
      tokens: positions.map((position, index) => ({
        actorId: ids[index],
        position,
        sizePx: 41 * (sizes[index] ?? 1),
        gridSizePx: 50,
        sizeCells: sizes[index] ?? 1
      }))
    }
  });
}

describe("target hints agree with the server", () => {
  it("measures creature distance edge to edge, as the server does", () => {
    const positions = [cell(0, 0), cell(1, 0), cell(5, 2), { x: 300, y: 300 }];
    const state = table(positions, [1, 1, 1, 2]);
    for (const a of state.combat.tokens)
      for (const b of state.combat.tokens) {
        const server = creatureDistance(
          { width: 1000, height: 1000, calibration: GRID },
          { position: a.position!, sizeCells: a.sizeCells, sizePx: a.sizePx },
          { position: b.position!, sizeCells: b.sizeCells, sizePx: b.sizePx }
        );
        expect(creatureDistanceFeet(CALIBRATION, a, b)).toBe(server?.value);
      }
  });

  it("catches the same creatures under every shape", () => {
    const positions = [cell(2, 2), cell(3, 2), cell(4, 4), cell(6, 2), cell(2, 6), cell(5, 5), cell(8, 8)];
    const state = table(positions);
    const placements: ReadonlyArray<[AnnotationShapeKind, { x: number; y: number }, { x: number; y: number }]> = [
      ["circle", cell(3, 3), cell(5, 3)],
      ["circle", { x: 150, y: 150 }, { x: 260, y: 160 }],
      ["cone", cell(2, 2), cell(6, 2)],
      ["cone", cell(2, 2), cell(5, 5)],
      ["line", cell(2, 2), cell(8, 8)],
      ["square", cell(2, 2), cell(4, 4)]
    ];
    for (const [shape, origin, target] of placements) {
      const snapped = shapeGeometry(GRID, shape, origin, target);
      const server = tokensInTemplate(state, GRID, snapped, shape, null);
      expect(caughtByArea(CALIBRATION, shape, { origin, target }, null, state.combat.tokens).sort()).toEqual(
        [...server].sort()
      );
    }
  });

  it("catches the same creatures with an action's own area, whatever length the drag has", () => {
    const positions = [cell(2, 2), cell(3, 2), cell(4, 4), cell(6, 2), cell(2, 6), cell(5, 5), cell(8, 8)];
    const state = table(positions);
    // A 15-foot Cone dragged one square, a 10-foot-radius Sphere dragged one, a 15-foot Cube dragged two.
    const placements = [
      { area: { shape: "cone", sizeFeet: 15 }, origin: cell(2, 2), target: cell(3, 2) },
      { area: { shape: "sphere", sizeFeet: 10 }, origin: cell(4, 3), target: cell(5, 3) },
      { area: { shape: "cube", sizeFeet: 15 }, origin: { x: 100, y: 100 }, target: { x: 200, y: 200 } }
    ] as const;
    for (const { area, origin, target } of placements) {
      const placed = templateOfArea(GRID, { origin, target }, area);
      const snapped = shapeGeometry(GRID, placed.shape, placed.origin, placed.target);
      const server = tokensInTemplate(state, GRID, snapped, placed.shape, null);
      const hint = caughtByArea(
        CALIBRATION,
        placed.shape,
        { origin, target },
        null,
        state.combat.tokens,
        area.sizeFeet
      );
      expect(hint.sort()).toEqual([...server].sort());
    }
    // The drag's own length would have caught fewer.
    const dragged = { origin: cell(4, 3), target: cell(5, 3) };
    expect(caughtByArea(CALIBRATION, "circle", dragged, null, state.combat.tokens)).toEqual([ids[2]]);
    expect(caughtByArea(CALIBRATION, "circle", dragged, null, state.combat.tokens, 10).sort()).toEqual(
      [ids[1], ids[2]].sort()
    );
  });
});
