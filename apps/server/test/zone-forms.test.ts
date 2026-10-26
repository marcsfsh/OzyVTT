import { randomUUID } from "node:crypto";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { importActorDefinition } from "../src/actor-roster.js";
import { castOptionsOf, zonesAfterMove, zonesAtTurnEnd } from "../src/spell-zones.js";
import { movementCost } from "../src/terrain.js";
import { resolveAreas } from "../src/vision/areas.js";
import { zoneCover } from "../src/zone-walls.js";
import { zoneMovementOptions } from "../src/zone-ground.js";
import { bootServer } from "./boot-server.js";
import { png } from "./image-fixtures.js";
import { catalog, fight, FOE, FOE2, HERO, view } from "./spell-casters.js";
import { cell, clericAt, drawArea, GRID, hpOf, place, savesOf, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 walls the caster shapes as it casts: Wall of Fire ("a straight wall up to 60 feet long ... or a ringed
// wall up to 20 feet in diameter"; "One side of the wall, selected by you when you cast this spell, deals 5d8 Fire
// damage to each creature that ends its turn within 10 feet of that side or inside the wall") and Blade Barrier (a
// straight wall or "a ringed wall up to 60 feet in diameter").

const CAST = "67000000-0000-4000-8000-000000000001";
const wizard = wizardAt(7, ["wall-of-fire", "magic-missile"]);

/** The wizard casts Wall of Fire with a form, and the wall is drawn where the cast placed it. */
function wallOfFire(option: string, draw: (state: GameState) => void) {
  const caster = fight(wizard);
  place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
  caster.resolve("spell-wall-of-fire", { targetIds: [], commandId: CAST, areaPlaced: true, option }, [3, 3, 3, 3, 3]);
  draw(caster.state);
  return caster;
}
const moveTo = (state: GameState, actorId: string, at: readonly [number, number]) => {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: cell(...at) } : token
  );
};

describe("the forms a wall's cast offers", () => {
  it("lists Wall of Fire's straight and ringed forms with their burning side, the ring placed as a circle", () => {
    const options = castOptionsOf(
      wizard.actions.find((action) => action.id === "spell-wall-of-fire")!,
      view.spellRecord("wall-of-fire")
    ).options!;
    expect(options.map((option) => option.id)).toEqual(["left", "right", "ring-inside", "ring-outside"]);
    expect(options[2]!.area).toMatchObject({ shape: "cylinder", sizeFeet: 10 });
    expect(options[0]!.area).toBeUndefined();
  });

  it("refuses a form the spell doesn't offer", () => {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
    expect(() =>
      caster.resolve("spell-wall-of-fire", { targetIds: [], commandId: CAST, areaPlaced: true, option: "dome" })
    ).toThrow(/Choose one of them/);
  });
});

describe("Wall of Fire's burning side", () => {
  // A wall drawn down column 10 from row 5: its left as drawn (facing down the map) is the east.
  const straight = (state: GameState) => drawArea(state, CAST, [10, 5], 10, "line");

  it("burns a creature ending its turn within 10 feet of the side the caster picked", () => {
    const { state } = wallOfFire("left", straight);
    moveTo(state, FOE, [12, 8]);
    zonesAtTurnEnd(state, FOE, zoneDeps([4, 4, 4, 4, 4]));
    expect(hpOf(state, FOE)).toBe(200 - 20);
  });

  it("leaves a creature on the other side and one beyond 10 feet unburned", () => {
    const { state } = wallOfFire("left", straight);
    moveTo(state, FOE, [8, 8]);
    moveTo(state, FOE2, [13, 8]);
    zonesAtTurnEnd(state, FOE, zoneDeps([4, 4, 4, 4, 4]));
    zonesAtTurnEnd(state, FOE2, zoneDeps([4, 4, 4, 4, 4]));
    expect(hpOf(state, FOE)).toBe(200);
    expect(hpOf(state, FOE2)).toBe(200);
  });

  it("burns the other side when the caster picks it", () => {
    const { state } = wallOfFire("right", straight);
    moveTo(state, FOE, [8, 8]);
    zonesAtTurnEnd(state, FOE, zoneDeps([4, 4, 4, 4, 4]));
    expect(hpOf(state, FOE)).toBe(200 - 20);
  });
});

describe("Wall of Fire's ring", () => {
  // A ring 20 feet across round cell (10,10): its edge is the cells 5 to 10 feet from the centre.
  const ring = (state: GameState) => drawArea(state, CAST, [10, 10], 2);

  it("stands on the circle's edge: crossing it burns, standing in its middle doesn't", () => {
    const { state } = wallOfFire("ring-outside", ring);
    moveTo(state, FOE, [6, 10]);
    const events = zonesAfterMove(
      state,
      {
        moverId: FOE,
        path: [
          [6, 10],
          [7, 10],
          [8, 10]
        ].map(([column, row]) => cell(column!, row!))
      },
      zoneDeps([4, 4, 4, 4, 4])
    );
    expect(events[0]?.text).toMatch(/^Goblin enters Wall of Fire and takes 20 Fire damage/);
  });

  it("burns inside the ring when that side burns, and spares the outside", () => {
    const { state } = wallOfFire("ring-inside", ring);
    moveTo(state, FOE, [10, 10]);
    moveTo(state, FOE2, [13, 10]);
    zonesAtTurnEnd(state, FOE, zoneDeps([4, 4, 4, 4, 4]));
    zonesAtTurnEnd(state, FOE2, zoneDeps([4, 4, 4, 4, 4]));
    expect(hpOf(state, FOE)).toBe(200 - 20);
    expect(hpOf(state, FOE2)).toBe(200);
  });

  it("burns outside the ring when that side burns", () => {
    const { state } = wallOfFire("ring-outside", ring);
    moveTo(state, FOE, [10, 10]);
    moveTo(state, FOE2, [13, 10]);
    zonesAtTurnEnd(state, FOE, zoneDeps([4, 4, 4, 4, 4]));
    zonesAtTurnEnd(state, FOE2, zoneDeps([4, 4, 4, 4, 4]));
    expect(hpOf(state, FOE)).toBe(200);
    expect(hpOf(state, FOE2)).toBe(200 - 20);
  });

  it("blocks sight on its edge alone, so the middle of the ring is clear", () => {
    const { state } = wallOfFire("ring-inside", ring);
    const area = state.combat.vision.areas.find((candidate) => candidate.source?.spellId === "wall-of-fire")!;
    expect(area.shape).toMatchObject({ type: "template", ringFeet: 5 });
    const [resolved] = resolveAreas([area], state.combat, 10);
    expect(resolved!.contains(cell(10, 10))).toBe(false);
    expect(resolved!.contains(cell(12, 10))).toBe(true);
    // A sight line from outside to the middle crosses the wall; one inside the ring doesn't.
    expect(resolved!.touches(cell(15, 10), cell(10, 10))).toBe(true);
    expect(resolved!.touches(cell(10, 10), cell(10, 11))).toBe(false);
  });
});

describe("Blade Barrier's ringed wall", () => {
  const cleric = clericAt(11, ["blade-barrier"]);

  /** The cleric rings a 60-foot circle round cell (20,20): its edge is the cells more than 25 and up to 30 feet out
   *  (centre to centre). */
  function barrier() {
    const caster = fight(cleric);
    place(caster.state, { [HERO]: cell(20, 20), [FOE]: cell(30, 20), [FOE2]: cell(40, 40) });
    caster.resolve("spell-blade-barrier", { targetIds: [], commandId: CAST, areaPlaced: true, option: "ring" });
    drawArea(caster.state, CAST, [20, 20], 6);
    return caster;
  }

  it("makes the ring's edge Difficult Terrain and leaves its middle clear", () => {
    const { state } = barrier();
    const cost = (from: readonly [number, number], to: readonly [number, number]) =>
      movementCost(state, GRID, FOE, cell(...from), cell(...to), zoneMovementOptions(state, FOE, zoneDeps()))!.feet;
    expect(cost([27, 20], [26, 20])).toBe(10);
    expect(cost([22, 20], [21, 20])).toBe(5);
  });

  it("asks a creature crossing the ring for the save", () => {
    const { state } = barrier();
    zonesAfterMove(
      state,
      {
        moverId: FOE,
        path: [
          [30, 20],
          [28, 20],
          [26, 20],
          [24, 20]
        ].map(([column, row]) => cell(column!, row!))
      },
      zoneDeps()
    );
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "dex" })]);
  });

  it("gives Three-Quarters Cover to a creature inside from one outside", () => {
    const { state } = barrier();
    expect(zoneCover(state, FOE, HERO, zoneDeps())).toBe("three-quarters");
    moveTo(state, FOE, [22, 20]);
    expect(zoneCover(state, FOE, HERO, zoneDeps())).toBeNull();
  });
});

describe("a ringed wall's cast through the table's commands", () => {
  const cleric = clericAt(11, ["blade-barrier"]);
  const closers: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  it("is placed as a circle and catches the creatures on its edge, not those it rings", async () => {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        { id: FOE, name: "Goblin", kind: "monster", hp: { current: 200, maximum: 200 }, armorClass: 12 },
        { id: FOE2, name: "Orc", kind: "monster", hp: { current: 200, maximum: 200 }, armorClass: 12 }
      ]
    });
    importActorDefinition(state, cleric, HERO, "public", catalog);
    const booted = await bootServer(state);
    closers.push(booted.close);
    const { server, gmToken, post } = booted;
    const imported = await server.mapAssets.import(png(2500, 2500), "field.png");
    server.mapCatalog.register(imported.metadata.id, "Field", "battlemap");
    server.mapCatalog.saveCalibration(imported.metadata.id, {
      calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 },
      verifiedAt: null,
      verificationPoint: null,
      verificationErrorPx: null
    });
    const started = await post(GAME_PATHS.encounterStart, gmToken, {
      commandId: randomUUID(),
      mapAssetId: imported.metadata.id,
      entries: [
        { actorId: HERO, score: 20 },
        { actorId: FOE, score: 10 },
        { actorId: FOE2, score: 5 }
      ]
    });
    expect(started.status).toBe(200);
    for (const [actorId, column, row] of [
      [HERO, 1, 1],
      [FOE, 20, 20],
      [FOE2, 26, 20]
    ] as const)
      expect(
        (
          await post(GAME_PATHS.tokenMove.replace("{actorId}", actorId), gmToken, {
            commandId: randomUUID(),
            position: cell(column, row)
          })
        ).status
      ).toBe(200);
    const cast = await post(GAME_PATHS.actionResolve, gmToken, {
      commandId: randomUUID(),
      actorId: HERO,
      actionId: "spell-blade-barrier",
      option: "ring",
      template: { shape: "circle", origin: cell(20, 20), target: cell(26, 20) }
    });
    expect(cast.status, JSON.stringify(await cast.clone().json())).toBe(200);
    const saves = server.store.snapshot.combat.pendingSaves;
    expect(saves.map((save) => save.targetActorId)).toEqual([FOE2]);
    const zone = server.store.snapshot.combat.spellZones.find((candidate) => candidate.spellId === "blade-barrier")!;
    expect(zone.laterActionId).toBe("spell-blade-barrier-then-ring-save");
    expect(zone.area).toMatchObject({ shape: "cylinder", sizeFeet: 30 });
  });
});
