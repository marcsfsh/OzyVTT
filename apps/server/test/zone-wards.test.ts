import { describe, expect, it } from "vitest";
import { loadMonsterDefinitions } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { burstEndedZones, zonesAfterMove, zoneRowOf } from "../src/spell-zones.js";
import { movementCost } from "../src/terrain.js";
import { shellsForcedBy, teleportBarredAt } from "../src/zone-barriers.js";
import { zoneMovementOptions } from "../src/zone-ground.js";
import { ALLY, build, catalog, fight, FOE, FOE2, HERO, view, wizardInput } from "./spell-casters.js";
import { carry, cell, clericAt, drawArea, druidAt, GRID, hpOf, place, savesOf, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 spells that ward an area: an alarm that tells its caster who came in (Alarm), a glyph that bursts once set
// off (Glyph of Warding), damage to the creature types a ward names and no teleporting in (Forbiddance), and barriers
// that hold creatures back at the edge (Antilife Shell, Magic Circle).

const CAST = "63000000-0000-4000-8000-000000000001";
const monster = (id: string) => loadMonsterDefinitions().find((entry) => entry.source?.externalId === id)!;
const DEFINITIONS: Readonly<Record<string, ActorDefinition>> = {
  imp: monster("imp"),
  zombie: monster("zombie"),
  goblin: monster("goblin-warrior"),
  guard: monster("guard")
};
const resolveDefinition = (definitionId: string) => DEFINITIONS[definitionId];
const deps = () => ({ ...zoneDeps(), resolveDefinition });
const wizard = build(wizardInput(["alarm", "glyph-of-warding", "magic-circle", "magic-missile"]));

/** Makes a creature one of the stat blocks above. */
const become = (state: GameState, actorId: string, definitionId: string) => {
  state.actors.find((actor) => actor.id === actorId)!.definitionId = definitionId;
};
const moveTo = (state: GameState, actorId: string, at: readonly [number, number]) => {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: cell(...at) } : token
  );
};

describe("Alarm", () => {
  function alarm() {
    const caster = fight(wizard, { combat: false, ally: true });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 6), [ALLY]: cell(10, 7), [FOE2]: cell(40, 40) });
    caster.resolve("spell-alarm", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [5, 5], 4, "square");
    return caster;
  }

  it("lasts its 8 hours on the game clock", () => {
    const { hero, state } = alarm();
    expect(state.combat.spellZones).toEqual([expect.objectContaining({ spellId: "alarm", effectId: `${CAST}:spell` })]);
    expect(hero.effects.find((effect) => effect.id === `${CAST}:spell`)?.duration).toEqual({
      type: "minutes",
      remaining: 480
    });
  });

  it("tells the GM who enters the warded area, with no save, and spares the caster's allies", () => {
    const { state } = alarm();
    const intruder = zonesAfterMove(state, { moverId: FOE, path: [cell(10, 6), cell(7, 6)] }, deps());
    expect(intruder).toEqual([
      expect.objectContaining({ text: "Alarm: Goblin enters Ansel's warded area.", gmOnly: true })
    ]);
    expect(zonesAfterMove(state, { moverId: ALLY, path: [cell(10, 7), cell(7, 7)] }, deps())).toEqual([]);
    expect(state.combat.pendingSaves).toEqual([]);
  });
});

describe("Glyph of Warding: the explosive rune", () => {
  function glyph() {
    const caster = fight(wizard, { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(12, 10), [FOE2]: cell(14, 10) });
    carry(caster.state, HERO, "Diamond dust");
    caster.resolve("spell-glyph-of-warding", {
      targetIds: [],
      commandId: CAST,
      areaPlaced: true,
      damageType: "fire"
    });
    // The 20-foot-radius Sphere the glyph bursts in, centred on it.
    drawArea(caster.state, CAST, [10, 10], 4);
    return caster;
  }

  it("is drawn for the GM and its caster alone", () => {
    expect(zoneRowOf(view.spellRecord("glyph-of-warding")!)?.zone?.hidden).toBe(true);
  });

  it("waits, unseen, until a creature steps onto it", () => {
    const { state } = glyph();
    expect(state.combat.spellZones).toEqual([
      expect.objectContaining({ spellId: "glyph-of-warding", damageType: "fire", burstsOnEnd: true })
    ]);
    // Within the Sphere but not on the glyph.
    expect(zonesAfterMove(state, { moverId: FOE, path: [cell(14, 13), cell(12, 10)] }, deps())).toEqual([]);
  });

  it("bursts once set off: each creature in the Sphere saves against 5d8 of the chosen type, and the spell ends", () => {
    const { state, hero } = glyph();
    moveTo(state, FOE, [10, 11]);
    const set = zonesAfterMove(state, { moverId: FOE, path: [cell(12, 10), cell(11, 10), cell(10, 11)] }, deps());
    expect(set.map((event) => event.text)).toContain("Goblin sets off Glyph of Warding.");
    expect(state.combat.spellZones).toEqual([expect.objectContaining({ bursting: true })]);
    expect(hero.effects.some((effect) => effect.id === `${CAST}:spell`)).toBe(false);
    const burst = burstEndedZones(state, zoneDeps([4, 4, 4, 4, 4]));
    expect(burst.map((event) => event.text)).toEqual([
      expect.stringMatching(/^Glyph of Warding explodes: Goblin, Orc make a DEX save/)
    ]);
    expect(savesOf(state, FOE)).toEqual([
      expect.objectContaining({ proposedDamage: 20, proposedDamageParts: [{ amount: 20, type: "fire" }] })
    ]);
    expect(savesOf(state, FOE2)).toHaveLength(1);
    expect(state.combat.spellZones).toEqual([]);
  });
});

describe("Forbiddance", () => {
  const cleric = clericAt(11, ["forbiddance"]);

  function warded() {
    const caster = fight(cleric, { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(30, 10), [FOE2]: cell(30, 12) });
    become(caster.state, FOE, "imp");
    become(caster.state, FOE2, "guard");
    carry(caster.state, HERO, "Ruby dust");
    caster.resolve("spell-forbiddance", { targetIds: [], commandId: CAST, areaPlaced: true, damageType: "necrotic" });
    // A 200-foot square: cells 5 to 44 on both axes.
    drawArea(caster.state, CAST, [5, 5], 40, "square");
    return caster;
  }

  it("deals its damage, with no save, to a creature of a warded type that enters", () => {
    const { state } = warded();
    const entering = zonesAfterMove(state, { moverId: FOE, path: [cell(46, 10), cell(44, 10)] }, deps());
    expect(entering.map((event) => event.text)).toEqual([
      expect.stringMatching(/^Goblin enters Forbiddance and takes \d+ Necrotic damage/)
    ]);
    expect(savesOf(state, FOE)).toEqual([]);
    expect(hpOf(state, FOE)).toBeLessThan(200);
    // A Humanoid isn't one of the warded types.
    expect(zonesAfterMove(state, { moverId: FOE2, path: [cell(46, 12), cell(44, 12)] }, deps())).toEqual([]);
  });

  it("keeps creatures from teleporting into the area", () => {
    const { state } = warded();
    expect(teleportBarredAt(state, cell(20, 20), 1, deps())).toBe("Forbiddance");
    expect(teleportBarredAt(state, cell(50, 50), 1, deps())).toBeNull();
  });
});

describe("Antilife Shell", () => {
  const druid = druidAt(9, ["antilife-shell"]);

  function shelled() {
    const caster = fight(druid);
    place(caster.state, { [HERO]: cell(10, 10), [FOE]: cell(10, 16), [FOE2]: cell(16, 10) });
    become(caster.state, FOE, "goblin");
    become(caster.state, FOE2, "zombie");
    caster.resolve("spell-antilife-shell", { targetIds: [], commandId: CAST });
    return caster;
  }

  it("bars a creature other than a Construct or an Undead from passing into the Emanation", () => {
    const { state } = shelled();
    const walkIn = (actorId: string, from: readonly [number, number], to: readonly [number, number]) =>
      movementCost(state, GRID, actorId, cell(...from), cell(...to), {
        resolveDefinition,
        ...zoneMovementOptions(state, actorId, deps())
      });
    expect(walkIn(FOE, [10, 16], [10, 11])?.blocked).toBe(true);
    expect(walkIn(FOE2, [16, 10], [11, 10])?.blocked).toBeUndefined();
    // Walking past it, round the outside, is fine.
    expect(walkIn(FOE, [10, 16], [16, 16])?.blocked).toBeUndefined();
  });

  it("keeps a melee attack that isn't made with a Reach weapon from reaching through it", () => {
    // An ally just inside the shell's edge, and the goblin just outside it, 5 feet apart.
    const at: Readonly<Record<string, readonly [number, number]>> = {
      [HERO]: [10, 10],
      [ALLY]: [10, 12],
      [FOE]: [10, 13]
    };
    const apart = (a: string, b: string) =>
      Math.max(Math.abs(at[a]![0] - at[b]![0]), Math.abs(at[a]![1] - at[b]![1])) * 5;
    const swing = (reachFeet: number) => {
      const caster = fight(druid, { ally: true });
      become(caster.state, FOE, "goblin");
      caster.resolve("spell-antilife-shell", { targetIds: [], commandId: CAST });
      caster.state.combat.turnActorId = FOE;
      caster.state.combat.turn = { ...caster.state.combat.turn, actionUsed: false };
      const scimitar = DEFINITIONS.goblin!.actions.find((action) => action.id === "scimitar")!;
      return () =>
        resolveDefinitionAction(
          caster.state,
          { ...scimitar, attack: { ...scimitar.attack!, reachFeet } },
          { actorId: FOE, targetIds: [ALLY], commandId: `scimitar-${reachFeet}` },
          {
            random: (sides: number) => Math.min(sides, 10),
            newRollId: () => `70000000-0000-4000-8000-0000000000${reachFeet}`,
            gmSessionId: "30000000-0000-4000-8000-00000000000a",
            now: () => "2026-10-17T00:00:00.000Z",
            definition: DEFINITIONS.goblin,
            resolveDefinition,
            catalog,
            distanceFeet: apart
          }
        );
    };
    expect(swing(5)).toThrow("Goblin can't reach through Antilife Shell to Bran.");
    // A Reach weapon goes through.
    expect(swing(10)).not.toThrow();
  });

  it("ends when its caster's move forces the barrier through a creature it holds back", () => {
    const { state, hero } = shelled();
    moveTo(state, HERO, [10, 14]);
    const events = shellsForcedBy(state, HERO, [cell(10, 10), cell(10, 14)], deps());
    expect(events.map((event) => event.text)).toContain(
      "Antilife Shell ends: its barrier was forced through a creature."
    );
    expect(hero.effects.some((effect) => effect.concentration)).toBe(false);
  });
});

describe("Magic Circle", () => {
  it("bars a creature of a chosen type from walking into the Cylinder, and lets the others in", () => {
    const caster = fight(wizard, { combat: false });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(10, 16), [FOE2]: cell(12, 16) });
    become(caster.state, FOE, "imp");
    become(caster.state, FOE2, "guard");
    carry(caster.state, HERO, "Powdered silver and salt");
    caster.resolve("spell-magic-circle", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [10, 10], 2);
    const walkIn = (actorId: string, from: readonly [number, number]) =>
      movementCost(caster.state, GRID, actorId, cell(...from), cell(10, 10), {
        resolveDefinition,
        ...zoneMovementOptions(caster.state, actorId, deps())
      });
    expect(walkIn(FOE, [10, 16])?.blocked).toBe(true);
    expect(walkIn(FOE2, [12, 16])?.blocked).toBeUndefined();
  });
});
