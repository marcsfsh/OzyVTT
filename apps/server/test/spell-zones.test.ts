import { describe, expect, it } from "vitest";
import type { GameState, SpellZone } from "@vtt/domain";
import { addAnnotation } from "../src/annotations.js";
import { endEffect } from "../src/effects.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { evaluateActionEconomy } from "../src/resolution/economy.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import {
  placeZone,
  speedHalvingAt,
  zonesAfterAreaMove,
  zonesAfterMove,
  zonesAtTurnEnd,
  type ZoneDeps
} from "../src/spell-zones.js";
import { movementCost } from "../src/terrain.js";
import type { TokenMapGeometry } from "../src/token-placement.js";
import {
  ALLY,
  build,
  catalog,
  clericInput,
  druidInput,
  fight,
  FOE,
  FOE2,
  HERO,
  heroTurnAgain,
  wizardInput,
  type Fight
} from "./spell-casters.js";

// SRD 5.2.1 spells whose areas act after the cast: a creature that enters the area, or starts or ends its turn there,
// makes the save or takes the damage then, once per turn where the text says so (Moonbeam, Spirit Guardians, Web,
// Stinking Cloud, Sleet Storm, Spike Growth, Wall of Fire, Guardian of Faith).

/** 50px cells, 5 ft each: cell (c,r) centre = (25 + 50c, 25 + 50r). */
const GRID: TokenMapGeometry = {
  width: 2000,
  height: 2000,
  calibration: { kind: "square", origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 }
};
const cell = (column: number, row: number) => ({ x: 25 + 50 * column, y: 25 + 50 * row });
const CAST = "60000000-0000-4000-8000-000000000001";
const DAGGER = {
  id: "dagger",
  name: "Dagger",
  activation: "action" as const,
  description: "Melee weapon attack.",
  attack: { bonus: 4, reachFeet: 5 },
  damage: [{ formula: "1d4 + 2", type: "piercing" }]
};
const GM = { role: "gm" } as const;

let ids = 0;
const nextId = () => `50000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;

const zoneDeps = (faces: number[] = []): ZoneDeps => ({
  geometry: GRID,
  resolveDefinition: () => undefined,
  catalog,
  rollDie: () => faces.shift() ?? 3,
  newId: nextId,
  now: () => "2026-10-17T00:00:00.000Z"
});
const saveDeps: SaveAnswerDependencies = {
  random: () => 10,
  newRollId: nextId,
  sessionId: "30000000-0000-4000-8000-00000000000a",
  role: "gm",
  now: () => "2026-10-17T00:00:00.000Z",
  resolveDefinition: () => undefined,
  catalog
};

/** Puts the combatants' tokens on the grid. */
function place(state: GameState, positions: Readonly<Record<string, { x: number; y: number }>>): void {
  state.combat.tokens = state.combat.tokens.map((token) => ({
    ...token,
    position: positions[token.actorId] ?? token.position,
    sizeCells: 1
  }));
}
/** A token move along a straight row of cells, as `token.move` reports the path. */
function walk(
  state: GameState,
  actorId: string,
  cells: ReadonlyArray<readonly [number, number]>,
  faces: number[] = []
) {
  const path = cells.map(([column, row]) => cell(column, row));
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: path[path.length - 1]! } : token
  );
  return zonesAfterMove(state, { moverId: actorId, path }, zoneDeps(faces));
}
/** Places the area a cast's template drew: a circle of `radius` cells around `center`, or a line `radius` cells long
 *  down from it. */
function drawArea(
  state: GameState,
  id: string,
  center: readonly [number, number],
  radius: number,
  shape: "circle" | "line" = "circle"
) {
  addAnnotation(
    state,
    {
      id,
      kind: "shape",
      shape,
      origin: cell(center[0], center[1]),
      target: shape === "line" ? cell(center[0], center[1] + radius) : cell(center[0] + radius, center[1]),
      visibility: "public",
      actor: { sessionId: "30000000-0000-4000-8000-00000000000a", role: "gm" },
      now: 0
    },
    GRID
  );
}
const savesOf = (state: GameState, actorId: string) =>
  state.combat.pendingSaves.filter((save) => save.targetActorId === actorId);
const zone = (state: GameState) => state.combat.spellZones[0]!;
const answer = (state: GameState, actorId: string, total: number) =>
  answerSave(state, nextId(), savesOf(state, actorId)[0]!.id, "manual", total, true, GM, saveDeps);
/** Ends the current turn with the zone deps, so areas the creature stands in act on it. */
const endTurn = (state: GameState, faces: number[] = []) =>
  nextInitiativeTurn(state, [], {
    resolveDefinition: () => undefined,
    catalog,
    rollDie: () => faces.shift() ?? 3,
    newId: nextId,
    now: () => "2026-10-17T00:00:00.000Z",
    geometry: GRID
  });

const druid = build(druidInput(["moonbeam", "spike-growth", "heat-metal", "entangle"]));
const cleric = build(clericInput(["spirit-guardians", "spiritual-weapon", "bless"]));
const wizard = build(wizardInput(["web", "stinking-cloud", "sleet-storm", "flaming-sphere", "magic-missile"]));

/** Casts `actionId` with its area drawn at `center` (`radius` cells), in a fight whose tokens stand at `positions`. */
function castArea(
  caster: Fight,
  actionId: string,
  center: readonly [number, number],
  radius: number,
  input: Partial<Parameters<Fight["resolve"]>[1]> = {}
) {
  const resolution = caster.resolve(actionId, { targetIds: [], commandId: CAST, areaPlaced: true, ...input });
  drawArea(caster.state, CAST, center, radius);
  return resolution;
}

describe("Moonbeam: entering the Cylinder or ending a turn there, once per turn", () => {
  function moonbeam(slotLevel?: number) {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 5), [FOE2]: cell(20, 20) });
    castArea(caster, "spell-moonbeam", [5, 5], 1, slotLevel ? { slotLevel } : {});
    return caster;
  }

  it("leaves a zone on the area the cast placed, held by the caster's Concentration", () => {
    const { state } = moonbeam();
    expect(state.combat.spellZones).toEqual([
      expect.objectContaining({
        id: CAST,
        spellId: "moonbeam",
        casterId: HERO,
        annotationId: CAST,
        level: 2,
        dc: 15,
        castId: CAST
      })
    ]);
  });

  it("asks a creature that walks in for the CON save, with 2d10 Radiant rolled then, and only once that turn", () => {
    const { state } = moonbeam();
    const events = walk(
      state,
      FOE,
      [
        [8, 5],
        [7, 5],
        [6, 5],
        [5, 5]
      ],
      [4, 6]
    );
    expect(events.map((event) => event.text)).toEqual(["Goblin enters Moonbeam and makes a CON save (DC 15)."]);
    expect(savesOf(state, FOE)).toEqual([
      expect.objectContaining({
        ability: "con",
        dc: 15,
        proposedDamage: 10,
        proposedDamageParts: [{ amount: 10, type: "radiant" }],
        halfOnSuccess: true,
        zoneId: CAST
      })
    ]);
    // Ending the same turn there is no second save: "A creature makes this save only once per turn."
    expect(zonesAtTurnEnd(state, FOE, zoneDeps())).toEqual([]);
  });

  it("asks again when the creature ends a later turn in it", () => {
    const { state } = moonbeam();
    walk(state, FOE, [
      [7, 5],
      [6, 5],
      [5, 5]
    ]);
    answer(state, FOE, 20);
    // The hero's turn ends, then the goblin's: the goblin ends its own turn in the beam.
    endTurn(state);
    expect(state.combat.turnActorId).toBe(FOE);
    endTurn(state, [5, 5]);
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ proposedDamage: 10 })]);
  });

  it("rolls at the level it was cast at: 3d10 from a level 3 spell slot", () => {
    const { state } = moonbeam(3);
    walk(
      state,
      FOE,
      [
        [7, 5],
        [6, 5]
      ],
      [1, 2, 3]
    );
    expect(savesOf(state, FOE)[0]).toMatchObject({ proposedDamage: 6 });
  });

  it("catches a creature the Cylinder is moved onto", () => {
    const { state } = moonbeam();
    const area = state.combat.annotations.find((annotation) => annotation.id === CAST)!;
    const before = area.geometry;
    // The druid's Magic action moves the beam onto the goblin.
    area.geometry = { ...before, origin: cell(10, 5), target: cell(11, 5) };
    const events = zonesAfterAreaMove(state, CAST, before, zoneDeps());
    expect(events.map((event) => event.text)).toEqual(["Goblin is caught by Moonbeam and makes a CON save (DC 15)."]);
  });

  it("ends, and leaves the map, when the caster's Concentration ends", () => {
    const { state, hero } = moonbeam();
    const concentration = hero.effects.find((effect) => effect.tags.includes("concentrating"))!;
    expect(concentration.spell).toEqual({ id: "moonbeam", level: 2 });
    endEffect(state, HERO, concentration.id);
    expect(state.combat.spellZones).toEqual([]);
    expect(state.combat.annotations.some((annotation) => annotation.id === CAST)).toBe(false);
    expect(
      walk(state, FOE, [
        [7, 5],
        [6, 5]
      ])
    ).toEqual([]);
  });
});

describe("Spirit Guardians: an Emanation that moves with its caster and spares its allies", () => {
  function guardians() {
    const caster = fight(cleric, { ally: true });
    place(caster.state, { [HERO]: cell(5, 5), [FOE]: cell(12, 5), [FOE2]: cell(20, 20), [ALLY]: cell(12, 6) });
    const cast = caster.resolve("spell-spirit-guardians", { targetIds: [], commandId: CAST });
    return { ...caster, cast };
  }

  it("needs no area placed: it is around the caster", () => {
    const { state, cast } = guardians();
    expect(zone(state)).toMatchObject({ annotationId: null, level: 3 });
    expect(cast.warnings ?? []).not.toContainEqual(expect.stringMatching(/Place|save/));
  });

  it("asks an enemy that comes within 15 feet for the WIS save, 3d8 Radiant", () => {
    const { state } = guardians();
    const events = walk(
      state,
      FOE,
      [
        [11, 5],
        [10, 5],
        [9, 5],
        [8, 5]
      ],
      [8, 8, 8]
    );
    expect(events.map((event) => event.text)).toEqual(["Goblin enters Spirit Guardians and makes a WIS save (DC 15)."]);
    expect(savesOf(state, FOE)[0]).toMatchObject({ ability: "wis", proposedDamage: 24, halfOnSuccess: true });
  });

  it("leaves the caster's allies alone", () => {
    const { state } = guardians();
    expect(
      walk(state, ALLY, [
        [11, 6],
        [8, 6]
      ])
    ).toEqual([]);
  });

  it("halves an enemy's Speed inside it, so each step there costs double, and leaves allies' Speed alone", () => {
    const { state } = guardians();
    const halvedAt = speedHalvingAt(state, FOE, zoneDeps());
    expect(halvedAt).not.toBeNull();
    // From 35 feet away to 15 feet away: three steps outside, the last one into the Emanation.
    expect(movementCost(state, GRID, FOE, cell(12, 5), cell(8, 5), { halvedAt: halvedAt! })).toMatchObject({
      feet: 25
    });
    expect(movementCost(state, GRID, FOE, cell(12, 5), cell(8, 5))).toMatchObject({ feet: 20 });
    expect(speedHalvingAt(state, ALLY, zoneDeps())).toBeNull();
  });

  it("catches an enemy when the caster walks up to it", () => {
    const { state } = guardians();
    const events = walk(state, HERO, [
      [5, 5],
      [6, 5],
      [7, 5],
      [8, 5],
      [9, 5]
    ]);
    expect(events.map((event) => event.text)).toEqual([
      "Goblin is caught by Spirit Guardians and makes a WIS save (DC 15)."
    ]);
  });
});

describe("Web, Stinking Cloud and Sleet Storm: a save at the start of the creature's turn", () => {
  it("Web: a failure Restrains it, and it breaks free with a Strength (Athletics) check against the spell DC", () => {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(20, 20) });
    castArea(caster, "spell-web", [10, 10], 2);
    endTurn(caster.state);
    expect(caster.state.combat.turnActorId).toBe(FOE);
    expect(savesOf(caster.state, FOE)).toEqual([
      expect.objectContaining({ ability: "dex", conditionIds: ["restrained"] })
    ]);
    answer(caster.state, FOE, 2);
    const restrained = caster.state.actors.find((actor) => actor.id === FOE)!.effects[0]!;
    expect(restrained).toMatchObject({
      escapeDc: 15,
      tags: expect.arrayContaining(["escape-athletics"]),
      castId: CAST
    });
  });

  it("Stinking Cloud: Poisoned until the end of that turn, not the next", () => {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(20, 20) });
    castArea(caster, "spell-stinking-cloud", [10, 10], 4);
    endTurn(caster.state);
    answer(caster.state, FOE, 2);
    const poisoned = caster.state.actors.find((actor) => actor.id === FOE)!.effects[0]!;
    expect(poisoned.duration).toEqual({ type: "until-bearer-turn-end", skipsCurrentTurn: false });
    expect(caster.state.actors.find((actor) => actor.id === FOE)!.conditions.map((entry) => entry.id)).toContain(
      "poisoned"
    );
    // "While Poisoned in this way, the creature can't take an action or a Bonus Action."
    const goblin = caster.state.actors.find((actor) => actor.id === FOE)!;
    const blocked = evaluateActionEconomy(caster.state, goblin, DAGGER, [HERO], undefined);
    expect(blocked.violations).toContainEqual(
      expect.objectContaining({ rule: "condition.incapacitated", message: expect.stringContaining("reeling") })
    );
  });

  it("Sleet Storm: a failure knocks it Prone and breaks its Concentration", () => {
    const caster = fight(wizard);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(20, 20) });
    castArea(caster, "spell-sleet-storm", [10, 10], 4);
    const goblin = caster.state.actors.find((actor) => actor.id === FOE)!;
    goblin.effects = [
      {
        id: "goblin-concentration",
        name: "Concentrating on Hex",
        tags: ["concentrating"],
        sourceActorId: FOE,
        sourceName: "Goblin",
        sourceActionId: null,
        startedRound: 1,
        duration: { type: "manual" },
        endsWhenSourceDefeated: true,
        voidWhileIncapacitated: false,
        concentration: true,
        endsWithTag: null,
        modifiers: [],
        linkedConditionIds: [],
        escapeDc: null,
        onEnd: []
      }
    ];
    endTurn(caster.state);
    answer(caster.state, FOE, 2);
    expect(goblin.conditions.map((entry) => entry.id)).toContain("prone");
    expect(goblin.effects.some((effect) => effect.tags.includes("concentrating"))).toBe(false);
  });
});

describe("damage with no save: Spike Growth and Wall of Fire", () => {
  it("Spike Growth deals 2d4 Piercing for every 5 feet travelled in it", () => {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(30, 30) });
    castArea(caster, "spell-spike-growth", [14, 10], 4);
    const events = walk(
      caster.state,
      FOE,
      [
        [10, 10],
        [11, 10],
        [12, 10],
        [13, 10]
      ],
      [1, 1, 2, 2, 3, 3]
    );
    // Three steps, all inside the area: 3 x 2d4.
    expect(events[0]!.text).toBe("Goblin moves through Spike Growth and takes 12 Piercing damage.");
    expect(caster.state.actors.find((actor) => actor.id === FOE)!.hp.current).toBe(188);
  });

  it("Wall of Fire burns a creature entering it and again ending its turn there", () => {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(30, 30) });
    const wall: SpellZone = {
      id: CAST,
      spellId: "wall-of-fire",
      name: "Wall of Fire",
      laterActionId: "spell-wall-of-fire-then-burn",
      casterId: HERO,
      castId: null,
      rounds: null,
      startedRound: 1,
      level: 4,
      dc: 15,
      annotationId: CAST,
      area: { shape: "line", sizeFeet: 60, widthFeet: 5 },
      damageDealt: 0,
      entered: [],
      affected: []
    };
    caster.state.combat.spellZones = [wall];
    drawArea(caster.state, CAST, [12, 5], 10, "line");
    walk(caster.state, FOE, [
      [10, 10],
      [11, 10],
      [12, 10]
    ]);
    expect(caster.state.actors.find((actor) => actor.id === FOE)!.hp.current).toBe(200 - 15);
    zonesAtTurnEnd(caster.state, FOE, zoneDeps());
    expect(caster.state.actors.find((actor) => actor.id === FOE)!.hp.current).toBe(200 - 30);
  });
});

describe("Guardian of Faith: enemies only, and gone after 60 damage", () => {
  it("raises the save for an enemy coming within 10 feet, and vanishes once its damage reaches 60", () => {
    const caster = fight(cleric, { ally: true });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10), [FOE2]: cell(16, 10), [ALLY]: cell(9, 9) });
    caster.state.combat.spellZones = [
      {
        id: CAST,
        spellId: "guardian-of-faith",
        name: "Guardian of Faith",
        laterActionId: "spell-guardian-of-faith-then-save",
        casterId: HERO,
        castId: null,
        rounds: null,
        startedRound: 1,
        level: 4,
        dc: 15,
        annotationId: CAST,
        area: { shape: "sphere", sizeFeet: 10, widthFeet: null },
        damageDealt: 50,
        entered: [],
        affected: []
      }
    ];
    drawArea(caster.state, CAST, [12, 12], 2);
    expect(
      walk(caster.state, ALLY, [
        [9, 9],
        [11, 11]
      ])
    ).toEqual([]);
    walk(caster.state, FOE2, [
      [16, 10],
      [15, 10],
      [14, 10]
    ]);
    expect(savesOf(caster.state, FOE2)[0]).toMatchObject({ ability: "dex", proposedDamage: 20 });
    const { events } = answer(caster.state, FOE2, 1);
    expect(events.map((event) => event.text)).toContain("Guardian of Faith ends after dealing 60 damage.");
    expect(caster.state.combat.spellZones).toEqual([]);
  });
});

describe("a player's cast leaves the area for the GM to place", () => {
  it("opens the zone unplaced, with a reminder, and acts once the GM places it", () => {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 5), [FOE2]: cell(30, 30) });
    const resolution = caster.resolve("spell-moonbeam", { targetIds: [], commandId: CAST });
    expect(zone(caster.state).annotationId).toBeNull();
    expect(resolution.warnings).toContain(
      "Place Moonbeam's area on the map (Spell areas), and the server will run it."
    );
    expect(
      walk(caster.state, FOE, [
        [6, 5],
        [5, 5]
      ])
    ).toEqual([]);
    const AREA = "60000000-0000-4000-8000-000000000002";
    drawArea(caster.state, AREA, [3, 5], 1);
    placeZone(caster.state, CAST, AREA);
    expect(
      walk(caster.state, FOE, [
        [5, 5],
        [4, 5]
      ]).map((event) => event.text)
    ).toEqual(["Goblin enters Moonbeam and makes a CON save (DC 15)."]);
  });
});

describe("what a spell lets its caster do on later turns, while it lasts and at its level", () => {
  it("offers Spiritual Weapon's attack only while the spell is up, at the slot it was cast with", () => {
    const caster = fight(cleric, { distance: 30 });
    expect(() => caster.resolve("spell-spiritual-weapon-then-attack", {}, [15, 4])).toThrowError(
      /doesn't have Spiritual Weapon up/
    );
    caster.resolve("spell-spiritual-weapon", { slotLevel: 3 }, [15, 4, 4]);
    expect(caster.action("spell-spiritual-weapon-then-attack").damage).toEqual([{ formula: "2d8 + 4", type: "force" }]);
    // "On your later turns": not on the turn of the cast, even with the Bonus Action unspent.
    caster.state.combat.turn = { ...caster.state.combat.turn, bonusActionUsed: false };
    expect(() => caster.resolve("spell-spiritual-weapon-then-attack", {}, [15, 4, 4])).toThrowError(
      /Mira cast Spiritual Weapon this turn, and Spiritual Weapon: attack comes on later turns/
    );
    heroTurnAgain(caster.state);
    expect(caster.resolve("spell-spiritual-weapon-then-attack", {}, [15, 4, 4]).damageTotal).toBe(12);
  });

  it("starts Produce Flame with no attack, and its hurl is there until the spell ends", () => {
    const caster = fight(druid, { distance: 30 });
    expect(() => caster.resolve("spell-produce-flame-then-hurl", {}, [15, 3])).toThrowError(
      /doesn't have Produce Flame up/
    );
    const cast = caster.resolve("spell-produce-flame", { targetIds: [] });
    expect(cast.attack).toBeNull();
    expect(caster.hero.effects).toContainEqual(
      expect.objectContaining({ name: "Produce Flame", spell: { id: "produce-flame", level: 0 } })
    );
    caster.state.combat.turn = { ...caster.state.combat.turn, actionUsed: false };
    expect(caster.resolve("spell-produce-flame-then-hurl", {}, [15, 3, 3]).attack?.outcome).toBe("hit");
  });
});

describe("Heat Metal", () => {
  it("burns the creature holding the object, which saves to keep hold: Disadvantage if it does", () => {
    const caster = fight(druid);
    const cast = caster.resolve("spell-heat-metal", {}, [4, 4]);
    expect(cast.damageTargets).toEqual([expect.objectContaining({ targetId: FOE, total: 8 })]);
    expect(savesOf(caster.state, FOE)).toEqual([
      expect.objectContaining({ ability: "con", dc: 15, proposedDamage: 0, actionName: "Heat Metal: keep hold" })
    ]);
    answer(caster.state, FOE, 20);
    expect(caster.state.actors.find((actor) => actor.id === FOE)!.effects).toContainEqual(
      expect.objectContaining({
        name: "Heat Metal: holding the red-hot object",
        duration: { type: "until-source-next-turn" },
        castId: expect.any(String),
        modifiers: [
          expect.objectContaining({ roll: "attack", mode: "disadvantage" }),
          expect.objectContaining({ roll: "check", mode: "disadvantage" })
        ]
      })
    );
  });

  it("drops the object on a failure, and its Bonus Action heats it again at the cast's level", () => {
    const caster = fight(druid);
    caster.resolve("spell-heat-metal", { slotLevel: 3 }, [4, 4, 4]);
    const { events } = answer(caster.state, FOE, 1);
    expect(events.map((event) => event.text)).toContain(
      "Goblin drops the heated object, if it can. If it can't (armor it wears), give it Disadvantage on attack rolls and ability checks until the start of Maelin's next turn."
    );
    expect(caster.action("spell-heat-metal-then-heat-again").damage).toEqual([{ formula: "3d8", type: "fire" }]);
    // "On each of your later turns".
    expect(() => caster.resolve("spell-heat-metal-then-heat-again", {}, [2, 2, 2])).toThrowError(
      /cast Heat Metal this turn/
    );
    heroTurnAgain(caster.state);
    const again = caster.resolve("spell-heat-metal-then-heat-again", {}, [2, 2, 2]);
    expect(again.damageTotal).toBe(6);
    expect(savesOf(caster.state, FOE)).toHaveLength(1);
  });
});

describe("Entangle", () => {
  it("restrains on a failed save until the creature breaks free with Strength (Athletics) against the spell DC", () => {
    const caster = fight(druid);
    caster.resolve("spell-entangle", { targetIds: [FOE] });
    answer(caster.state, FOE, 2);
    expect(caster.state.actors.find((actor) => actor.id === FOE)!.effects[0]).toMatchObject({
      escapeDc: 15,
      tags: expect.arrayContaining(["escape-athletics"])
    });
  });
});
