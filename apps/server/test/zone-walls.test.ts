import { describe, expect, it } from "vitest";
import type { Actor, GameState, SpellZone } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import type { ResolveDependencies } from "../src/resolution/context.js";
import { barredStepFor } from "../src/zone-barriers.js";
import { deflectingWall, launchesProjectile, zoneCover } from "../src/zone-walls.js";
import { ALLY, build, catalog, fight, fighterInput, FOE, HERO } from "./spell-casters.js";
import { cell, drawArea, place, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 Blade Barrier: "The wall provides Three-Quarters Cover". Wind Wall: "Arrows, bolts, and other ordinary
// projectiles launched at targets behind the wall are deflected upward and miss automatically. Boulders hurled by
// Giants or siege engines, and similar projectiles, are unaffected"; "Small or smaller flying creatures or objects
// can't pass through the wall."

const CAST = "60000000-0000-4000-8000-000000000001";

/** A wall spell standing in column 5, rows 0 to 10, cast by the hero. */
function raise(state: GameState, spellId: "blade-barrier" | "wind-wall"): void {
  const blade = spellId === "blade-barrier";
  const zone: SpellZone = {
    id: CAST,
    spellId,
    name: blade ? "Blade Barrier" : "Wind Wall",
    laterActionId: blade ? "spell-blade-barrier-then-save" : "spell-wind-wall-then-wall",
    casterId: HERO,
    castId: null,
    rounds: null,
    startedRound: 1,
    level: blade ? 6 : 3,
    dc: 15,
    annotationId: CAST,
    area: { shape: "line", sizeFeet: blade ? 100 : 50, widthFeet: 5 },
    damageDealt: 0,
    entered: [],
    affected: []
  };
  state.combat.spellZones = [zone];
  drawArea(state, CAST, [5, 0], 10, "line");
}

const fighter = build(fighterInput());

/** The fighter's thrown Javelin, a ranged weapon attack. */
function javelin(hero: Actor): ActorAction {
  const found = effectiveActions(fighter, hero, catalog).find(
    (entry) => /javelin/i.test(entry.name) && entry.attack?.rangeFeet !== undefined
  );
  if (!found)
    throw new Error(
      effectiveActions(fighter, hero, catalog)
        .map((entry) => `${entry.id} ${entry.name} ${entry.attack?.rangeFeet}`)
        .join("; ")
    );
  return found;
}

function attack(state: GameState, action: ActorAction, extra: Partial<ResolveDependencies>, face: number) {
  let rolls = 0;
  return resolveDefinitionAction(
    state,
    action,
    { actorId: HERO, targetIds: [FOE], commandId: `cmd-wall-${face}` },
    {
      random: (sides) => Math.min(face, sides),
      newRollId: () => `40000000-0000-4000-8000-${String((rolls += 1)).padStart(12, "0")}`,
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-19T00:00:00.000Z",
      definition: fighter,
      catalog,
      resolveDefinition: () => undefined,
      ...extra
    }
  );
}

const walls = (state: GameState): Partial<ResolveDependencies> => ({
  zoneCover: (from, to) => zoneCover(state, from, to, zoneDeps()),
  deflectedBy: (from, to) => deflectingWall(state, from, to, zoneDeps())
});

describe("Blade Barrier", () => {
  it("gives Three-Quarters Cover to a creature on its far side, and none on the near side", () => {
    const { state } = fight(fighter);
    raise(state, "blade-barrier");
    place(state, { [HERO]: cell(2, 5), [FOE]: cell(8, 5) });
    expect(zoneCover(state, HERO, FOE, zoneDeps())).toBe("three-quarters");
    place(state, { [FOE]: cell(2, 8) });
    expect(zoneCover(state, HERO, FOE, zoneDeps())).toBeNull();
  });

  it("adds +5 to the target's AC against an attack across it", () => {
    const { state, hero } = fight(fighter);
    raise(state, "blade-barrier");
    place(state, { [HERO]: cell(2, 5), [FOE]: cell(8, 5) });
    const resolution = attack(state, javelin(hero), walls(state), 10);
    expect(resolution.attack?.coverBonus).toBe(5);
    expect(resolution.attack?.targetAc).toBe(17);
  });
});

describe("Wind Wall", () => {
  it("turns a thrown javelin across it into a miss, whatever the roll", () => {
    const { state, hero } = fight(fighter);
    raise(state, "wind-wall");
    place(state, { [HERO]: cell(2, 5), [FOE]: cell(8, 5) });
    const resolution = attack(state, javelin(hero), walls(state), 15);
    expect(resolution.attack?.outcome).toBe("miss");
    expect(resolution.warnings).toContain("Wind Wall deflects the shot, and it misses Goblin.");
  });

  it("lets the same javelin hit a creature on the thrower's side of the wall", () => {
    const { state, hero } = fight(fighter);
    raise(state, "wind-wall");
    place(state, { [HERO]: cell(2, 5), [FOE]: cell(2, 8) });
    const resolution = attack(state, javelin(hero), walls(state), 15);
    expect(resolution.attack?.outcome).toBe("hit");
  });

  it("deflects arrows and thrown weapons, not a giant's Rock, a melee swing or a spell's attack", () => {
    const ranged = { bonus: 5, rangeFeet: 120 };
    const none = { inventory: [] };
    expect(launchesProjectile({ name: "Shortbow", attack: ranged }, none, null)).toBe(true);
    expect(launchesProjectile({ name: "Rock", attack: ranged }, none, null)).toBe(false);
    expect(launchesProjectile({ name: "Scimitar", attack: { bonus: 5, reachFeet: 5 } }, none, null)).toBe(false);
    expect(launchesProjectile({ name: "Fire Bolt", attack: ranged, spellId: "fire-bolt" }, none, null)).toBe(false);
  });

  it("bars a Small flying creature from crossing, and lets a Medium flyer or a Small walker through", () => {
    const { state } = fight(fighter);
    raise(state, "wind-wall");
    place(state, { [HERO]: cell(0, 0), [FOE]: cell(4, 5) });
    const goblin = state.actors.find((actor) => actor.id === FOE)!;
    const fly = (airborne: boolean) =>
      (state.combat.tokens = state.combat.tokens.map((token) =>
        token.actorId === FOE ? { ...token, airborne: airborne ? ("fly" as const) : undefined } : token
      ));
    const crosses = () => barredStepFor(state, FOE, zoneDeps())?.(cell(4, 5), cell(5, 5), 1) === true;
    goblin.size = "small";
    fly(true);
    expect(crosses()).toBe(true);
    fly(false);
    expect(crosses()).toBe(false);
    goblin.size = "medium";
    fly(true);
    expect(crosses()).toBe(false);
  });
});

describe("Tiny Hut", () => {
  it("lets the creatures inside at the cast through its dome and bars everyone else", () => {
    const definition = wizardAt(5, ["tiny-hut"]);
    const caster = fight(definition, { combat: false, ally: true });
    place(caster.state, { [HERO]: cell(5, 5), [ALLY]: cell(6, 5), [FOE]: cell(12, 5) });
    const inside = new Set([HERO, ALLY]);
    let rolls = 0;
    resolveDefinitionAction(
      caster.state,
      caster.action("spell-tiny-hut"),
      { actorId: HERO, targetIds: [], commandId: "70000000-0000-4000-8000-000000000001" },
      {
        random: () => 3,
        newRollId: () => `40000000-0000-4000-8000-${String((rolls += 1)).padStart(12, "0")}`,
        gmSessionId: "30000000-0000-4000-8000-00000000000a",
        now: () => "2026-10-19T00:00:00.000Z",
        definition,
        catalog,
        resolveDefinition: () => undefined,
        distanceFeet: (_from, to) => (inside.has(to) ? 5 : 30)
      }
    );
    const hut = caster.state.combat.spellZones.find((zone) => zone.spellId === "tiny-hut");
    expect(hut?.insiders).toEqual([HERO, ALLY]);
    expect(hut?.anchor).toEqual(cell(5, 5));
    // The dome reaches 10 feet from the caster's space: column 7 is inside, column 8 is out.
    expect(barredStepFor(caster.state, FOE, zoneDeps())?.(cell(8, 5), cell(7, 5), 1)).toBe(true);
    expect(barredStepFor(caster.state, ALLY, zoneDeps())?.(cell(7, 5), cell(8, 5), 1) ?? false).toBe(false);
  });
});
