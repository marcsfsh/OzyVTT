import { describe, expect, it } from "vitest";
import { shapeGeometry, templateOfArea } from "../../../server/src/annotations";
import { sizedShapePreview } from "./gridPreview";

// An area template's preview and the area the server resolves must agree: the action's own size, wherever the drag
// places and points it.

const CALIBRATION = { origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

describe("an area template's preview", () => {
  const cases = [
    { area: { shape: "sphere", sizeFeet: 20 }, shape: "circle", to: cell(11, 5) },
    { area: { shape: "cone", sizeFeet: 30 }, shape: "cone", to: cell(10, 4) },
    { area: { shape: "line", sizeFeet: 60 }, shape: "line", to: cell(10, 6) },
    { area: { shape: "cube", sizeFeet: 15 }, shape: "square", to: cell(9, 4) }
  ] as const;

  for (const { area, shape, to } of cases)
    it(`draws a ${area.sizeFeet}-foot ${area.shape} where the server resolves it, from a one-cell drag`, () => {
      const server = templateOfArea({ kind: "square", ...CALIBRATION }, { origin: cell(10, 5), target: to }, area);
      const drawn = shapeGeometry({ kind: "square", ...CALIBRATION }, server.shape, server.origin, server.target);
      const preview = sizedShapePreview(CALIBRATION, shape, cell(10, 5), to, area.sizeFeet);
      expect(server.shape).toBe(shape);
      expect(preview).toEqual({ origin: drawn.origin, target: drawn.target, feet: drawn.sizeFeet });
      expect(preview.feet).toBe(area.sizeFeet);
    });

  it("stops a Line aimed at its target where it is dragged, as the server does, and never past its size", () => {
    const area = { shape: "line", sizeFeet: 120, toTarget: true } as const;
    for (const to of [cell(18, 5), cell(40, 5)]) {
      const server = templateOfArea({ kind: "square", ...CALIBRATION }, { origin: cell(10, 5), target: to }, area);
      const drawn = shapeGeometry({ kind: "square", ...CALIBRATION }, server.shape, server.origin, server.target);
      const preview = sizedShapePreview(CALIBRATION, "line", cell(10, 5), to, area.sizeFeet, true);
      expect(preview).toEqual({ origin: drawn.origin, target: drawn.target, feet: drawn.sizeFeet });
    }
    expect(sizedShapePreview(CALIBRATION, "line", cell(10, 5), cell(18, 5), 120, true).feet).toBe(40);
    expect(sizedShapePreview(CALIBRATION, "line", cell(10, 5), cell(40, 5), 120, true).feet).toBe(120);
  });
});
