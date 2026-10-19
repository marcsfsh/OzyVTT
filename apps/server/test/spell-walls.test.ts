import { describe, expect, it } from "vitest";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import type { GameState, VisionWall } from "@vtt/domain";
import { CONCENTRATING_TAG } from "../src/effects.js";
import { RulesBlockedError } from "../src/game-store.js";
import { passGameTime } from "../src/game-time.js";
import { heldShutAgainst } from "../src/doors.js";
import { findObject, damageObject } from "../src/objects.js";
import { pruneEndedWalls } from "../src/spell-walls.js";
import { pruneEndedSight } from "../src/vision/cast-sight.js";
import { mapCover } from "../src/cover.js";
import { sceneSight } from "../src/vision/sight.js";
import { movementCost } from "../src/terrain.js";
import { fight, FOE, HERO } from "./spell-casters.js";
import { carry, cell, GRID, place, wizardAt } from "./zone-fixtures.js";

// SRD 5.2.1 spells that change the map's walls and doors: Wall of Force, Wall of Stone, Wall of Ice, Forcecage and the
// opaque walls (raised on the cast's placed area, gone when the spell ends), Knock, Arcane Lock, Mage Hand, Stone Shape,
// Passwall and Disintegrate (aimed at a door or a wall).

let ids = 0;
const cmd = () => `63000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

/** Turns the fight's map into a 3000-pixel square of 5-foot, 50-pixel cells with dynamic vision on. */
function withVision(state: GameState, walls: VisionWall[] = []): void {
  state.combat.vision = {
    ...state.combat.vision,
    enabled: true,
    walls,
    measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
  };
}

const door = (id: string, a: { x: number; y: number }, b: { x: number; y: number }): VisionWall => ({
  id,
  kind: "door",
  a,
  b,
  open: false
});
const DOOR = "52000000-0000-4000-8000-000000000001";
const WALL = "52000000-0000-4000-8000-000000000002";

/** A Line template from cell (c1, r) to cell (c2, r), as the map draws it. */
const line = (c1: number, c2: number, row: number) => ({
  shape: "line" as const,
  origin: cell(c1, row),
  target: cell(c2, row)
});

const concentrating = (state: GameState) =>
  state.actors.find((actor) => actor.id === HERO)!.effects.find((effect) => effect.tags.includes(CONCENTRATING_TAG));

function endConcentration(state: GameState) {
  const hero = state.actors.find((actor) => actor.id === HERO)!;
  hero.effects = hero.effects.filter((effect) => !effect.tags.includes(CONCENTRATING_TAG));
  pruneEndedWalls(state);
}

describe("Wall of Force", () => {
  function raised() {
    const caster = fight(wizardAt(9, ["wall-of-force"]));
    place(caster.state, { [HERO]: cell(5, 2), [FOE]: cell(5, 8) });
    withVision(caster.state);
    // A row of ten panels across row 5, from column 0 to column 20.
    caster.resolve("spell-wall-of-force", { targetIds: [], areaPlaced: true, placedArea: line(0, 20, 5) });
    return caster;
  }

  it("stands on the Line's far side from its caster, as one Invisible wall", () => {
    const { state } = raised();
    const walls = state.combat.vision.walls;
    expect(walls).toHaveLength(1);
    // The Line's long sides run along y = 250 and y = 300; the far one from the caster at row 2 is y = 300.
    expect(walls[0]).toMatchObject({
      kind: "window",
      a: { y: 300 },
      b: { y: 300 },
      source: { spellId: "wall-of-force" }
    });
  });

  it("stops a creature's move through it, leaves sight through it, and is Total Cover", () => {
    const { state } = raised();
    // Nothing passes the wall, and its end lies far beyond any walk worth the cost.
    expect(movementCost(state, GRID, FOE, cell(5, 8), cell(5, 1))?.blocked).toBe(true);
    expect(sceneSight(state, { definition: () => undefined }).sees(FOE, HERO)).toBe(true);
    expect(mapCover(state, FOE, HERO)).toBe("total");
  });

  it("is gone when the caster's Concentration ends", () => {
    const { state } = raised();
    expect(concentrating(state)).toBeDefined();
    endConcentration(state);
    expect(state.combat.vision.walls).toEqual([]);
  });

  it("is destroyed whole by Disintegrate, ending the spell", () => {
    const wizard = wizardAt(11, ["wall-of-force", "disintegrate"]);
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(5, 2), [FOE]: cell(5, 8) });
    withVision(caster.state);
    caster.resolve("spell-wall-of-force", { targetIds: [], areaPlaced: true, placedArea: line(0, 20, 5) });
    const wall = caster.state.combat.vision.walls[0]!;
    caster.state.combat.turn = { ...caster.state.combat.turn, actionUsed: false, spellSlotCasters: [] };
    caster.resolve("spell-disintegrate", { targetIds: [], wallId: wall.id }, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(caster.state.combat.vision.walls).toEqual([]);
    expect(concentrating(caster.state)).toBeUndefined();
  });
});

describe("Wall of Stone and Wall of Ice", () => {
  it("raises ten stone panels of AC 15 and 180 Hit Points that block sight", () => {
    const caster = fight(wizardAt(9, ["wall-of-stone"]));
    place(caster.state, { [HERO]: cell(5, 2), [FOE]: cell(5, 8) });
    withVision(caster.state);
    caster.resolve("spell-wall-of-stone", { targetIds: [], areaPlaced: true, placedArea: line(0, 20, 5) });
    const walls = caster.state.combat.vision.walls;
    expect(walls).toHaveLength(10);
    expect(walls[0]).toMatchObject({ kind: "wall", object: { armorClass: 15, hitPoints: { current: 180 } } });
    expect(sceneSight(caster.state, { definition: () => undefined }).sees(FOE, HERO)).toBe(false);
  });

  it("stays for good once Concentration has held for the full 10 minutes, and goes if it breaks sooner", () => {
    const held = fight(wizardAt(9, ["wall-of-stone"]));
    place(held.state, { [HERO]: cell(5, 2) });
    withVision(held.state);
    held.resolve("spell-wall-of-stone", { targetIds: [], areaPlaced: true, placedArea: line(0, 20, 5) });
    held.state.combat.round += 100;
    endConcentration(held.state);
    expect(held.state.combat.vision.walls).toHaveLength(10);
    expect(held.state.combat.vision.walls[0]!.source).toBeUndefined();

    const broken = fight(wizardAt(9, ["wall-of-stone"]));
    place(broken.state, { [HERO]: cell(5, 2) });
    withVision(broken.state);
    broken.resolve("spell-wall-of-stone", { targetIds: [], areaPlaced: true, placedArea: line(0, 20, 5) });
    broken.state.combat.round += 50;
    endConcentration(broken.state);
    expect(broken.state.combat.vision.walls).toEqual([]);
  });

  it("raises ice sections that take double Fire damage and open a gap when broken", () => {
    const caster = fight(wizardAt(11, ["wall-of-ice"]));
    place(caster.state, { [HERO]: cell(5, 2), [FOE]: cell(1, 8) });
    withVision(caster.state);
    caster.resolve("spell-wall-of-ice", { targetIds: [], areaPlaced: true, placedArea: line(0, 20, 5) }, [1]);
    const sections = caster.state.combat.vision.walls;
    expect(sections).toHaveLength(10);
    expect(sections[0]!.object).toMatchObject({ armorClass: 12, immunities: ["cold"], vulnerabilities: ["fire"] });
    // 15 Fire doubled is the section's 30 Hit Points.
    const hit = damageObject(caster.state, { wallId: sections[0]!.id }, [{ amount: 15, type: "fire" }]);
    expect(hit.destroyed).toBe(true);
    expect(movementCost(caster.state, GRID, FOE, cell(1, 8), cell(1, 2))?.feet).toBe(30);
  });

  it("pushes a creature whose space the wall cuts to one side", () => {
    const caster = fight(wizardAt(9, ["wall-of-force"]));
    place(caster.state, { [HERO]: cell(5, 2), [FOE]: cell(9, 2) });
    withVision(caster.state);
    // A Large foe straddling the line y = 300 (its centre on the corner at (500, 300)).
    caster.state.combat.tokens = caster.state.combat.tokens.map((token) =>
      token.actorId === FOE ? { ...token, position: { x: 500, y: 300 }, sizeCells: 2 } : token
    );
    caster.resolve("spell-wall-of-force", { targetIds: [], areaPlaced: true, placedArea: line(0, 20, 5) });
    const foe = caster.state.combat.tokens.find((token) => token.actorId === FOE)!;
    // The caster's enemy goes to the far side, one square down.
    expect(foe.position).toEqual({ x: 500, y: 350 });
  });
});

describe("Forcecage's cage", () => {
  it("bars movement and leaves attacks and sight through its bars", () => {
    const caster = fight(wizardAt(13, ["forcecage"]));
    place(caster.state, { [HERO]: cell(1, 1), [FOE]: cell(6, 6) });
    carry(caster.state, HERO, "Ruby dust");
    withVision(caster.state);
    // A 20-foot Cube from (4,4) to (8,8) in cells.
    caster.resolve("spell-forcecage", {
      targetIds: [],
      areaPlaced: true,
      placedArea: { shape: "square", origin: { x: 200, y: 200 }, target: { x: 400, y: 400 } }
    });
    expect(caster.state.combat.vision.walls).toHaveLength(4);
    expect(movementCost(caster.state, GRID, FOE, cell(6, 6), cell(10, 6))?.blocked).toBe(true);
    expect(mapCover(caster.state, HERO, FOE)).toBeNull();
    expect(sceneSight(caster.state, { definition: () => undefined }).sees(HERO, FOE)).toBe(true);
  });
});

describe("opaque walls", () => {
  it("Wall of Fire blocks sight across it", () => {
    const caster = fight(wizardAt(7, ["wall-of-fire"]));
    place(caster.state, { [HERO]: cell(5, 2), [FOE]: cell(5, 8) });
    withVision(caster.state);
    const commandId = cmd();
    caster.resolve("spell-wall-of-fire", { targetIds: [], commandId, areaPlaced: true }, [1, 1, 1, 1, 1]);
    caster.state.combat.annotations = [
      {
        id: commandId,
        kind: "shape",
        shape: "line",
        geometry: { origin: cell(0, 5), target: cell(12, 5), sizeFeet: 60 },
        visibility: "public",
        ownerSessionId: "30000000-0000-4000-8000-00000000000a",
        createdAt: 0
      } as never
    ];
    expect(sceneSight(caster.state, { definition: () => undefined }).sees(FOE, HERO)).toBe(false);
  });
});

describe("spells aimed at a door", () => {
  /** A door across x = 500 at row 5, with walls above and below; the caster stands at (8,5), 15 feet from it. */
  function doorway(spells: string[], level = 5) {
    const caster = fight(wizardAt(level, spells));
    place(caster.state, { [HERO]: cell(7, 5), [FOE]: cell(12, 5) });
    withVision(caster.state, [
      { id: WALL, kind: "wall", a: { x: 500, y: 0 }, b: { x: 500, y: 250 } },
      door(DOOR, { x: 500, y: 250 }, { x: 500, y: 300 }),
      { id: "52000000-0000-4000-8000-000000000003", kind: "wall", a: { x: 500, y: 300 }, b: { x: 500, y: 3000 } }
    ]);
    const doorOf = () => caster.state.combat.vision.walls.find((wall) => wall.id === DOOR)!;
    return { ...caster, doorOf };
  }

  it("Knock unlocks a locked door it can see within 60 feet", () => {
    const caster = doorway(["knock"]);
    caster.state.combat.vision.walls = caster.state.combat.vision.walls.map((wall) =>
      wall.id === DOOR ? { ...wall, door: { fastenings: [{ kind: "lock" as const }] } } : wall
    );
    caster.resolve("spell-knock", { targetIds: [], wallId: DOOR });
    expect(heldShutAgainst(caster.state, caster.doorOf(), FOE)).toBeNull();
  });

  it("Knock refuses a door beyond 60 feet", () => {
    const caster = doorway(["knock"]);
    caster.state.combat.tokens = caster.state.combat.tokens.map((token) =>
      token.actorId === HERO ? { ...token, position: cell(30, 5) } : token
    );
    caster.state.combat.vision.walls = caster.state.combat.vision.walls.filter((wall) => wall.id === DOOR);
    expect(() => caster.resolve("spell-knock", { targetIds: [], wallId: DOOR })).toThrowError(RulesBlockedError);
  });

  it("Arcane Lock locks the touched door against all but its caster and those it names", () => {
    const caster = doorway(["arcane-lock"]);
    carry(caster.state, HERO, "Gold dust");
    caster.state.combat.tokens = caster.state.combat.tokens.map((token) =>
      token.actorId === HERO ? { ...token, position: cell(9, 5) } : token
    );
    caster.resolve("spell-arcane-lock", { targetIds: [], wallId: DOOR });
    expect(heldShutAgainst(caster.state, caster.doorOf(), FOE)).toBe("The door is locked.");
    expect(heldShutAgainst(caster.state, caster.doorOf(), HERO)).toBeNull();
  });

  it("Mage Hand opens an unlocked door within 30 feet and not a locked one", () => {
    const caster = doorway([]);
    caster.resolve("spell-mage-hand", { targetIds: [], wallId: DOOR });
    expect(caster.doorOf().open).toBe(true);
    const locked = doorway([]);
    locked.state.combat.vision.walls = locked.state.combat.vision.walls.map((wall) =>
      wall.id === DOOR ? { ...wall, door: { fastenings: [{ kind: "lock" as const }] } } : wall
    );
    expect(() => locked.resolve("spell-mage-hand", { targetIds: [], wallId: DOOR })).toThrowError(
      "The door is locked."
    );
  });

  it("Stone Shape seals a door shut", () => {
    const caster = doorway(["stone-shape"], 7);
    caster.state.combat.tokens = caster.state.combat.tokens.map((token) =>
      token.actorId === HERO ? { ...token, position: cell(9, 5) } : token
    );
    caster.resolve("spell-stone-shape", { targetIds: [], wallId: DOOR });
    expect(heldShutAgainst(caster.state, caster.doorOf(), HERO)).toBe("The door is sealed shut.");
  });

  it("Passwall cuts a passage through a wall that closes when its hour ends", () => {
    const caster = doorway(["passwall"], 9);
    caster.state.combat.active = false;
    caster.state.combat.tokens = caster.state.combat.tokens.map((token) =>
      token.actorId === HERO ? { ...token, position: cell(9, 2) } : token
    );
    caster.resolve("spell-passwall", { targetIds: [], wallId: WALL });
    const cut = caster.state.combat.vision.walls.find((wall) => wall.id === WALL)!;
    expect(cut.openings).toHaveLength(1);
    expect(movementCost(caster.state, GRID, HERO, cell(9, 2), cell(10, 2))?.feet).toBe(5);
    passGameTime(caster.state, 61);
    pruneEndedWalls(caster.state);
    pruneEndedSight(caster.state);
    expect(caster.state.combat.vision.walls.find((wall) => wall.id === WALL)!.openings).toBeUndefined();
  });
});

describe("the spell walls table", () => {
  it("names only real spells", () => {
    const ids = new Set(loadSpells().map((spell) => spell.id));
    const walled = loadSpells().filter((spell) => spell.walls !== undefined);
    expect(walled.map((spell) => spell.id).every((id) => ids.has(id))).toBe(true);
    expect(walled.map((spell) => spell.id).sort()).toEqual([
      "arcane-lock",
      "disintegrate",
      "elementalism",
      "forcecage",
      "knock",
      "mage-hand",
      "passwall",
      "stone-shape",
      "thaumaturgy",
      "wall-of-force",
      "wall-of-ice",
      "wall-of-stone"
    ]);
  });

  it("keeps a door's object when nothing broke it", () => {
    const caster = doorway2();
    expect(findObject(caster.state, { wallId: DOOR })?.stats.armorClass).toBe(15);
  });
});

function doorway2() {
  const caster = fight(wizardAt(5, []));
  withVision(caster.state, [door(DOOR, { x: 500, y: 250 }, { x: 500, y: 300 })]);
  return caster;
}
