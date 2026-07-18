import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { addActorFromDefinition } from "../src/actor-roster.js";
import { startEncounter } from "../src/encounter.js";
import { moveEncounterToken } from "../src/token-placement.js";

const IDS = {
  pc: "10000000-0000-4000-8000-000000000001",
  large: "10000000-0000-4000-8000-000000000002",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const CALIBRATION = { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 } as const;
const GEOMETRY = { width: 1000, height: 800, calibration: CALIBRATION } as const;
const aboleth = loadMonsterDefinitions().find((definition) => definition.source.externalId === "aboleth")!;

function state() {
  const game = GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.pc, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 } }
  ] });
  addActorFromDefinition(game, aboleth, IDS.large, "public");
  return game;
}

describe("token footprints", () => {
  it("carries the definition footprint onto the actor and scales the token", () => {
    const game = state();
    expect(game.actors[1].sizeCells).toBe(2); // large 2x2
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.pc, score: 15 }, { actorId: IDS.large, score: 10 }] }, () => 1, GEOMETRY);
    const pcToken = game.combat.tokens.find((token) => token.actorId === IDS.pc)!;
    const largeToken = game.combat.tokens.find((token) => token.actorId === IDS.large)!;
    expect(pcToken.sizeCells).toBe(1);
    expect(pcToken.sizePx).toBeCloseTo(41, 0); // 50 * .82
    expect(largeToken.sizeCells).toBe(2);
    expect(largeToken.sizePx).toBeCloseTo(96, 0); // 50 * (2 - .08)
    expect(GameStateSchema.safeParse(game).success).toBe(true);
  });

  it("snaps odd footprints to cell centers and even footprints to grid intersections", () => {
    const game = state();
    startEncounter(game, { mapAssetId: IDS.map, entries: [{ actorId: IDS.pc, score: 15 }, { actorId: IDS.large, score: 10 }] }, () => 1, GEOMETRY);
    moveEncounterToken(game, IDS.pc, { x: 212, y: 212 }, GEOMETRY);
    const pcToken = game.combat.tokens.find((token) => token.actorId === IDS.pc)!;
    expect(pcToken.position).toEqual({ x: 225, y: 225 }); // cell center (4.5, 4.5)
    moveEncounterToken(game, IDS.large, { x: 212, y: 212 }, GEOMETRY);
    const largeToken = game.combat.tokens.find((token) => token.actorId === IDS.large)!;
    expect(largeToken.position).toEqual({ x: 200, y: 200 }); // intersection (4, 4): covers four cells
  });
});
