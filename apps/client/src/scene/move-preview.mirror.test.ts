import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import { GameStateSchema, type GameState, type GmActor } from "@vtt/domain";
import { movementCost } from "../../../server/src/terrain";
import type { TokenMapGeometry } from "../../../server/src/token-placement";
import { spaceSharingFor } from "../../../server/src/space-sharing";
import { moveLabel, movementWallsOf, previewMove } from "./movePreview";

// The drag preview and the server's charge must agree, so the preview runs the server's own scenarios.

const MAP = "20000000-0000-5000-8000-000000000001";
const HERO = "10000000-0000-4000-8000-000000000001";
const OGRE = "10000000-0000-4000-8000-000000000003";
const FRIEND = "10000000-0000-4000-8000-000000000002";

const CALIBRATION = { origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
const GRID: TokenMapGeometry = { width: 1000, height: 1000, calibration: { kind: "square", ...CALIBRATION } };
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });
const cells = (c0: number, r0: number, c1: number, r1: number) => ({
  x: 50 * c0,
  y: 50 * r0,
  width: 50 * (c1 - c0 + 1),
  height: 50 * (r1 - r0 + 1)
});

let wallCount = 0;
const wall = (a: { x: number; y: number }, b: { x: number; y: number }, kind = "wall", open = false) => ({
  id: `50000000-0000-4000-8000-${String(++wallCount).padStart(12, "0")}`,
  kind,
  a,
  b,
  ...(kind === "door" ? { open } : {})
});

function table(
  terrain: ReadonlyArray<ReturnType<typeof cells>>,
  positions: Readonly<Record<string, { x: number; y: number }>>,
  walls: ReadonlyArray<ReturnType<typeof wall>> = []
): GameState {
  const actors = [
    { id: HERO, name: "Borin", kind: "player-character", visibility: "public" },
    { id: FRIEND, name: "Mirena", kind: "player-character", visibility: "public" },
    { id: OGRE, name: "Ogre", kind: "monster", visibility: "public", size: "large" }
  ] as const;
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: actors.map((actor) => ({ ...actor, hp: { current: 10, maximum: 10 } })),
    combat: {
      active: true,
      round: 1,
      turnActorId: HERO,
      mapAssetId: MAP,
      initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
      tokens: actors
        .filter((actor) => positions[actor.id] !== undefined)
        .map((actor) => ({
          actorId: actor.id,
          position: positions[actor.id],
          sizePx: 40,
          sizeCells: actor.id === OGRE ? 2 : 1
        })),
      terrain: { difficult: terrain },
      vision: {
        enabled: walls.length > 0,
        walls,
        measure: { width: 1000, height: 1000, pixelsPerFoot: 10 }
      }
    }
  });
}

const preview = (state: GameState, from: { x: number; y: number }, to: { x: number; y: number }) =>
  previewMove({
    walls: state.combat.vision.enabled ? movementWallsOf(state.combat.vision.walls) : [],
    calibration: CALIBRATION,
    size: { width: GRID.width, height: GRID.height },
    terrain: state.combat.terrain.difficult,
    tokens: state.combat.tokens,
    actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
    moverId: HERO,
    from,
    to
  });

describe("the drag preview charges what the server charges", () => {
  const scenarios: ReadonlyArray<readonly [string, GameState, { x: number; y: number }, { x: number; y: number }]> = [
    ["open ground", table([], {}), cell(0, 0), cell(6, 3)],
    ["a band of rubble", table([cells(3, 0, 3, 19)], {}), cell(0, 5), cell(6, 5)],
    ["a patch to walk round", table([cells(3, 4, 3, 6)], {}), cell(0, 5), cell(6, 5)],
    ["an ogre at the map's edge", table([], { [OGRE]: { x: 150, y: 50 } }), cell(0, 0), cell(4, 0)],
    ["an ally in a corridor", table([cells(0, 1, 19, 19)], { [FRIEND]: cell(2, 0) }), cell(0, 0), cell(4, 0)],
    ["a wall to walk round", table([], {}, [wall({ x: 150, y: 100 }, { x: 150, y: 450 })]), cell(0, 5), cell(6, 5)],
    [
      "a closed door in a wall",
      table([], {}, [
        wall({ x: 150, y: 0 }, { x: 150, y: 250 }),
        wall({ x: 150, y: 250 }, { x: 150, y: 300 }, "door"),
        wall({ x: 150, y: 300 }, { x: 150, y: 1000 })
      ]),
      cell(0, 5),
      cell(6, 5)
    ],
    [
      "an open door in a wall",
      table([], {}, [
        wall({ x: 150, y: 0 }, { x: 150, y: 250 }),
        wall({ x: 150, y: 250 }, { x: 150, y: 300 }, "door", true),
        wall({ x: 150, y: 300 }, { x: 150, y: 1000 })
      ]),
      cell(0, 5),
      cell(6, 5)
    ]
  ];

  it.each(scenarios)("%s", (_label, state, from, to) => {
    const charged = movementCost(state, GRID, HERO, from, to);
    const previewed = preview(state, from, to);
    expect(previewed?.feet).toBe(charged?.feet);
    expect(previewed?.difficultFeet).toBe(charged?.difficultFeet);
    // The drawn path starts and ends on the two positions.
    expect(previewed?.path[0]).toEqual(from);
    expect(previewed?.path.at(-1)).toEqual(to);
  });

  it("says what the move leaves of the turn, and when it is too far", () => {
    const state = table([cells(3, 0, 3, 19)], {});
    const move = preview(state, cell(0, 5), cell(6, 5))!;
    expect(moveLabel(move, null).text).toBe("35 ft (5 ft difficult)");
    expect(moveLabel(move, { counted: true, speedFeet: 40, usedFeet: 0, enforcement: "strict" })).toEqual({
      text: "35 ft (5 ft difficult) · 5 ft left",
      over: false
    });
    expect(moveLabel(move, { counted: true, speedFeet: 30, usedFeet: 0, enforcement: "strict" })).toEqual({
      text: "35 ft (5 ft difficult) · 5 ft too far",
      over: true
    });
    // Off the mover's turn nothing is spent, so only the cost shows.
    expect(moveLabel(move, { counted: false, speedFeet: 30, usedFeet: 0, enforcement: "strict" }).text).toBe(
      "35 ft (5 ft difficult)"
    );
  });
});

describe("the drag preview follows the server through other creatures and slow movement", () => {
  const withOptions = (state: GameState, extraPerStep: number, size = { width: GRID.width, height: GRID.height }) =>
    previewMove({
      calibration: CALIBRATION,
      size,
      terrain: state.combat.terrain.difficult,
      tokens: state.combat.tokens,
      actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
      moverId: HERO,
      from: cell(0, 0),
      to: cell(4, 0),
      extraPerStep
    });

  it("crawls at an extra foot per foot, as the server charges", () => {
    const state = table([cells(2, 0, 2, 19)], {});
    const charged = movementCost(state, GRID, HERO, cell(0, 0), cell(4, 0), { extraPerStep: 1 });
    expect(withOptions(state, 1)?.feet).toBe(charged?.feet);
    expect(charged?.feet).toBe(45);
  });

  it("goes round an ogre it can't pass, through a Stunned one, and finds no way along a held corridor", () => {
    const state = table([cells(0, 2, 19, 19)], { [OGRE]: { x: 150, y: 50 } });
    expect(withOptions(state, 0)?.feet).toBe(movementCost(state, GRID, HERO, cell(0, 0), cell(4, 0))?.feet);
    state.actors.find((actor) => actor.id === OGRE)!.conditions = [{ id: "stunned" }];
    expect(withOptions(state, 0)?.feet).toBe(movementCost(state, GRID, HERO, cell(0, 0), cell(4, 0))?.feet);
    const corridor = table([], { [OGRE]: { x: 150, y: 50 } });
    const narrow = { ...GRID, height: 100 };
    expect(movementCost(corridor, narrow, HERO, cell(0, 0), cell(4, 0))?.blocked).toBe(true);
    const previewed = withOptions(corridor, 0, { width: GRID.width, height: 100 });
    expect(previewed?.blocked).toBe(true);
    expect(moveLabel(previewed!, null)).toEqual({ text: "No way through", over: true });
  });

  it("measures a teleport straight, and counts a flight against the Fly budget", () => {
    const state = table([cells(2, 0, 2, 19)], {});
    const teleport = previewMove({
      calibration: CALIBRATION,
      size: { width: GRID.width, height: GRID.height },
      terrain: state.combat.terrain.difficult,
      tokens: state.combat.tokens,
      actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
      moverId: HERO,
      from: cell(0, 0),
      to: cell(6, 0),
      free: true
    })!;
    expect(moveLabel(teleport, null, "teleport")).toEqual({ text: "Teleport 30 ft", over: false });
    const flight = preview(table([], {}), cell(0, 0), cell(10, 0))!;
    const budget = {
      counted: true,
      speedFeet: 40,
      usedFeet: 0,
      enforcement: "strict" as const,
      modes: [
        { mode: "walk" as const, budgetFeet: 40, extraCost: false },
        { mode: "fly" as const, budgetFeet: 80, extraCost: false }
      ]
    };
    expect(moveLabel(flight, budget, "fly")).toEqual({ text: "50 ft · 30 ft left", over: false });
    expect(moveLabel(flight, budget, "walk")).toEqual({ text: "50 ft · 10 ft too far", over: true });
  });
});

describe("the drag preview counts height as the server does", () => {
  const aloft = (
    state: GameState,
    from: { x: number; y: number },
    to: { x: number; y: number },
    fromFeet: number,
    toFeet: number
  ) =>
    previewMove({
      calibration: CALIBRATION,
      size: { width: GRID.width, height: GRID.height },
      terrain: state.combat.terrain.difficult,
      tokens: state.combat.tokens,
      actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
      moverId: HERO,
      from,
      to,
      altitude: { fromFeet, toFeet }
    });

  it.each([
    ["rising in place", cell(0, 0), cell(0, 0), 0, 30],
    ["across while rising less", cell(0, 0), cell(6, 0), 10, 30],
    ["across while rising more", cell(0, 0), cell(2, 0), 0, 40]
  ] as const)("%s", (_label, from, to, fromFeet, toFeet) => {
    const state = table([], {});
    const charged = movementCost(state, GRID, HERO, from, to, { altitude: { fromFeet, toFeet } });
    expect(aloft(state, from, to, fromFeet, toFeet)?.feet).toBe(charged?.feet);
  });

  it("flies over rubble and over an ogre below, as the server does", () => {
    const state = table([cells(2, 0, 2, 19)], { [OGRE]: { x: 250, y: 50 } });
    const charged = movementCost(state, GRID, HERO, cell(0, 0), cell(8, 0), {
      altitude: { fromFeet: 20, toFeet: 20 }
    });
    expect(charged?.feet).toBe(40);
    expect(aloft(state, cell(0, 0), cell(8, 0), 20, 20)?.feet).toBe(charged?.feet);
  });
});

describe("the drag preview squeezes and passes walls as the server does", () => {
  // A wall along x = 150 with an open door one cell wide between y = 250 and y = 300.
  const doorway = () =>
    table([], { [OGRE]: { x: 50, y: 300 } }, [
      wall({ x: 150, y: 0 }, { x: 150, y: 250 }),
      wall({ x: 150, y: 250 }, { x: 150, y: 300 }, "door", true),
      wall({ x: 150, y: 300 }, { x: 150, y: 1000 })
    ]);
  const ogrePreview = (state: GameState, extra: { throughWalls?: boolean } = {}) =>
    previewMove({
      walls: movementWallsOf(state.combat.vision.walls),
      calibration: CALIBRATION,
      size: { width: GRID.width, height: GRID.height },
      terrain: state.combat.terrain.difficult,
      tokens: state.combat.tokens,
      actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
      moverId: OGRE,
      from: { x: 50, y: 300 },
      to: { x: 300, y: 300 },
      ...extra
    });

  it("squeezes a Large creature through a 5-foot door as through Difficult Terrain", () => {
    const state = doorway();
    const charged = movementCost(state, GRID, OGRE, { x: 50, y: 300 }, { x: 300, y: 300 });
    expect(charged?.blocked).toBeUndefined();
    expect(charged?.difficultFeet).toBeGreaterThan(0);
    const previewed = ogrePreview(state);
    expect(previewed?.feet).toBe(charged?.feet);
    expect(previewed?.difficultFeet).toBe(charged?.difficultFeet);
  });

  it("passes an incorporeal mover through a wall as through Difficult Terrain", () => {
    const state = table([], { [OGRE]: { x: 50, y: 300 } }, [wall({ x: 150, y: 0 }, { x: 150, y: 1000 })]);
    expect(movementCost(state, GRID, OGRE, { x: 50, y: 300 }, { x: 300, y: 300 })?.blocked).toBe(true);
    const charged = movementCost(state, GRID, OGRE, { x: 50, y: 300 }, { x: 300, y: 300 }, { throughWalls: true });
    expect(charged?.blocked).toBeUndefined();
    expect(ogrePreview(state, { throughWalls: true })?.feet).toBe(charged?.feet);
  });
});

describe("the drag preview leaves Difficult Terrain free under Freedom of Movement, as the server does", () => {
  it("charges rubble as open ground", () => {
    const state = table([cells(2, 0, 3, 19)], {});
    const charged = movementCost(state, GRID, HERO, cell(0, 5), cell(6, 5), { ignoresDifficult: true });
    expect(charged?.feet).toBe(30);
    expect(charged?.difficultFeet).toBe(0);
    const previewed = previewMove({
      calibration: CALIBRATION,
      size: { width: GRID.width, height: GRID.height },
      terrain: state.combat.terrain.difficult,
      tokens: state.combat.tokens,
      actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
      moverId: HERO,
      from: cell(0, 5),
      to: cell(6, 5),
      ignoresDifficult: true
    });
    expect(previewed?.feet).toBe(charged?.feet);
  });
});

describe("the drag preview takes jumps and granted moves as the server does", () => {
  const base = (state: GameState) => ({
    calibration: CALIBRATION,
    size: { width: GRID.width, height: GRID.height },
    terrain: state.combat.terrain.difficult,
    tokens: state.combat.tokens,
    actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
    moverId: HERO
  });

  it("measures a jump straight over rubble and creatures, a foot of movement for each foot", () => {
    const state = table([cells(2, 0, 3, 0)], { [FRIEND]: cell(4, 0) });
    const leap = previewMove({ ...base(state), from: cell(0, 0), to: cell(6, 0), straight: true })!;
    expect(leap.feet).toBe(30);
    expect(leap.free).toBeUndefined();
    const budget = { counted: true, speedFeet: 30, usedFeet: 0, enforcement: "strict" as const };
    expect(moveLabel(leap, budget, "jump")).toEqual({ text: "30 ft · 0 ft left", over: false });
  });

  it("names the granted move or teleport a drag is taken with, and a teleport past its range", () => {
    const state = table([], {});
    const walk = preview(state, cell(0, 0), cell(4, 0))!;
    const granted = {
      counted: false,
      speedFeet: 40,
      usedFeet: 0,
      enforcement: "strict" as const,
      granted: { name: "Pounce", feet: 20, provokes: true }
    };
    expect(moveLabel(walk, granted)).toEqual({ text: "20 ft · Pounce", over: false });
    const blink = previewMove({ ...base(state), from: cell(0, 0), to: cell(8, 0), free: true })!;
    const misty = { counted: true, speedFeet: 30, usedFeet: 0, enforcement: "strict" as const };
    expect(moveLabel(blink, { ...misty, teleport: { name: "Misty Step", feet: 30 } }, "teleport")).toEqual({
      text: "Misty Step 40 ft · 10 ft too far",
      over: true
    });
  });
});

describe("the drag preview follows the server through creatures that share spaces", () => {
  const ELEMENTAL = "10000000-0000-4000-8000-000000000004";
  const RATS = "10000000-0000-4000-8000-000000000005";
  const monsters = new Map(loadMonsterDefinitions().map((definition) => [definition.source.externalId, definition]));
  const resolve = (definitionId: string) => monsters.get(definitionId);
  // One row of cells, so a creature that bars the way leaves no way round it.
  const corridor = { ...GRID, height: 50 };

  function hall(positions: Readonly<Record<string, { x: number; y: number }>>): GameState {
    const actors = [
      { id: HERO, name: "Borin", kind: "player-character" },
      { id: FRIEND, name: "Mirena", kind: "player-character" },
      { id: ELEMENTAL, name: "Air Elemental", kind: "monster", definitionId: "air-elemental" },
      { id: RATS, name: "Swarm of Rats", kind: "monster", definitionId: "swarm-of-rats" }
    ];
    return GameStateSchema.parse({
      schemaVersion: 1,
      actors: actors.map((actor) => ({ ...actor, visibility: "public", hp: { current: 10, maximum: 10 } })),
      combat: {
        active: true,
        round: 1,
        turnActorId: HERO,
        mapAssetId: MAP,
        initiative: actors.map((actor, index) => ({ actorId: actor.id, score: 20 - index })),
        tokens: actors
          .filter((actor) => positions[actor.id] !== undefined)
          .map((actor) => ({ actorId: actor.id, position: positions[actor.id], sizePx: 40, sizeCells: 1 }))
      }
    });
  }

  /** The server's charge and the preview's, each told what the movement reply tells the client. */
  function both(state: GameState, moverId: string, from: { x: number; y: number }, to: { x: number; y: number }) {
    const sharing = spaceSharingFor(state, moverId, resolve, () => false);
    const charged = movementCost(state, corridor, moverId, from, to, {
      resolveDefinition: resolve,
      ...(sharing.passesCreatures ? { passesCreatures: true } : {})
    });
    const previewed = previewMove({
      calibration: CALIBRATION,
      size: { width: corridor.width, height: corridor.height },
      terrain: [],
      tokens: state.combat.tokens,
      actorsById: new Map(state.actors.map((actor) => [actor.id, actor as GmActor])),
      moverId,
      from,
      to,
      ...(sharing.passesCreatures ? { passesCreatures: true } : {}),
      ...(sharing.swarmIds ? { swarmIds: sharing.swarmIds } : {})
    });
    return { charged, previewed };
  }

  it("takes an air elemental through two characters, as Difficult Terrain", () => {
    const state = hall({ [ELEMENTAL]: cell(0, 0), [HERO]: cell(2, 0), [FRIEND]: cell(3, 0) });
    const { charged, previewed } = both(state, ELEMENTAL, cell(0, 0), cell(5, 0));
    expect(charged).toMatchObject({ feet: 35, difficultFeet: 10 });
    expect(previewed?.blocked).toBeUndefined();
    expect(previewed?.feet).toBe(charged?.feet);
    expect(previewed?.difficultFeet).toBe(charged?.difficultFeet);
  });

  it("takes a fighter through a swarm of rats at double cost", () => {
    const state = hall({ [HERO]: cell(0, 0), [RATS]: cell(2, 0) });
    const { charged, previewed } = both(state, HERO, cell(0, 0), cell(4, 0));
    expect(charged).toMatchObject({ feet: 25, difficultFeet: 5 });
    expect(previewed?.feet).toBe(charged?.feet);
    expect(previewed?.difficultFeet).toBe(charged?.difficultFeet);
  });
});
