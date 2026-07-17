import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { cellCenterImage, parseAreaProse, tokensInTemplate } from "../src/area-targeting.js";
import { startEncounter } from "../src/encounter.js";
import type { SquareGridCalibration } from "../src/grid-calibration.js";

const CAL: SquareGridCalibration = { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
const GEOMETRY = { width: 2000, height: 2000, calibration: CAL };
const id = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const MAP = "20000000-0000-5000-8000-000000000001";

// Places each actor's token at a chosen cell (or footprint), so containment can be asserted precisely.
function placed(cells: ReadonlyArray<{ actor: string; column: number; row: number; sizeCells?: number }>) {
  const game = GameStateSchema.parse({ schemaVersion: 1, actors: cells.map(({ actor, sizeCells }) => ({ id: actor, name: actor, kind: "monster", visibility: "public", hp: { current: 10, maximum: 10 }, ...(sizeCells ? { sizeCells } : {}) })) });
  startEncounter(game, { mapAssetId: MAP, entries: cells.map(({ actor }, index) => ({ actorId: actor, score: 20 - index })) }, () => 1, GEOMETRY);
  const byActor = new Map(cells.map((cell) => [cell.actor, cell]));
  game.combat = { ...game.combat, tokens: game.combat.tokens.map((token) => ({ ...token, position: cellCenterImage(CAL, byActor.get(token.actorId)!.column, byActor.get(token.actorId)!.row) })) };
  return game;
}
const at = (column: number, row: number) => cellCenterImage(CAL, column, row);

describe("area-of-effect templates", () => {
  it("parses the SRD area phrasings, and nothing else", () => {
    expect(parseAreaProse("each creature in a 60-foot Cone")).toEqual({ shape: "cone", sizeFeet: 60, widthFeet: null });
    expect(parseAreaProse("a 60-foot-long, 5-foot-wide Line")).toEqual({ shape: "line", sizeFeet: 60, widthFeet: 5 });
    expect(parseAreaProse("a 20-foot-radius Sphere")).toEqual({ shape: "sphere", sizeFeet: 20, widthFeet: null });
    expect(parseAreaProse("a 15-foot Emanation")).toEqual({ shape: "emanation", sizeFeet: 15, widthFeet: null });
    expect(parseAreaProse("a 10-foot Cube")).toEqual({ shape: "cube", sizeFeet: 10, widthFeet: null });
    expect(parseAreaProse("Melee Attack Roll: +9, reach 10 ft.")).toBeNull();
  });

  it("catches tokens inside a circle and excludes ones outside or in the tray", () => {
    const game = placed([{ actor: id(1), column: 1, row: 0 }, { actor: id(2), column: 5, row: 0 }, { actor: id(3), column: 0, row: 1 }]);
    game.combat = { ...game.combat, tokens: game.combat.tokens.map((token) => token.actorId === id(3) ? { ...token, position: null } : token) };
    const caught = tokensInTemplate(game, CAL, { origin: at(0, 0), target: at(2, 0) }, "circle", null); // radius 2 cells
    expect(caught).toContain(id(1)); // cell (1,0): 1 cell away
    expect(caught).not.toContain(id(2)); // cell (5,0): far
    expect(caught).not.toContain(id(3)); // trayed (no position)
  });

  it("treats a square/cube as an axis-aligned box", () => {
    const game = placed([{ actor: id(1), column: 1, row: 1 }, { actor: id(2), column: 5, row: 5 }]);
    const caught = tokensInTemplate(game, CAL, { origin: at(0, 0), target: at(2, 2) }, "square", null);
    expect(caught).toEqual([id(1)]);
  });

  it("projects a cone from apex to base with widening half-angle", () => {
    const game = placed([{ actor: id(1), column: 3, row: 0 }, { actor: id(2), column: 2, row: 3 }]);
    const caught = tokensInTemplate(game, CAL, { origin: at(0, 0), target: at(5, 0) }, "cone", null); // length 5 along +x
    expect(caught).toContain(id(1)); // on the axis, well inside
    expect(caught).not.toContain(id(2)); // far off the axis (perp 3 > along/2)
  });

  it("uses the line width for line templates", () => {
    const game = placed([{ actor: id(1), column: 2, row: 0 }, { actor: id(2), column: 2, row: 2 }]);
    const caught = tokensInTemplate(game, CAL, { origin: at(0, 0), target: at(5, 0) }, "line", 5); // 5-ft (1 cell) wide along +x
    expect(caught).toContain(id(1)); // on the line
    expect(caught).not.toContain(id(2)); // two cells off the line, beyond half-width
  });

  it("catches a big token when ANY footprint cell is inside (2x2)", () => {
    // 2x2 token whose near footprint cell clips a radius-3 circle while its position sits outside.
    const game = placed([{ actor: id(1), column: 3, row: 0, sizeCells: 2 }]);
    const caught = tokensInTemplate(game, CAL, { origin: at(0, 0), target: at(3, 0) }, "circle", null); // radius 3 cells
    expect(caught).toContain(id(1));
  });
});
