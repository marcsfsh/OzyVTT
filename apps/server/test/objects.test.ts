import { describe, expect, it } from "vitest";
import { loadEquipment, loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { addEffect, makeEffect } from "../src/effects.js";
import { RulesBlockedError } from "../src/game-store.js";
import { mapDistance } from "../src/movement-narration.js";
import { strikeObject, type ObjectStrikeDeps } from "../src/object-strikes.js";
import { damageObject, findObject, objectFrom, objectOf, setWallObject, weighObjectDamage } from "../src/objects.js";
import { projectPlayerView } from "../src/projections.js";
import { answerSave } from "../src/saving-throws.js";
import { sceneSight } from "../src/vision/sight.js";
import { movementCost } from "../src/terrain.js";
import { cell, GEOMETRY, GOBLIN, HERO, SESSION_A, visionGame, wall } from "./vision-fixtures.js";

// SRD 5.2.1 Breaking Objects and Damage Threshold: an object's Armor Class and Hit Points, its Immunity to Poison and
// Psychic damage, the threshold below which damage does nothing, and what breaking it does on the map.

const monsters = loadMonsterDefinitions();
const statBlock = (id: string) => monsters.find((monster) => monster.source.externalId === id)!;
const TREANT = statBlock("treant");
const GOBLIN_WARRIOR = statBlock("goblin-warrior");

let ids = 0;
const nextId = () => `40000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

/** A door across the corridor between column 4 and column 5, at rows 4 to 6; walls close the rest. */
function corridor(options: Parameters<typeof visionGame>[0] = {}) {
  const door = wall({ x: 250, y: 250 }, { x: 250, y: 300 }, "door", false);
  const state = visionGame({
    walls: [wall({ x: 250, y: 0 }, { x: 250, y: 250 }), door, wall({ x: 250, y: 300 }, { x: 250, y: 600 })],
    ...options
  });
  return { state, door };
}

function strikeDeps(definition: ActorDefinition, faces: number[]): ObjectStrikeDeps {
  return {
    definition,
    resolveDefinition: (id) => monsters.find((monster) => monster.source.externalId === id),
    random: (sides) => Math.min(sides, faces.shift() ?? 1),
    newId: nextId,
    sessionId: "30000000-0000-4000-8000-00000000000a",
    now: () => "2026-10-19T00:00:00.000Z",
    geometry: GEOMETRY
  };
}

/** The goblin stands beside the door, at (4,5). */
function goblinAtDoor(state: GameState, definitionId = "goblin-warrior") {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === GOBLIN ? { ...token, position: cell(4, 5) } : token
  );
  const goblin = state.actors.find((actor) => actor.id === GOBLIN)!;
  goblin.definitionId = definitionId;
  state.combat.turnActorId = GOBLIN;
}

describe("an object's defences", () => {
  it("ignores Poison and Psychic damage, whatever it is made of", () => {
    const door = objectOf("Door", "wood", "medium", "resilient");
    expect(door.armorClass).toBe(15);
    expect(door.hitPoints).toEqual({ current: 18, maximum: 18 });
    expect(
      weighObjectDamage(door, [
        { amount: 9, type: "poison" },
        { amount: 4, type: "psychic" }
      ]).total
    ).toBe(0);
  });

  it("takes nothing below its damage threshold and the whole instance at or above it", () => {
    const gate = objectFrom({ name: "Gate", armorClass: 19, hitPoints: 100, damageThreshold: 10 });
    expect(weighObjectDamage(gate, [{ amount: 9, type: "bludgeoning" }])).toMatchObject({
      total: 0,
      belowThreshold: true
    });
    expect(weighObjectDamage(gate, [{ amount: 11, type: "bludgeoning" }]).total).toBe(11);
    expect(weighObjectDamage(gate, [{ amount: 10, type: "bludgeoning" }]).total).toBe(10);
  });

  it("doubles a vulnerability and halves a resistance", () => {
    const web = objectFrom({ name: "Web", armorClass: 10, hitPoints: 5, vulnerabilities: ["fire"] });
    expect(weighObjectDamage(web, [{ amount: 3, type: "fire" }]).total).toBe(6);
    const sheet = objectFrom({ name: "Sheet", armorClass: 11, hitPoints: 5, resistances: ["slashing"] });
    expect(weighObjectDamage(sheet, [{ amount: 7, type: "slashing" }]).total).toBe(3);
  });

  it("deals a Siege Monster's damage twice over, before the threshold", () => {
    const gate = objectFrom({ name: "Gate", armorClass: 19, hitPoints: 100, damageThreshold: 10 });
    expect(weighObjectDamage(gate, [{ amount: 6, type: "bludgeoning" }], { siege: true }).total).toBe(12);
  });

  it("takes nothing at all when it is immune to all damage", () => {
    const force = objectFrom({ name: "Wall of Force", armorClass: 10, hitPoints: 1, immuneToAll: true });
    expect(weighObjectDamage(force, [{ amount: 50, type: "force" }]).total).toBe(0);
  });
});

describe("breaking a door", () => {
  it("counts a door with no statistics as a wooden one", () => {
    const { state, door } = corridor();
    expect(findObject(state, { wallId: door.id })?.stats).toMatchObject({
      armorClass: 15,
      hitPoints: { current: 18, maximum: 18 }
    });
  });

  it("opens the way for movement and sight once the door is destroyed", () => {
    const { state, door } = corridor({ positions: { [GOBLIN]: cell(8, 5) } });
    expect(movementCost(state, GEOMETRY, HERO, cell(1, 5), cell(6, 5))?.blocked).toBe(true);
    const hit = damageObject(state, { wallId: door.id }, [{ amount: 20, type: "slashing" }]);
    expect(hit).toMatchObject({ destroyed: true, hitPointsLeft: 0 });
    expect(state.combat.vision.walls.some((candidate) => candidate.id === door.id)).toBe(false);
    expect(movementCost(state, GEOMETRY, HERO, cell(1, 5), cell(6, 5))?.feet).toBe(25);
    expect(sceneSight(state, { definition: () => undefined }).sees(HERO, GOBLIN)).toBe(true);
  });

  it("keeps a door Poison can't hurt whole", () => {
    const { state, door } = corridor();
    damageObject(state, { wallId: door.id }, [{ amount: 30, type: "poison" }]);
    expect(state.combat.vision.walls.find((candidate) => candidate.id === door.id)).toBeDefined();
  });

  it("keeps the damage the GM's new numbers leave", () => {
    const { state, door } = corridor();
    setWallObject(state, door.id, objectFrom({ name: "Iron door", armorClass: 19, hitPoints: 27 }));
    damageObject(state, { wallId: door.id }, [{ amount: 10, type: "bludgeoning" }]);
    expect(findObject(state, { wallId: door.id })?.stats.hitPoints).toEqual({ current: 17, maximum: 27 });
  });
});

describe("attacking an object", () => {
  it("rolls the attack against the door's Armor Class and its damage against its Hit Points", () => {
    const { state, door } = corridor();
    goblinAtDoor(state);
    // 12 + 4 hits AC 15; the scimitar's 1d6 + 2 rolls 6.
    const struck = strikeObject(
      state,
      { actorId: GOBLIN, actionId: "scimitar", target: { wallId: door.id }, commandId: nextId() },
      { role: "gm" },
      strikeDeps(GOBLIN_WARRIOR, [12, 6])
    );
    expect(struck).toMatchObject({ outcome: "hit", total: 16, hit: { hitPointsLeft: 10, destroyed: false } });
    expect(state.combat.turn.actionUsed).toBe(true);
  });

  it("misses below the Armor Class and on a natural 1", () => {
    const { state, door } = corridor();
    goblinAtDoor(state);
    const miss = strikeObject(
      state,
      { actorId: GOBLIN, actionId: "scimitar", target: { wallId: door.id }, commandId: nextId() },
      { role: "gm" },
      strikeDeps(GOBLIN_WARRIOR, [10])
    );
    expect(miss).toMatchObject({ outcome: "miss", hit: null });
    expect(findObject(state, { wallId: door.id })?.stats.hitPoints.current).toBe(18);
  });

  it("doubles the dice on a natural 20", () => {
    const { state, door } = corridor();
    goblinAtDoor(state);
    // 2d6 + 2 on a Critical Hit: 6 + 6 + 2.
    const crit = strikeObject(
      state,
      { actorId: GOBLIN, actionId: "scimitar", target: { wallId: door.id }, commandId: nextId() },
      { role: "gm" },
      strikeDeps(GOBLIN_WARRIOR, [20, 6, 6])
    );
    expect(crit).toMatchObject({ outcome: "crit", hit: { damage: { total: 14 } } });
  });

  it("refuses a player's swing at a door beyond its reach", () => {
    // Borin, three squares from the door, swings a scimitar.
    const { state, door } = corridor({ actors: { [HERO]: { definitionId: "goblin-warrior" } } });
    expect(() =>
      strikeObject(
        state,
        { actorId: HERO, actionId: "scimitar", target: { wallId: door.id }, commandId: nextId() },
        { role: "player", sessionId: "30000000-0000-4000-8000-0000000000a1" },
        strikeDeps(GOBLIN_WARRIOR, [15, 3])
      )
    ).toThrowError(new RulesBlockedError("range.out-of-reach", "Door is 15 ft away, beyond Scimitar's 5 ft."));
  });

  it("deals a Siege Monster's damage twice to the door", () => {
    // SRD Siege Monster: "The treant deals double damage to objects and structures."
    const { state, door } = corridor();
    goblinAtDoor(state, "treant");
    // Slam: 3d6 + 6 rolls 1 + 1 + 1 + 6 = 9, doubled to 18: the door is gone.
    const struck = strikeObject(
      state,
      { actorId: GOBLIN, actionId: "slam", target: { wallId: door.id }, commandId: nextId() },
      { role: "gm" },
      strikeDeps(TREANT, [15, 1, 1, 1])
    );
    expect(struck.hit).toMatchObject({ damage: { total: 18 }, destroyed: true });
  });

  it("frees the creature a net holds once the net is destroyed", () => {
    const state = visionGame({ positions: { [GOBLIN]: cell(2, 5) } });
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    addEffect(
      state,
      HERO,
      makeEffect({
        id: "net",
        name: "Net",
        duration: { type: "manual" },
        linkedConditionIds: ["restrained"],
        heldBy: objectFrom({ name: "Net", armorClass: 10, hitPoints: 5, immunities: ["bludgeoning"] })
      }),
      []
    );
    goblinAtDoor(state);
    state.combat.tokens = state.combat.tokens.map((token) =>
      token.actorId === GOBLIN ? { ...token, position: cell(2, 5) } : token
    );
    const deps = {
      ...strikeDeps(GOBLIN_WARRIOR, [12, 4]),
      distanceFeet: (a: string, b: string) => {
        const at = (id: string) => state.combat.tokens.find((token) => token.actorId === id)?.position;
        const [from, to] = [at(a), at(b)];
        return from && to ? (mapDistance(GEOMETRY, from, to)?.value ?? null) : null;
      }
    };
    const struck = strikeObject(
      state,
      { actorId: GOBLIN, actionId: "scimitar", target: { actorId: HERO, effectId: "net" }, commandId: nextId() },
      { role: "gm" },
      deps
    );
    expect(struck.hit?.destroyed).toBe(true);
    expect(hero.effects.some((effect) => effect.id === "net")).toBe(false);
    expect(hero.conditions.some((condition) => condition.id === "restrained")).toBe(false);
  });
});

describe("what holds a restrained creature", () => {
  // SRD Giant Spider, Web: "the Restrained condition until the web is destroyed (AC 10; HP 5; Vulnerability to Fire
  // damage; Immunity to Poison and Psychic damage)".
  const SPIDER = statBlock("giant-spider");

  function webbed() {
    const state = visionGame({
      positions: { [GOBLIN]: cell(3, 5) },
      actors: { [GOBLIN]: { definitionId: "giant-spider" } }
    });
    state.combat.turnActorId = GOBLIN;
    const web = SPIDER.actions.find((action) => action.id === "web")!;
    resolveDefinitionAction(
      state,
      web,
      { actorId: GOBLIN, targetIds: [HERO], commandId: nextId(), rollMode: null, override: null },
      {
        random: () => 1,
        newRollId: nextId,
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-19T00:00:00.000Z",
        definition: SPIDER,
        resolveDefinition: (id) => (id === "giant-spider" ? SPIDER : undefined)
      }
    );
    const save = state.combat.pendingSaves.find((pending) => pending.targetActorId === HERO)!;
    answerSave(
      state,
      nextId(),
      save.id,
      "manual",
      5,
      true,
      { role: "gm" },
      {
        random: () => 10,
        newRollId: nextId,
        sessionId: "30000000-0000-4000-8000-00000000000a",
        role: "gm",
        now: () => "2026-10-19T00:00:00.000Z",
        resolveDefinition: () => undefined
      }
    );
    const hero = state.actors.find((actor) => actor.id === HERO)!;
    return { state, hero };
  }

  it("leaves the web on the restrained creature as an object", () => {
    const { hero } = webbed();
    const held = hero.effects.find((effect) => effect.heldBy !== undefined);
    expect(held?.heldBy).toEqual({
      name: "Web",
      armorClass: 10,
      hitPoints: { current: 5, maximum: 5 },
      vulnerabilities: ["fire"]
    });
    expect(hero.conditions.map((condition) => condition.id)).toContain("restrained");
  });

  it("frees the creature when 3 Fire damage, doubled, destroys the web", () => {
    const { state, hero } = webbed();
    const held = hero.effects.find((effect) => effect.heldBy !== undefined)!;
    const hit = damageObject(state, { actorId: HERO, effectId: held.id }, [{ amount: 3, type: "fire" }]);
    expect(hit).toMatchObject({ destroyed: true, damage: { total: 6 } });
    expect(hero.conditions.map((condition) => condition.id)).not.toContain("restrained");
  });

  it("sends players the web by name alone", () => {
    const { state } = webbed();
    const view = projectPlayerView(state, SESSION_A, () => null);
    const hero = view.actors.find((actor) => actor.id === HERO)!;
    expect(hero.effects.find((effect) => effect.heldBy !== undefined)?.heldBy).toEqual({ name: "Web" });
  });

  it("gives the Net its AC 10 and 5 Hit Points", () => {
    const net = loadEquipment().find((item) => item.id === "net")!;
    expect(net.actions?.[0]?.save?.heldBy).toEqual({
      name: "Net",
      armorClass: 10,
      hitPoints: 5,
      immunities: ["bludgeoning"]
    });
  });
});
