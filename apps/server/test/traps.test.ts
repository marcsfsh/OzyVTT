import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { loadToolbox } from "@vtt/content-srd-5.2.1";
import { GameStateSchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { projectPlayerView } from "../src/projections.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import {
  disarmTrap,
  findTraps,
  placeTrap,
  springTrapOn,
  trapArmed,
  trapEntry,
  trapRecord,
  trapsAtTurnStart
} from "../src/traps.js";
import { projectViewerEncounter } from "../src/viewer-encounter.js";
import { bootMovementServer, cell } from "./movement-fixtures.js";

// SRD 5.2.1 Gameplay Toolbox, Traps: the eight sample traps set on the map, hidden from the players until found, going
// off on the creature that moves onto them, found by a Search or Study and made safe as their text says.

const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
const HERO = "10000000-0000-4000-8000-0000000000c1";
const ORC = "10000000-0000-4000-8000-0000000000c2";
const GIANT = "10000000-0000-4000-8000-0000000000c3";
const MAP = "20000000-0000-5000-8000-0000000000c1";
const GM = { role: "gm" } as const;
const GRID: TokenMapGeometry = {
  width: 1000,
  height: 1000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const calibration = GRID.calibration!;
/** The cells from (c0, r0) to (c1, r1), as a dragged rect. */
const cells = (c0: number, r0: number, c1 = c0, r1 = r0) => ({
  x: 50 * c0,
  y: 50 * r0,
  width: 50 * (c1 - c0 + 1),
  height: 50 * (r1 - r0 + 1)
});

let ids = 0;
const nextId = () => `50000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;
const deps = (faces: number[] = []) => ({
  resolveDefinition: () => undefined,
  catalog,
  rollDie: () => faces.shift() ?? 2,
  random: () => faces.shift() ?? 2,
  newId: nextId,
  now: () => "2026-10-26T00:00:00.000Z",
  geometry: GRID,
  sessionId: "30000000-0000-4000-8000-0000000000c1"
});

const creature = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  kind: "monster",
  visibility: "public",
  speedFeet: 30,
  hp: { current: 60, maximum: 60 },
  ...extra
});

/** A hall with the hero at (1,2), the orc at (8,8) and a Huge giant at (12,12); in a fight, the hero's turn. */
function hall(fighting = false): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      creature(HERO, "Vex", { kind: "player-character" }),
      creature(ORC, "Orc"),
      creature(GIANT, "Giant", { size: "huge" })
    ],
    combat: {
      active: fighting,
      round: 1,
      turnActorId: fighting ? HERO : null,
      mapAssetId: MAP,
      initiative: [
        { actorId: HERO, score: 20 },
        { actorId: ORC, score: 10 },
        { actorId: GIANT, score: 5 }
      ],
      tokens: [
        { actorId: HERO, position: cell(1, 2), sizePx: 40, sizeCells: 1 },
        { actorId: ORC, position: cell(8, 8), sizePx: 40, sizeCells: 1 },
        { actorId: GIANT, position: cell(12, 12), sizePx: 160, sizeCells: 3 }
      ]
    }
  });
}

const set = (state: GameState, trapId: string, area: ReturnType<typeof cells>, tier = 1) =>
  placeTrap(state, undefined, GRID, { id: nextId(), trapId, tier, rect: area }, GM);
const moveTo = (state: GameState, actorId: string, column: number, row: number) => {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: cell(column, row) } : token
  );
};
const savesOf = (state: GameState, actorId: string) =>
  state.combat.pendingSaves.filter((save) => save.targetActorId === actorId);

describe("the toolbox's traps", () => {
  it("builds the chapter's records: its traps, poisons, environmental effects, contagions, curse and sections", () => {
    const kinds = loadToolbox().reduce<Record<string, number>>((counts, record) => {
      counts[record.kind] = (counts[record.kind] ?? 0) + 1;
      return counts;
    }, {});
    expect(kinds).toEqual({ trap: 8, poison: 14, environment: 9, contagion: 3, curse: 1, section: 9 });
  });

  it("builds the eight sample traps with each band's numbers", () => {
    const traps = loadToolbox().filter((record) => record.kind === "trap");
    expect(traps.map((record) => record.id).sort()).toEqual([
      "collapsing-roof",
      "falling-net",
      "fire-casting-statue",
      "hidden-pit",
      "poisoned-darts",
      "poisoned-needle",
      "rolling-stone",
      "spiked-pit"
    ]);
    const roof = trapRecord("collapsing-roof")!.trap;
    expect(roof.tiers.map((tier) => [tier.save?.dc, tier.damage[0]?.formula])).toEqual([
      [13, "2d10"],
      [15, "4d10"],
      [17, "10d10"],
      [19, "18d10"]
    ]);
    expect(trapRecord("hidden-pit")!.trap.tiers.map((tier) => tier.pitFeet)).toEqual([10, 30, 60, 120]);
    expect(trapRecord("poisoned-needle")!.trap.disarm[0]!.check).toEqual({
      ability: "dex",
      skill: "sleight-of-hand",
      dc: 15,
      failureSprings: true
    });
  });
});

describe("a trap going off", () => {
  it("brings a collapsing roof down on each creature under it, Dexterity DC 13 for half, and leaves rubble", () => {
    const state = hall();
    const roof = set(state, "collapsing-roof", cells(1, 1, 3, 3));
    moveTo(state, ORC, 3, 3);
    springTrapOn(state, roof.id, HERO, deps([5, 5]));
    expect(savesOf(state, HERO)[0]).toMatchObject({ ability: "dex", dc: 13, halfOnSuccess: true, proposedDamage: 10 });
    expect(savesOf(state, ORC)).toHaveLength(1);
    expect(savesOf(state, GIANT)).toHaveLength(0);
    expect(state.combat.terrain.difficult).toEqual([cells(1, 1, 3, 3)]);
    expect(state.combat.traps[0]).toMatchObject({ state: "sprung", found: true });
  });

  it("strikes a creature with its own count of darts, and resets each turn up to three times", () => {
    const state = hall(true);
    const darts = set(state, "poisoned-darts", cells(2, 2));
    // Two darts (1d3 rolled 2), each 1d6 rolled 4.
    springTrapOn(state, darts.id, HERO, deps([4, 4, 4]));
    const record = trapRecord("poisoned-darts")!;
    expect(trapArmed(state, state.combat.traps[0]!, record)).toBe(false);
    state.combat.round = 2;
    expect(trapArmed(state, state.combat.traps[0]!, record)).toBe(true);
    state.combat.traps = state.combat.traps.map((trap) => ({ ...trap, activations: 3 }));
    expect(trapArmed(state, state.combat.traps[0]!, record)).toBe(false);
  });

  it("asks the darts' save with the poison of each dart that would hit", () => {
    const state = hall();
    const darts = set(state, "poisoned-darts", cells(1, 2));
    springTrapOn(state, darts.id, HERO, deps([4, 4, 4]));
    expect(savesOf(state, HERO)[0]).toMatchObject({
      ability: "dex",
      dc: 13,
      halfOnSuccess: false,
      proposedDamage: 8,
      proposedDamageParts: [{ amount: 8, type: "poison" }]
    });
  });

  it("drops a Net on the creature that set it off, and misses one Huge or larger", () => {
    const state = hall();
    const net = set(state, "falling-net", cells(1, 2));
    springTrapOn(state, net.id, HERO, deps());
    expect(savesOf(state, HERO)[0]).toMatchObject({ ability: "dex", dc: 10, conditionIds: ["restrained"] });
    expect(savesOf(state, HERO)[0]!.onFailEffect).toMatchObject({ escapeDc: 10, sourceActorId: null });

    const big = hall();
    const second = set(big, "falling-net", cells(12, 12));
    const events = springTrapOn(big, second.id, GIANT, deps()).events;
    expect(savesOf(big, GIANT)).toHaveLength(0);
    expect(events.map((event) => event.text)).toContain(
      "Giant is too large for the Falling Net and succeeds on its save."
    );
  });

  it("burns a creature that starts its turn on a fire-casting statue's plate", () => {
    const state = hall(true);
    set(state, "fire-casting-statue", cells(1, 2));
    trapsAtTurnStart(state, HERO, calibration, deps([5, 5]));
    expect(savesOf(state, HERO)[0]).toMatchObject({ ability: "dex", dc: 15, proposedDamage: 10 });
  });

  it("is set off by the first step onto its area, and a found trip wire is stepped over", () => {
    const state = hall();
    const net = set(state, "falling-net", cells(3, 2));
    const path = [cell(1, 2), cell(2, 2), cell(3, 2), cell(4, 2)];
    expect(trapEntry(state, HERO, path, calibration)).toEqual({ index: 2, trapId: net.id });
    state.combat.traps = state.combat.traps.map((trap) => ({ ...trap, found: true }));
    expect(trapEntry(state, HERO, path, calibration)).toBeNull();
    // A pit's lid opens under a creature that knows of it all the same.
    const pit = hall();
    const lid = set(pit, "hidden-pit", cells(3, 2));
    pit.combat.traps = pit.combat.traps.map((trap) => ({ ...trap, found: true }));
    expect(trapEntry(pit, HERO, path, calibration)).toEqual({ index: 2, trapId: lid.id });
  });

  it("goes off on a creature in its blast when the GM springs a needle on its victim", () => {
    const state = hall();
    const needle = set(state, "poisoned-needle", cells(1, 3));
    expect(trapEntry(state, HERO, [cell(1, 2), cell(1, 3)], calibration)).toBeNull();
    springTrapOn(state, needle.id, HERO, deps([6]));
    expect(savesOf(state, HERO)[0]).toMatchObject({ ability: "con", dc: 11, conditionIds: ["poisoned"] });
  });
});

describe("finding a trap", () => {
  it("finds a trip wire with a Search (Perception) that meets its DC within 10 feet", () => {
    const state = hall();
    set(state, "collapsing-roof", cells(3, 2));
    const search = { action: "search" as const, skill: "perception", pixelsPerFoot: 10 };
    expect(findTraps(state, HERO, { ...search, total: 10 })).toEqual([]);
    expect(findTraps(state, HERO, { ...search, skill: "investigation", total: 20 })).toEqual([]);
    expect(findTraps(state, HERO, { ...search, total: 11 }).map((event) => event.text)).toEqual([
      "Vex finds the trip wire and the unstable section of ceiling: a Collapsing Roof."
    ]);
    expect(state.combat.traps[0]!.found).toBe(true);
  });

  it("leaves a trap past 10 feet hidden, and a pit's lid wants a Study (Investigation)", () => {
    const state = hall();
    set(state, "collapsing-roof", cells(6, 2));
    set(state, "hidden-pit", cells(2, 2));
    expect(findTraps(state, HERO, { action: "search", skill: "perception", total: 25, pixelsPerFoot: 10 })).toEqual([]);
    expect(
      findTraps(state, HERO, { action: "study", skill: "investigation", total: 15, pixelsPerFoot: 10 }).map(
        (event) => event.text
      )
    ).toEqual(["Vex finds the pit's lid: a Hidden Pit."]);
  });
});

describe("making a trap safe", () => {
  const thief = { kind: "player-character" as const, definitionId: "thief" };
  const THIEF_SHEET = {
    name: "Vex",
    armorClass: 14,
    proficiencyBonus: 2,
    abilityScores: { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 10 },
    hitPoints: { maximum: 20 },
    actions: [],
    extensions: {},
    character: {
      classes: [{ id: "rogue", name: "Rogue", level: 3 }],
      features: [{ id: "fast-hands", name: "Fast Hands" }],
      feats: []
    },
    proficiencies: { saves: [], skills: [] }
  } as unknown as ActorDefinition;
  const withTools = (state: GameState, rows: Array<{ id: string; quantity: number }>) => {
    state.actors = state.actors.map((actor) =>
      actor.id === HERO
        ? {
            ...actor,
            ...thief,
            inventory: rows.map((row) => ({
              id: row.id,
              name: catalog.equipmentRecord(row.id)!.name,
              quantity: row.quantity,
              equipped: false,
              attuned: false
            }))
          }
        : actor
    );
  };
  const disarm = (state: GameState, trapId: string, disarmId: string, faces: number[], extra = {}) =>
    disarmTrap(
      state,
      GM,
      { commandId: nextId(), actorId: HERO, trapId, disarmId, ...extra },
      { ...deps(faces), resolveDefinition: (id: string) => (id === "thief" ? THIEF_SHEET : undefined) }
    );

  it("disarms a needle with a Sleight of Hand check through Thieves' Tools, and springs it on a failure", () => {
    const state = hall(true);
    withTools(state, [{ id: "thieves-tools", quantity: 1 }]);
    const needle = set(state, "poisoned-needle", cells(2, 2));
    const made = disarm(state, needle.id, "disarm", [15]);
    expect(made.check?.outcome).toMatchObject({ total: 18 });
    expect(state.combat.traps[0]).toMatchObject({ state: "disarmed", found: true });
    expect(state.combat.turn.actionUsed).toBe(true);

    const second = hall(true);
    withTools(second, [{ id: "thieves-tools", quantity: 1 }]);
    const another = set(second, "poisoned-needle", cells(2, 2));
    disarm(second, another.id, "disarm", [3, 6]);
    expect(second.combat.traps[0]!.state).toBe("sprung");
    expect(savesOf(second, HERO)[0]).toMatchObject({ ability: "con", dc: 11 });
  });

  it("takes a Thief's Bonus Action with Fast Hands", () => {
    const state = hall(true);
    withTools(state, [{ id: "thieves-tools", quantity: 1 }]);
    const needle = set(state, "poisoned-needle", cells(2, 2));
    disarm(state, needle.id, "disarm", [15], { bonusAction: true });
    expect(state.combat.turn.bonusActionUsed).toBe(true);
    expect(state.combat.turn.actionUsed).toBe(false);
  });

  it("wedges a carried Iron Spike under a pit's lid, and refuses a creature with none or too far away", () => {
    const state = hall();
    withTools(state, []);
    const pit = set(state, "hidden-pit", cells(2, 2));
    expect(() => disarm(state, pit.id, "wedge-spike", [])).toThrow("Vex needs Spikes, Iron (10) to do that.");
    withTools(state, [{ id: "iron-spikes", quantity: 10 }]);
    moveTo(state, HERO, 6, 2);
    expect(() => disarm(state, pit.id, "wedge-spike", [])).toThrow("Vex must be within 5 feet of the Hidden Pit.");
    moveTo(state, HERO, 1, 2);
    expect(disarm(state, pit.id, "wedge-spike", []).events.map((event) => event.text)).toEqual([
      "Vex makes the Hidden Pit safe: Wedge an Iron Spike between the lid and the floor."
    ]);
    expect(state.combat.traps[0]!.state).toBe("disarmed");
  });

  it("refuses a player a trap the party hasn't found", () => {
    const state = hall();
    const pit = set(state, "hidden-pit", cells(2, 2));
    state.actors = state.actors.map((actor) =>
      actor.id === HERO ? { ...actor, ownerSessionId: "30000000-0000-4000-8000-0000000000c9" } : actor
    );
    expect(() =>
      disarmTrap(
        state,
        { role: "player", sessionId: "30000000-0000-4000-8000-0000000000c9" },
        { commandId: nextId(), actorId: HERO, trapId: pit.id, disarmId: "wedge-spike" },
        deps()
      )
    ).toThrow("That trap is no longer on the map.");
  });
});

describe("a hidden pit on the table", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("stays out of every player's view until a creature falls in, then shows its name and area alone", async () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        creature(HERO, "Vex", { kind: "player-character", hp: { current: 60, maximum: 60 } }),
        creature(ORC, "Orc")
      ]
    });
    const { server, gmToken, post, move, startFight } = await bootMovementServer(state, cleanups);
    const player = server.auth.issuePlayerSession();
    const sessionId = server.auth.verifyPlayer(player)!.sessionId;
    expect((await post(GAME_PATHS.claims, player, { actorId: HERO })).status).toBe(200);
    await startFight([HERO, ORC], { [HERO]: cell(1, 2), [ORC]: cell(4, 4) });

    const refused = await post(GAME_PATHS.trapPlace, player, { trapId: "hidden-pit", tier: 1, rect: cells(3, 2) });
    expect(refused.status).toBe(403);
    const placed = await post(GAME_PATHS.trapPlace, gmToken, {
      trapId: "spiked-pit",
      tier: 1,
      rect: cells(3, 2, 4, 2)
    });
    expect(placed.status, await placed.clone().text()).toBe(200);
    const trap = server.store.snapshot.combat.traps[0]!;
    const playerView = () => projectPlayerView(server.store.snapshot, sessionId, () => null);
    expect(playerView().combat.traps).toEqual([]);
    expect(JSON.stringify(playerView())).not.toContain("spiked-pit");
    expect(projectViewerEncounter(server.store.snapshot).encounter?.traps).toBeUndefined();

    // The way to (5,2) crosses the lid over (3,2) and (4,2): the hero falls in there and the move ends.
    const fell = await move(HERO, player, { position: cell(5, 2) });
    expect(fell.status, await fell.clone().text()).toBe(200);
    const snapshot = server.store.snapshot;
    expect(snapshot.combat.tokens.find((token) => token.actorId === HERO)!.position).toEqual(cell(3, 2));
    const hero = snapshot.actors.find((actor) => actor.id === HERO)!;
    expect(hero.effects.map((effect) => effect.name)).toContain("In a 10-foot pit");
    // 1d6 from the fall and 2d8 from the spikes.
    expect(hero.hp.current).toBeLessThanOrEqual(60 - 3);
    expect(playerView().combat.traps).toEqual([
      { id: trap.id, name: "Spiked Pit", area: cells(3, 2, 4, 2), state: "sprung", ways: [] }
    ]);
    expect(projectViewerEncounter(server.store.snapshot).encounter?.traps).toEqual([
      { id: trap.id, name: "Spiked Pit", area: cells(3, 2, 4, 2), state: "sprung" }
    ]);

    // Its smooth walls hold a creature with no Climb Speed or climbing gear.
    const climb = await move(HERO, player, { position: cell(2, 2) });
    expect(climb.status).not.toBe(200);
    expect(await climb.text()).toContain("bottom of the pit");

    // The lid stays open: the next creature onto it falls in too.
    expect((await post(GAME_PATHS.turnEnd, gmToken, {})).status).toBeLessThan(300);
    const second = await move(ORC, gmToken, { position: cell(4, 2) });
    expect(second.status, await second.clone().text()).toBe(200);
    expect(
      server.store.snapshot.actors.find((actor) => actor.id === ORC)!.effects.map((effect) => effect.name)
    ).toContain("In a 10-foot pit");
  });

  it("shows a trap the GM marks found, without its band or DCs", async () => {
    const state = GameStateSchema.parse({ schemaVersion: 1, actors: [creature(HERO, "Vex")] });
    const { server, gmToken, post, startFight } = await bootMovementServer(state, cleanups);
    await startFight([HERO], { [HERO]: cell(1, 2) });
    await post(GAME_PATHS.trapPlace, gmToken, { trapId: "poisoned-darts", tier: 3, rect: cells(5, 5) });
    const trap = server.store.snapshot.combat.traps[0]!;
    const edit = await post(GAME_PATHS.trapEdit.replace("{trapId}", trap.id), gmToken, {
      trapId: trap.id,
      found: true
    });
    expect(edit.status, await edit.clone().text()).toBe(200);
    const shown = projectPlayerView(server.store.snapshot, randomUUID(), () => null).combat.traps;
    expect(shown).toEqual([
      {
        id: trap.id,
        name: "Poisoned Darts",
        area: cells(5, 5),
        state: "armed",
        ways: [
          { id: "plug", name: "Plug the holes" },
          { id: "wedge-spike", name: "Wedge an Iron Spike under the pressure plate" }
        ]
      }
    ]);
  });
});
