import { GameStateSchema, type GameState } from "@vtt/domain";
import { describe, expect, it } from "vitest";
import { narrateTokenMove } from "../src/movement-narration.js";
import type { TokenMapGeometry } from "../src/token-placement.js";

const MAP = "20000000-0000-5000-8000-000000000001";
const MOVER = "10000000-0000-4000-8000-000000000001";
const ALLY = "10000000-0000-4000-8000-000000000002";
const LURKER = "10000000-0000-4000-8000-000000000003";

/** 50px cells, 5 ft each, origin at 0,0 — cell (c,r) center = (25 + 50c, 25 + 50r). */
const GRID: TokenMapGeometry = { width: 1000, height: 1000, calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 } };
const BARE: TokenMapGeometry = { width: 1000, height: 1000, calibration: null };
const SCALED: TokenMapGeometry = { width: 1000, height: 1000, calibration: null, scale: { kind: "image-scale", distancePerPixel: 0.1, unit: "ft" } };

const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });

function state(positions: Readonly<Record<string, { x: number; y: number } | null>>): GameState {
  const combatants = [
    { id: MOVER, name: "Borin", visibility: "public" },
    { id: ALLY, name: "Mirena", visibility: "public" },
    { id: LURKER, name: "Unseen Stalker", visibility: "gm-only" }
  ] as const;
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: combatants.map((actor) => ({ ...actor, kind: actor.id === LURKER ? "monster" : "player-character", hp: { current: 10, maximum: 10 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: MOVER,
      mapAssetId: MAP,
      initiative: combatants.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: combatants.filter((actor) => positions[actor.id] !== undefined).map((actor) => ({ actorId: actor.id, position: positions[actor.id], sizePx: 40 }))
    }
  });
}

describe("movement narration", () => {
  it("logs distance moved and old → new range to each combatant, hiding hidden ones from the public line", () => {
    // Borin ends at cell (4,0); he came from cell (0,0). Mirena at (1,0), the Stalker at (0,2).
    const narration = narrateTokenMove({ state: state({ [MOVER]: cell(4, 0), [ALLY]: cell(1, 0), [LURKER]: cell(0, 2) }), actorId: MOVER, from: cell(0, 0), geometry: GRID });
    expect(narration?.publicText).toBe("Borin moved 20 ft — Mirena 5 ft → 15 ft.");
    expect(narration?.gmText).toBe("Hidden ranges for Borin — Unseen Stalker 10 ft → 20 ft.");
  });

  it("keeps a hidden mover's narration entirely GM-only", () => {
    const narration = narrateTokenMove({ state: state({ [LURKER]: cell(2, 2), [MOVER]: cell(0, 0) }), actorId: LURKER, from: cell(0, 2), geometry: GRID });
    expect(narration?.publicText).toBeNull();
    expect(narration?.gmText).toBe("Unseen Stalker moved 10 ft — Borin 10 ft → 10 ft.");
  });

  it("narrates entering from the tray with current ranges only, and leaving with a bare line", () => {
    const entered = narrateTokenMove({ state: state({ [MOVER]: cell(2, 0), [ALLY]: cell(0, 0) }), actorId: MOVER, from: null, geometry: GRID });
    expect(entered?.publicText).toBe("Borin entered the map — Mirena 10 ft.");
    const left = narrateTokenMove({ state: state({ [MOVER]: null, [ALLY]: cell(0, 0) }), actorId: MOVER, from: cell(2, 0), geometry: GRID });
    expect(left?.publicText).toBe("Borin left the map.");
    expect(left?.gmText).toBeNull();
  });

  it("measures gridless maps by their saved scale, and stays numberless with neither", () => {
    const scaled = narrateTokenMove({ state: state({ [MOVER]: { x: 0, y: 100 }, [ALLY]: { x: 0, y: 400 } }), actorId: MOVER, from: { x: 0, y: 0 }, geometry: SCALED });
    expect(scaled?.publicText).toBe("Borin moved 10 ft — Mirena 40 ft → 30 ft.");
    const bare = narrateTokenMove({ state: state({ [MOVER]: cell(3, 0), [ALLY]: cell(0, 0) }), actorId: MOVER, from: cell(0, 0), geometry: BARE });
    expect(bare?.publicText).toBe("Borin moved.");
  });

  it("stays silent for a drag that snapped back to the same spot", () => {
    expect(narrateTokenMove({ state: state({ [MOVER]: cell(1, 1) }), actorId: MOVER, from: cell(1, 1), geometry: GRID })).toBeNull();
  });
});
