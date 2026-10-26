import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { templateOfArea } from "../src/annotations.js";
import { cellCenterImage, tokensInTemplate } from "../src/area-targeting.js";
import { ContentLibrary } from "../src/content-library.js";
import { startEncounter } from "../src/encounter.js";
import type { SquareGridCalibration } from "../src/grid-calibration.js";

// SRD 5.2.1 Javelin of Lightning: "This bolt forms a 5-foot-wide Line between you and the target." A Line aimed at its
// target (`area.toTarget`) ends where it is aimed, no longer than its 120 feet, so a creature past the target on the
// same line is left out.

const CAL: SquareGridCalibration = {
  kind: "square",
  origin: { x: 0, y: 0 },
  cellSizePx: 50,
  rotationRadians: 0,
  distancePerCell: 5
};
const id = (n: number) => `10000000-0000-4000-8000-00000000003${n}`;
const at = (column: number, row: number) => cellCenterImage(CAL, column, row);

function placed(cells: ReadonlyArray<{ actor: string; column: number; row: number }>) {
  const game = GameStateSchema.parse({
    schemaVersion: 1,
    actors: cells.map(({ actor }) => ({
      id: actor,
      name: actor,
      kind: "monster",
      visibility: "public",
      hp: { current: 10, maximum: 10 }
    }))
  });
  startEncounter(
    game,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000031",
      entries: cells.map(({ actor }, index) => ({ actorId: actor, score: 20 - index }))
    },
    () => 1,
    { width: 2000, height: 2000, calibration: CAL }
  );
  const byActor = new Map(cells.map((cell) => [cell.actor, cell]));
  game.combat = {
    ...game.combat,
    tokens: game.combat.tokens.map((token) => ({
      ...token,
      position: at(byActor.get(token.actorId)!.column, byActor.get(token.actorId)!.row)
    }))
  };
  return game;
}

describe("a Line that ends at its target", () => {
  const bolt = new ContentLibrary()
    .forAudience("gm")
    .equipmentRecord("javelin-of-lightning")!
    .actions.find((action) => action.id === "lightning-bolt")!.area!;

  it("is the Javelin of Lightning's bolt", () => {
    expect(bolt).toEqual({ shape: "line", sizeFeet: 120, widthFeet: 5, toTarget: true });
  });

  it("leaves out a creature 60 feet away beyond a target 40 feet away", () => {
    const thrower = id(1);
    const target = id(2);
    const beyond = id(3);
    const game = placed([
      { actor: thrower, column: 0, row: 0 },
      { actor: target, column: 8, row: 0 },
      { actor: beyond, column: 12, row: 0 }
    ]);
    const aimed = templateOfArea(CAL, { origin: at(0, 0), target: at(8, 0) }, bolt);
    const caught = tokensInTemplate(game, CAL, aimed, "line", 5).filter((actor) => actor !== thrower);
    expect(caught).toEqual([target]);
    // A Line that keeps its full length reaches the creature beyond.
    const full = templateOfArea(CAL, { origin: at(0, 0), target: at(8, 0) }, { shape: "line", sizeFeet: 120 });
    expect(tokensInTemplate(game, CAL, full, "line", 5).filter((actor) => actor !== thrower)).toEqual([target, beyond]);
  });

  it("never reaches past its 120 feet", () => {
    const aimed = templateOfArea(CAL, { origin: at(0, 0), target: at(40, 0) }, bolt);
    expect(Math.round((aimed.target.x - aimed.origin.x) / CAL.cellSizePx)).toBe(24);
  });
});
