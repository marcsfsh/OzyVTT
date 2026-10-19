import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { areaOriginHeight, withinAreaHeight } from "../src/altitude.js";
import { RulesBlockedError } from "../src/game-store.js";
import { applyMovementRules } from "../src/movement-rules.js";
import { creatureDistance, footprintOf, mapDistance, narrateTokenMove } from "../src/movement-narration.js";
import { movementCost } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import { bootMovementServer, cell } from "./movement-fixtures.js";

// SRD 5.2.1 height on a flat map: a token's altitude counts in every distance between creatures by the grid's own
// diagonal rule, a move pays for the height it gains or loses, and only flying, climbing, jumping or teleporting
// changes it.

const DRAGON = "10000000-0000-4000-8000-0000000000a1";
const ORC = "10000000-0000-4000-8000-0000000000a2";
const HERO = "10000000-0000-4000-8000-0000000000a3";
const OGRE = "10000000-0000-4000-8000-0000000000a4";

const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const GRIDLESS: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: null,
  scale: { kind: "image-scale", distancePerPixel: 0.1, unit: "ft" }
};

const statBlock = (speeds: Record<string, unknown>) =>
  ({
    actions: [],
    token: { disposition: "hostile" },
    extensions: { "open5e.srd-2024": { speeds } }
  }) as unknown as ActorDefinition;
const DEFINITIONS: Record<string, ActorDefinition> = {
  dragon: statBlock({ walk: 40, fly: 80 }),
  orc: statBlock({ walk: 30 })
};
const resolveDefinition = (id: string) => DEFINITIONS[id];

function game(
  positions: Readonly<Record<string, { x: number; y: number; altitudeFeet?: number; airborne?: "fly" }>>,
  turn = DRAGON
): GameState {
  const actors = [
    { id: DRAGON, name: "Dragon", kind: "monster", speedFeet: 40, definitionId: "dragon" },
    { id: ORC, name: "Orc", kind: "monster", speedFeet: 30, definitionId: "orc" },
    { id: HERO, name: "Borin", kind: "player-character", speedFeet: 30 },
    { id: OGRE, name: "Ogre", kind: "monster", speedFeet: 40, size: "large", definitionId: "orc" }
  ];
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map((actor) => ({ ...actor, visibility: "public", hp: { current: 30, maximum: 30 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: turn,
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: actors
        .filter((actor) => positions[actor.id] !== undefined)
        .map((actor) => {
          const { x, y, altitudeFeet, airborne } = positions[actor.id]!;
          return {
            actorId: actor.id,
            position: { x, y },
            sizePx: actor.id === OGRE ? 90 : 40,
            sizeCells: actor.id === OGRE ? 2 : 1,
            ...(altitudeFeet ? { altitudeFeet } : {}),
            ...(airborne ? { airborne } : {})
          };
        })
    }
  });
}

let prompts = 0;
function move(
  state: GameState,
  actorId: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  options: { mode?: "walk" | "fly" | "climb"; fromAltitudeFeet?: number; toAltitudeFeet?: number; byPlayer?: boolean }
) {
  return applyMovementRules(state, {
    actorId,
    from,
    to,
    ...(options.mode ? { mode: options.mode } : {}),
    fromAltitudeFeet: options.fromAltitudeFeet ?? 0,
    toAltitudeFeet: options.toAltitudeFeet ?? options.fromAltitudeFeet ?? 0,
    byPlayer: options.byPlayer ?? false,
    distance: (a, b) => mapDistance(GRID, a, b)?.value ?? null,
    cost: (a, b, costOptions) => movementCost(state, GRID, actorId, a, b, costOptions),
    creatureDistance: (enemy, point, altitudeFeet) => {
      const enemyToken = state.combat.tokens.find((token) => token.actorId === enemy.actorId)!;
      const moverToken = state.combat.tokens.find((token) => token.actorId === actorId)!;
      return (
        creatureDistance(GRID, footprintOf(enemyToken, enemy.position), footprintOf(moverToken, point, altitudeFeet))
          ?.value ?? null
      );
    },
    calibration: GRID.calibration,
    override: null,
    resolveDefinition,
    newPromptId: () => `70000000-0000-4000-8000-${String(++prompts).padStart(12, "0")}`,
    now: () => 0,
    commandId: "50000000-0000-4000-8000-000000000001"
  });
}
const blockedBy = (call: () => unknown): string => {
  try {
    call();
  } catch (error) {
    if (error instanceof RulesBlockedError) return error.rule;
    throw error;
  }
  return "nothing";
};
const medium = (position: { x: number; y: number }, altitudeFeet?: number) => ({
  position,
  sizeCells: 1,
  sizePx: 40,
  ...(altitudeFeet ? { altitudeFeet } : {})
});

describe("distance counts height", () => {
  it("measures up and down by the grid's diagonal rule, the larger of across and up", () => {
    const at = (feet?: number) => creatureDistance(GRID, medium(cell(0, 0)), medium(cell(1, 0), feet))?.value;
    expect(at()).toBe(5);
    // One square up and one across is one square away; two up is two.
    expect(at(5)).toBe(5);
    expect(at(10)).toBe(10);
    expect(at(30)).toBe(30);
    // Straight overhead, as far as the height between them.
    expect(creatureDistance(GRID, medium(cell(0, 0)), medium(cell(0, 0), 20))?.value).toBe(20);
  });

  it("measures from the top of a tall creature's space", () => {
    const ogre = { position: { x: 50, y: 50 }, sizeCells: 2, sizePx: 90 };
    // A Large space is 10 feet tall: a creature standing on its head is adjacent.
    expect(creatureDistance(GRID, ogre, medium(cell(0, 0), 10))?.value).toBe(5);
    expect(creatureDistance(GRID, ogre, medium(cell(0, 0), 20))?.value).toBe(15);
  });

  it("measures straight through the air on a gridless map", () => {
    const flier = medium({ x: 300, y: 0 }, 40);
    expect(creatureDistance(GRIDLESS, medium({ x: 0, y: 0 }), flier)?.value).toBe(50);
  });
});

describe("moving changes height", () => {
  it("charges the rise by the same diagonal rule: the larger of across and up", () => {
    const state = game({ [DRAGON]: cell(0, 0) });
    move(state, DRAGON, cell(0, 0), cell(0, 0), { mode: "fly", toAltitudeFeet: 30 });
    expect(state.combat.turn.movementUsedFeet).toBe(30);
    // Thirty across while rising twenty costs thirty; ten across while rising forty costs forty.
    move(state, DRAGON, cell(0, 0), cell(6, 0), { mode: "fly", fromAltitudeFeet: 30, toAltitudeFeet: 50 });
    expect(state.combat.turn.movementUsedFeet).toBe(60);
    expect(blockedBy(() => move(state, DRAGON, cell(6, 0), cell(8, 0), { mode: "fly", toAltitudeFeet: 80 }))).toBe(
      "movement.exceeds-speed"
    );
  });

  it("keeps a walker at its height, and a creature in the air moves by flying", () => {
    const state = game({ [HERO]: cell(0, 0), [DRAGON]: { ...cell(5, 5), altitudeFeet: 20, airborne: "fly" } }, HERO);
    expect(blockedBy(() => move(state, HERO, cell(0, 0), cell(0, 0), { toAltitudeFeet: 10 }))).toBe(
      "movement.altitude"
    );
    // Climbing changes height, an extra foot for each foot without a Climb Speed.
    move(state, HERO, cell(0, 0), cell(0, 0), { mode: "climb", toAltitudeFeet: 10 });
    expect(state.combat.turn.movementUsedFeet).toBe(20);
    const dragonTurn = game({ [DRAGON]: { ...cell(5, 5), altitudeFeet: 20, airborne: "fly" } });
    expect(blockedBy(() => move(dragonTurn, DRAGON, cell(5, 5), cell(6, 5), { fromAltitudeFeet: 20 }))).toBe(
      "movement.altitude"
    );
  });

  it("passes over painted terrain and over a creature below", () => {
    const state = game({ [DRAGON]: cell(0, 0), [ORC]: cell(2, 0) });
    state.combat.terrain.difficult = [{ x: 50, y: 0, width: 200, height: 50 }];
    move(state, DRAGON, cell(0, 0), cell(4, 0), { mode: "fly", fromAltitudeFeet: 20 });
    expect(state.combat.turn.movementUsedFeet).toBe(20);
    // It can end its move above the orc.
    expect(blockedBy(() => move(state, DRAGON, cell(4, 0), cell(2, 0), { mode: "fly", fromAltitudeFeet: 20 }))).toBe(
      "nothing"
    );
  });

  it("opens no Opportunity Attack for a flier passing high over an enemy, and one for a flier climbing out of reach", () => {
    const high = game({ [DRAGON]: { ...cell(0, 0), altitudeFeet: 30, airborne: "fly" }, [HERO]: cell(1, 0) });
    expect(move(high, DRAGON, cell(0, 0), cell(3, 0), { mode: "fly", fromAltitudeFeet: 30 }).prompts).toEqual([]);
    const rising = game({ [DRAGON]: cell(0, 0), [HERO]: cell(1, 0) });
    expect(move(rising, DRAGON, cell(0, 0), cell(0, 0), { mode: "fly", toAltitudeFeet: 30 }).prompts).toEqual([
      { actorId: HERO, name: "Borin" }
    ]);
  });

  it("says how high the mover ended up", () => {
    const state = game({ [DRAGON]: { ...cell(3, 0), altitudeFeet: 20, airborne: "fly" }, [ORC]: cell(0, 0) });
    expect(
      narrateTokenMove({ state, actorId: DRAGON, from: cell(0, 0), geometry: GRID, mode: "fly", fromAltitudeFeet: 0 })
        ?.publicText
    ).toBe("Dragon flew 20 ft, 20 ft up - Orc 0 ft → 20 ft.");
  });
});

describe("areas reach only as high as their shape", () => {
  it("spares a flier above a Sphere on the ground and catches one it is aimed at", () => {
    const state = game({ [DRAGON]: { ...cell(2, 0), altitudeFeet: 40, airborne: "fly" }, [ORC]: cell(2, 1) });
    const sphere = { shape: "sphere" as const, sizeFeet: 20, widthFeet: null };
    const ground = areaOriginHeight(state, HERO, false, ORC, 5);
    expect(withinAreaHeight(state, [DRAGON, ORC], sphere, ground, () => 5)).toEqual([ORC]);
    const aimed = areaOriginHeight(state, HERO, false, DRAGON, 5);
    expect(withinAreaHeight(state, [DRAGON, ORC], sphere, aimed, () => 5)).toEqual([DRAGON]);
    // A Cylinder stands up from the ground and catches both.
    expect(
      withinAreaHeight(state, [DRAGON, ORC], { shape: "cylinder", sizeFeet: 5, widthFeet: null }, ground, () => 5)
    ).toEqual([DRAGON, ORC]);
  });
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("height on the live table", () => {
  it("keeps the height a fly move ends at, and the GM can set one on a ledge", async () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: DRAGON, name: "Dragon", kind: "monster", definitionId: "adult-red-dragon", speedFeet: 40 },
        { id: ORC, name: "Orc", kind: "monster", speedFeet: 30 }
      ].map((actor) => ({ ...actor, visibility: "public", hp: { current: 30, maximum: 30 } }))
    });
    const { server, gmToken, startFight, move: moveToken, post } = await bootMovementServer(state, cleanups);
    await startFight([DRAGON, ORC], { [DRAGON]: cell(2, 2), [ORC]: cell(5, 5) });
    const flown = await moveToken(DRAGON, gmToken, { position: cell(3, 2), mode: "fly", altitudeFeet: 25 });
    expect(flown.status, await flown.clone().text()).toBe(200);
    expect(server.store.snapshot.combat.tokens.find((token) => token.actorId === DRAGON)).toMatchObject({
      altitudeFeet: 25,
      airborne: "fly"
    });
    const ledge = await post(GAME_PATHS.tokenAltitude.replace("{actorId}", ORC), gmToken, {
      actorId: ORC,
      altitudeFeet: 15,
      airborne: null
    });
    expect(ledge.status, await ledge.clone().text()).toBe(200);
    const orc = server.store.snapshot.combat.tokens.find((token) => token.actorId === ORC)!;
    expect(orc.altitudeFeet).toBe(15);
    expect(orc.airborne).toBeUndefined();
    const playerToken = server.auth.issuePlayerSession();
    const refused = await post(GAME_PATHS.tokenAltitude.replace("{actorId}", ORC), playerToken, {
      actorId: ORC,
      altitudeFeet: 0,
      commandId: randomUUID()
    });
    expect(refused.status).toBe(403);
  });
});
