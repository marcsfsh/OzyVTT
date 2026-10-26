import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { builtinActionFor } from "../src/builtin-actions.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { zonesAtTurnStart } from "../src/spell-zones.js";
import { moveZoneToward } from "../src/zone-sphere.js";
import { zonePointFeet } from "../src/zone-touch.js";
import { build, catalog, fight, FOE, FOE2, HERO, wizardInput } from "./spell-casters.js";
import { answer, cell, drawArea, GRID, nextId, place, savesOf, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Sphere of Annihilation: "If you are within 60 feet of a sphere, you can take a Magic action to make a DC 25
// Intelligence (Arcana) check. On a successful check, you control the sphere until the start of your next turn ... On a
// failed check, the sphere moves 10 feet toward you in a straight line. While in control of the sphere, you can take a
// Bonus Action to cause it to move ... up to a number of feet equal to 5 times your Intelligence modifier ... Any
// creature whose space the sphere enters must succeed on a DC 19 Dexterity saving throw or be touched by it, taking 8d10
// Force damage. A creature reduced to 0 Hit Points by this damage is obliterated". Talisman of the Sphere: "you have
// Advantage on any Intelligence (Arcana) check you make to control a Sphere of Annihilation. In addition, when you start
// your turn in control of a Sphere of Annihilation, you can take a Magic action to move it 10 feet plus a number of
// additional feet equal to 10 times your Intelligence modifier."

const SPHERE = "6f100000-0000-4000-8000-000000000001";
const GM_SESSION = "30000000-0000-4000-8000-00000000000a";
const definition = build(wizardInput(["magic-missile"]));
const actorOf = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!;
const sphereAt = (state: GameState) =>
  state.combat.annotations.find((annotation) => annotation.id === SPHERE)!.geometry.origin;

/** The wizard (Intelligence +4, Arcana +6) at (2,10) sets the sphere at (8,10); the goblin waits at (12,10). */
function sphere(talisman = false) {
  const caster = fight(definition);
  const hero = actorOf(caster.state, HERO);
  hero.inventory = [
    ...hero.inventory,
    { id: "sphere-of-annihilation", name: "Sphere of Annihilation", quantity: 1, equipped: false, attuned: false },
    ...(talisman
      ? [{ id: "talisman-of-the-sphere", name: "Talisman of the Sphere", quantity: 1, equipped: true, attuned: true }]
      : [])
  ];
  place(caster.state, { [HERO]: cell(2, 10), [FOE]: cell(12, 10), [FOE2]: cell(30, 30) });
  caster.resolve("item-sphere-of-annihilation-set", { targetIds: [], commandId: SPHERE, areaPlaced: true });
  drawArea(caster.state, SPHERE, [8, 10], 1, "square");
  return caster.state;
}

/** The wizard takes a generic action, with the map's measures and d20 faces. */
function take(state: GameState, actionId: string, targetIds: string[], faces: number[] = []) {
  return resolveDefinitionAction(
    state,
    builtinActionFor(definition, actionId)!,
    { actorId: HERO, targetIds, commandId: nextId(), builtin: true },
    {
      random: () => faces.shift() ?? 10,
      newRollId: nextId,
      gmSessionId: GM_SESSION,
      now: () => "2026-10-19T00:00:00.000Z",
      definition,
      catalog,
      resolveDefinition: () => undefined,
      zoneFeet: (actorId, zoneId) => zonePointFeet(state, actorId, zoneId, GRID),
      moveZone: (zoneId, towardActorId, feet) =>
        moveZoneToward(
          state,
          { zoneId, towardActorId, feet, actor: { sessionId: GM_SESSION, role: "gm" } },
          zoneDeps(Array(8).fill(8))
        )
    }
  );
}

describe("a Sphere of Annihilation", () => {
  it("is controlled with a DC 25 Intelligence (Arcana) check, and moved 20 feet into the goblin by an Int +4 wizard", () => {
    const state = sphere();
    const control = take(state, "control-sphere", [], [15]);
    expect(control.check).toMatchObject({ total: 25, dc: 25, success: true });
    expect(state.combat.spellZones[0]!.controllerId).toBe(HERO);
    expect(actorOf(state, HERO).effects.some((effect) => effect.tags.includes("sphere-control"))).toBe(true);
    take(state, "move-sphere", [FOE]);
    expect(sphereAt(state)).toEqual({ x: 600, y: 500 });
    expect(savesOf(state, FOE)).toEqual([expect.objectContaining({ ability: "dex", dc: 19, proposedDamage: 64 })]);
  });

  it("obliterates a goblin its damage drops to 0", () => {
    const state = sphere();
    actorOf(state, FOE).hp.current = 30;
    take(state, "control-sphere", [], [15]);
    take(state, "move-sphere", [FOE]);
    answer(state, FOE, 1);
    expect(actorOf(state, FOE).hp.current).toBe(0);
    expect(actorOf(state, FOE).death).toMatchObject({ bodyGone: true });
  });

  it("moves 10 feet toward a creature that fails the check", () => {
    const state = sphere();
    take(state, "control-sphere", [], [2]);
    expect(state.combat.spellZones[0]!.controllerId).toBeUndefined();
    expect(sphereAt(state)).toEqual({ x: 300, y: 500 });
  });

  it("refuses a move from a creature not in control, and a control check from more than 60 feet away", () => {
    const state = sphere();
    expect(() => take(state, "move-sphere", [FOE])).toThrow(/Move the Sphere requires/);
    place(state, { [HERO]: cell(30, 10) });
    expect(() => take(state, "control-sphere", [])).toThrow(/within 60 feet/);
  });

  it("gives a Talisman of the Sphere's holder Advantage, and a Magic action move of 50 feet for Int +4", () => {
    const state = sphere(true);
    const control = take(state, "control-sphere", [], [3, 15]);
    expect(control.check).toMatchObject({ total: 25, success: true });
    // Its next turn starts in control.
    nextInitiativeTurn(state);
    zonesAtTurnStart(state, FOE, zoneDeps());
    state.combat.turnActorId = HERO;
    zonesAtTurnStart(state, HERO, zoneDeps());
    expect(state.combat.spellZones[0]!).toMatchObject({ heldAtTurnStart: HERO });
    expect(state.combat.spellZones[0]!.controllerId).toBeUndefined();
    place(state, { [FOE]: cell(25, 10) });
    take(state, "move-sphere-far", [FOE]);
    expect(sphereAt(state)).toEqual({ x: 900, y: 500 });
  });
});
