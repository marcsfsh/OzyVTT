import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { addEffect, makeEffect } from "../src/effects.js";
import { spellWardOf } from "../src/resolution/spell-wards.js";
import { movementCost } from "../src/terrain.js";
import { NO_SHAPE_SHIFT_TAG } from "../src/transform/rules.js";
import { sceneSight } from "../src/vision/sight.js";
import { settleZoneAuras } from "../src/zone-auras.js";
import { teleportAcrossBarrier, teleportBarredFor } from "../src/zone-barriers.js";
import { zoneMovementOptions } from "../src/zone-ground.js";
import { ALLY, fight, FOE, FOE2, HERO } from "./spell-casters.js";
import { carry, cell, clericAt, drawArea, druidAt, GRID, place, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 areas that bar and ward: Magic Circle (the types it wards, Disadvantage on attacks into it, its ward against
// Charmed and Frightened, the teleport save, the reversed circle), Private Sanctum (its foggy edge, no teleporting
// either way, the Divination ward), Tiny Hut (its one-way dome, its light, its end when the caster leaves), Hallow (its
// ward and its extra effect) and Moonbeam's bar on shape-shifting.

const CAST = "63000000-0000-4000-8000-0000000000b1";
const monster = (id: string) => loadMonsterDefinitions().find((entry) => entry.source?.externalId === id)!;
const DEFINITIONS: Readonly<Record<string, ActorDefinition>> = {
  imp: monster("imp"),
  zombie: monster("zombie"),
  guard: monster("guard"),
  ogre: monster("ogre")
};
const resolveDefinition = (definitionId: string) => DEFINITIONS[definitionId];
const deps = () => ({ ...zoneDeps(), resolveDefinition });
const become = (state: GameState, actorId: string, definitionId: string) => {
  state.actors.find((actor) => actor.id === actorId)!.definitionId = definitionId;
};
const moveTo = (state: GameState, actorId: string, at: readonly [number, number]) => {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: cell(...at) } : token
  );
};
const actorOf = (state: GameState, actorId: string) => state.actors.find((actor) => actor.id === actorId)!;
const aurasOf = (state: GameState, actorId: string) =>
  actorOf(state, actorId).effects.filter((effect) => effect.tags.includes("zone-aura"));
function withVision(state: GameState): void {
  state.combat.vision = {
    ...state.combat.vision,
    enabled: true,
    ambient: "bright",
    walls: [],
    measure: { width: 3000, height: 3000, pixelsPerFoot: 10 }
  };
}

describe("Magic Circle", () => {
  function circle(option: string, creatureTypes?: string[]) {
    const caster = fight(wizardAt(5, ["magic-circle"]), { combat: false, ally: true });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 16), [FOE2]: cell(12, 16), [ALLY]: cell(10, 10) });
    become(caster.state, FOE, "imp");
    become(caster.state, FOE2, "zombie");
    carry(caster.state, HERO, "Powdered silver and salt");
    caster.resolve("spell-magic-circle", {
      targetIds: [],
      commandId: CAST,
      areaPlaced: true,
      option,
      ...(creatureTypes ? { creatureTypes } : {})
    });
    drawArea(caster.state, CAST, [10, 10], 2);
    return caster;
  }
  const walk = (state: GameState, actorId: string, from: readonly [number, number], to: readonly [number, number]) =>
    movementCost(state, GRID, actorId, cell(...from), cell(...to), {
      resolveDefinition,
      ...zoneMovementOptions(state, actorId, deps())
    })?.blocked;

  it("wards only the types its caster chose: a Fiend is kept out, an Undead is not", () => {
    const { state } = circle("facing-out", ["fiend"]);
    expect(state.combat.spellZones[0]).toMatchObject({ wardTypes: ["fiend"] });
    expect(walk(state, FOE, [10, 16], [10, 10])).toBe(true);
    expect(walk(state, FOE2, [12, 16], [10, 11])).toBeUndefined();
  });

  it("gives those inside Disadvantage on the chosen types' attacks and a ward against their Charmed and Frightened", () => {
    const { state } = circle("facing-out", ["fiend"]);
    settleZoneAuras(state, deps());
    const [ward] = aurasOf(state, ALLY);
    expect(ward).toMatchObject({
      conditionWards: { conditionIds: ["charmed", "frightened"], creatureTypes: ["fiend"] },
      modifiers: [
        {
          type: "roll-mode",
          roll: "incoming-attack",
          mode: "disadvantage",
          when: [{ type: "on-attack-roll" }, { type: "source-creature-type-is", creatureTypes: ["fiend"] }]
        }
      ]
    });
    expect(aurasOf(state, FOE)).toEqual([]);
  });

  it("makes a chosen creature teleporting in succeed on a Charisma save first, a failure wasting it", () => {
    const { state } = circle("facing-out");
    const failed = teleportAcrossBarrier(state, FOE, cell(10, 16), cell(10, 10), 1, { ...deps(), rollDie: () => 1 });
    expect(failed?.held).toBe(true);
    expect(failed?.events[0]?.text).toMatch(/fails a DC \d+ Charisma saving throw .* The teleport is wasted\./);
    const passed = teleportAcrossBarrier(state, FOE, cell(10, 16), cell(10, 10), 1, { ...deps(), rollDie: () => 20 });
    expect(passed?.held).toBe(false);
    // An Undead isn't warded when the caster names only Fiends.
    const chosen = circle("facing-out", ["fiend"]).state;
    expect(
      teleportAcrossBarrier(chosen, FOE2, cell(12, 16), cell(10, 10), 1, { ...deps(), rollDie: () => 1 })
    ).toBeNull();
  });

  it("reversed, holds a chosen creature in and wards those outside", () => {
    const { state } = circle("reversed", ["fiend"]);
    moveTo(state, FOE, [10, 11]);
    expect(walk(state, FOE, [10, 11], [10, 16])).toBe(true);
    moveTo(state, ALLY, [20, 20]);
    settleZoneAuras(state, deps());
    expect(aurasOf(state, ALLY)).toHaveLength(1);
    expect(aurasOf(state, FOE)).toEqual([]);
  });
});

describe("Private Sanctum", () => {
  function sanctum(option?: string) {
    const caster = fight(wizardAt(7, ["private-sanctum"]), { combat: false, ally: true });
    place(caster.state, { [HERO]: cell(20, 20), [ALLY]: cell(12, 12), [FOE]: cell(25, 12) });
    withVision(caster.state);
    carry(caster.state, HERO, "Lead sheet");
    caster.resolve("spell-private-sanctum", {
      targetIds: [],
      commandId: CAST,
      areaPlaced: true,
      ...(option ? { option } : {})
    });
    // A 30-foot Cube: cells 10 to 15 on both axes.
    drawArea(caster.state, CAST, [10, 10], 6, "square");
    return caster;
  }

  it("with every property: its foggy edge blocks sight both ways, and no one teleports in or out", () => {
    const { state } = sanctum();
    const sight = sceneSight(state, { definition: () => undefined });
    expect(sight.sees(FOE, ALLY)).toBe(false);
    expect(sight.sees(ALLY, FOE)).toBe(false);
    expect(teleportBarredFor(state, ALLY, cell(12, 12), cell(25, 25), 1, deps())).toBe("out of Private Sanctum");
    expect(teleportBarredFor(state, FOE, cell(25, 12), cell(12, 13), 1, deps())).toBe("into Private Sanctum");
  });

  it("wards the creatures inside against Divination spells", () => {
    const { state } = sanctum();
    settleZoneAuras(state, deps());
    const ally = actorOf(state, ALLY);
    expect(spellWardOf(state, ally, { id: "detect-thoughts", school: "divination" }, FOE, {})).toBe("Private Sanctum");
    expect(
      spellWardOf(state, actorOf(state, FOE), { id: "detect-thoughts", school: "divination" }, HERO, {})
    ).toBeNull();
  });

  it("takes only the properties its caster picked", () => {
    const { state } = sanctum("no-teleport");
    expect(sceneSight(state, { definition: () => undefined }).sees(FOE, ALLY)).toBe(true);
    expect(teleportBarredFor(state, ALLY, cell(12, 12), cell(25, 25), 1, deps())).toBe("out of Private Sanctum");
  });
});

describe("Tiny Hut", () => {
  function hut(option?: string) {
    const caster = fight(wizardAt(5, ["tiny-hut"]), { combat: false, ally: true });
    place(caster.state, { [HERO]: cell(10, 10), [ALLY]: cell(11, 10), [FOE]: cell(20, 10) });
    withVision(caster.state);
    carry(caster.state, HERO, "Crystal bead");
    caster.resolve("spell-tiny-hut", { targetIds: [], commandId: CAST, ...(option ? { option } : {}) });
    return caster;
  }

  it("is opaque from outside and clear from inside", () => {
    const { state } = hut();
    const sight = sceneSight(state, { definition: () => undefined });
    expect(sight.sees(FOE, ALLY)).toBe(false);
    expect(sight.sees(ALLY, FOE)).toBe(true);
  });

  it("fills its inside with the Darkness its caster commands", () => {
    const { state } = hut("dark");
    expect(state.combat.vision.areas.map((area) => area.kind).sort()).toEqual(["dark", "heavily-obscured"]);
  });

  it("ends when its caster walks out of it", () => {
    const { state } = hut();
    moveTo(state, HERO, [20, 20]);
    settleZoneAuras(state, deps());
    expect(state.combat.spellZones).toEqual([]);
    expect(actorOf(state, HERO).effects.some((effect) => effect.name === "Tiny Hut")).toBe(false);
  });

  it("fails when a creature stands partly inside its dome", () => {
    const caster = fight(wizardAt(5, ["tiny-hut"]), { combat: false, ally: true });
    place(caster.state, { [HERO]: cell(10, 10) });
    withVision(caster.state);
    carry(caster.state, HERO, "Crystal bead");
    // A Large token whose square runs from 7.5 to 17.5 feet east of the caster's middle: across the 12.5-foot edge.
    caster.state.combat.tokens = [
      ...caster.state.combat.tokens,
      { ...caster.state.combat.tokens[0]!, actorId: ALLY, position: { x: 650, y: 525 }, sizeCells: 2 }
    ];
    expect(() => caster.resolve("spell-tiny-hut", { targetIds: [], commandId: CAST })).toThrowError(/fails/);
  });
});

describe("Hallow", () => {
  function hallow(option: string, damageType?: string) {
    const caster = fight(clericAt(13, ["hallow"]), { combat: false, ally: true });
    place(caster.state, { [HERO]: cell(10, 10), [ALLY]: cell(12, 10), [FOE]: cell(30, 30), [FOE2]: cell(11, 12) });
    become(caster.state, FOE, "imp");
    become(caster.state, FOE2, "imp");
    carry(caster.state, HERO, "Incense");
    caster.resolve("spell-hallow", {
      targetIds: [],
      commandId: CAST,
      areaPlaced: true,
      option,
      creatureTypes: ["fiend"],
      ...(damageType ? { damageType } : {})
    });
    drawArea(caster.state, CAST, [10, 10], 6);
    return caster;
  }

  it("keeps a creature of a warded type from walking in", () => {
    const { state } = hallow("peaceful-rest");
    const blocked = movementCost(state, GRID, FOE, cell(30, 30), cell(10, 10), {
      resolveDefinition,
      ...zoneMovementOptions(state, FOE, deps())
    })?.blocked;
    expect(blocked).toBe(true);
  });

  it("holds off a Charmed condition a Fiend gave a creature while it stands inside", () => {
    const { state } = hallow("peaceful-rest");
    const ally = actorOf(state, ALLY);
    addEffect(
      state,
      ALLY,
      makeEffect({
        id: "charm",
        name: "Charmed by the imp",
        sourceActorId: FOE,
        sourceName: "Imp",
        startedRound: 1,
        duration: { type: "manual" },
        linkedConditionIds: ["charmed"]
      })
    );
    expect(ally.conditions.map((condition) => condition.id)).toContain("charmed");
    settleZoneAuras(state, deps());
    expect(actorOf(state, ALLY).conditions.map((condition) => condition.id)).not.toContain("charmed");
    moveTo(state, ALLY, [40, 40]);
    settleZoneAuras(state, deps());
    expect(actorOf(state, ALLY).conditions.map((condition) => condition.id)).toContain("charmed");
  });

  it("Fear frightens a warded creature inside, and Courage keeps the others from being frightened", () => {
    const feared = hallow("fear");
    settleZoneAuras(feared.state, deps());
    expect(actorOf(feared.state, FOE2).conditions.map((condition) => condition.id)).toContain("frightened");
    expect(actorOf(feared.state, ALLY).conditions.map((condition) => condition.id)).not.toContain("frightened");

    const brave = hallow("courage");
    settleZoneAuras(brave.state, deps());
    expect(aurasOf(brave.state, ALLY).find((effect) => effect.conditionImmunities)?.conditionImmunities).toEqual([
      "frightened"
    ]);
    expect(aurasOf(brave.state, FOE2).some((effect) => effect.conditionImmunities)).toBe(false);
  });

  it("Vulnerability gives a warded creature inside Vulnerability to the chosen type", () => {
    const { state } = hallow("vulnerability", "radiant");
    settleZoneAuras(state, deps());
    expect(aurasOf(state, FOE2).flatMap((effect) => effect.modifiers)).toContainEqual({
      type: "damage-vulnerability",
      damageTypes: ["radiant"]
    });
  });

  it("fails over ground already hallowed, and stands beside another", () => {
    const { state, resolve } = hallow("peaceful-rest");
    carry(state, HERO, "Incense", 2);
    const again = (origin: readonly [number, number], commandId: string) =>
      resolve("spell-hallow", {
        targetIds: [],
        commandId,
        areaPlaced: true,
        placedArea: { shape: "circle", origin: cell(...origin), target: cell(origin[0] + 6, origin[1]) }
      });
    expect(() => again([14, 10], "63000000-0000-4000-8000-0000000000b2")).toThrowError(/already under Hallow/);
    again([40, 10], "63000000-0000-4000-8000-0000000000b3");
    expect(state.combat.spellZones.filter((zone) => zone.spellId === "hallow")).toHaveLength(2);
  });

  it("Extradimensional Interference keeps a warded creature from teleporting in", () => {
    const { state } = hallow("extradimensional");
    expect(teleportBarredFor(state, FOE, cell(30, 30), cell(10, 11), 1, deps())).toBe("into Hallow");
    expect(teleportBarredFor(state, ALLY, cell(12, 10), cell(30, 31), 1, deps())).toBeNull();
  });
});

describe("Moonbeam's bar on shape-shifting", () => {
  it("lifts once the creature that failed is out of the Cylinder", () => {
    const caster = fight(druidAt(5, ["moonbeam"]), { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 10) });
    caster.resolve("spell-moonbeam", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [10, 10], 1);
    addEffect(
      caster.state,
      FOE,
      makeEffect({
        id: "held",
        name: "Held in Moonbeam",
        tags: [NO_SHAPE_SHIFT_TAG],
        sourceActorId: HERO,
        sourceName: "Hero",
        startedRound: 1,
        duration: { type: "manual" },
        castId: CAST
      })
    );
    settleZoneAuras(caster.state, deps());
    expect(actorOf(caster.state, FOE).effects.some((effect) => effect.id === "held")).toBe(true);
    moveTo(caster.state, FOE, [20, 20]);
    settleZoneAuras(caster.state, deps());
    expect(actorOf(caster.state, FOE).effects.some((effect) => effect.id === "held")).toBe(false);
  });
});
