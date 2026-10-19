import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { InventoryItem } from "@vtt/schemas";
import { areaAtLevel } from "../src/spell-zone-state.js";
import { zonesAfterMove } from "../src/spell-zones.js";
import { spellWardedTargets } from "../src/zone-barriers.js";
import { ALLY, build, druidInput, fight, FOE, FOE2, HERO, view, wizardInput } from "./spell-casters.js";
import { cell, drawArea, place, savesOf, wizardAt, zoneDeps } from "./zone-fixtures.js";

// SRD 5.2.1 area shapes: an area that grows with the slot (Fog Cloud, Confusion, Create or Destroy Water), an
// Emanation that stays where its caster stood (Globe of Invulnerability) and keeps lower spells cast from outside off
// whatever is in it, Call Lightning's first bolt, and an item's own area for the spell it casts (Cloak of Arachnida's
// Web, twice its area, whose wearer the webs can't hold).

const CAST = "66000000-0000-4000-8000-000000000001";
const spell = (id: string) => view.spellRecord(id)!;
const moveTo = (state: GameState, actorId: string, at: readonly [number, number]) => {
  state.combat.tokens = state.combat.tokens.map((token) =>
    token.actorId === actorId ? { ...token, position: cell(...at) } : token
  );
};

describe("an area that grows with the slot", () => {
  it("adds the spell's feet for each slot level above its own", () => {
    expect(areaAtLevel(spell("fog-cloud").area!, spell("fog-cloud"), 3)).toEqual({
      shape: "sphere",
      sizeFeet: 60,
      widthFeet: null
    });
    expect(areaAtLevel(spell("confusion").area!, spell("confusion"), 6).sizeFeet).toBe(20);
    expect(areaAtLevel(spell("create-or-destroy-water").area!, spell("create-or-destroy-water"), 2).sizeFeet).toBe(35);
    expect(areaAtLevel(spell("fireball").area!, spell("fireball"), 5).sizeFeet).toBe(20);
  });

  it("gives Call Lightning's first bolt its 5-foot Sphere", () => {
    const druid = build(druidInput(["call-lightning"]));
    expect(druid.actions.find((action) => action.id === "spell-call-lightning")?.area).toEqual({
      shape: "sphere",
      sizeFeet: 5,
      widthFeet: null
    });
  });
});

describe("Globe of Invulnerability", () => {
  function globe(slotLevel?: number) {
    const caster = fight(wizardAt(13, ["globe-of-invulnerability"]), { ally: true });
    place(caster.state, { [HERO]: cell(10, 10), [ALLY]: cell(11, 10), [FOE]: cell(20, 10), [FOE2]: cell(40, 40) });
    caster.resolve("spell-globe-of-invulnerability", {
      targetIds: [],
      commandId: CAST,
      ...(slotLevel ? { slotLevel } : {})
    });
    return caster;
  }
  const warded = (state: GameState, casterId: string, castLevel: number) =>
    spellWardedTargets(state, { casterId, castLevel, targetIds: [HERO, ALLY, FOE] }, zoneDeps()).map(
      (entry) => entry.actorId
    );

  it("stays where its caster stood", () => {
    const { state } = globe();
    expect(state.combat.spellZones[0]?.anchor).toEqual(cell(10, 10));
    moveTo(state, HERO, [30, 30]);
    // The ally still stands in the barrier the caster left behind.
    expect(warded(state, FOE, 3)).toEqual([ALLY]);
  });

  it("keeps a spell of level 5 or lower cast from outside off the creatures within", () => {
    const { state } = globe();
    expect(warded(state, FOE, 5)).toEqual([HERO, ALLY]);
    expect(warded(state, FOE, 6)).toEqual([]);
    // Cast from inside, the barrier is no barrier.
    expect(warded(state, ALLY, 1)).toEqual([]);
  });

  it("blocks one level higher for each slot level above 6", () => {
    const { state } = globe(7);
    expect(warded(state, FOE, 6)).toEqual([HERO, ALLY]);
  });
});

describe("Cloak of Arachnida", () => {
  const cloak = (): InventoryItem => ({
    id: "cloak-of-arachnida",
    name: "Cloak of Arachnida",
    quantity: 1,
    equipped: true,
    attuned: true
  });

  it("casts Web at save DC 13 in a 40-foot Cube, once a dawn", () => {
    const caster = fight(build(wizardInput(["magic-missile"])));
    caster.hero.inventory = [...caster.hero.inventory, cloak()];
    const web = caster.action("item-cloak-of-arachnida-cast-web");
    expect(web).toMatchObject({
      area: { shape: "cube", sizeFeet: 40 },
      uses: { limit: 1, per: "long-rest" }
    });
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(30, 30), [FOE2]: cell(40, 40) });
    caster.resolve(web.id, { targetIds: [], commandId: CAST, areaPlaced: true });
    expect(caster.state.combat.spellZones[0]).toMatchObject({
      spellId: "web",
      dc: 13,
      area: { shape: "cube", sizeFeet: 40 }
    });
  });

  it("keeps its wearer from being caught in webs", () => {
    const caster = fight(build(wizardInput(["web", "magic-missile"])));
    place(caster.state, { [HERO]: cell(0, 0), [FOE]: cell(3, 6), [FOE2]: cell(3, 7) });
    const goblin = caster.state.actors.find((actor) => actor.id === FOE)!;
    goblin.inventory = [...goblin.inventory, cloak()];
    caster.resolve("spell-web", { targetIds: [], commandId: CAST, areaPlaced: true });
    drawArea(caster.state, CAST, [5, 5], 4, "square");
    moveTo(caster.state, FOE, [6, 6]);
    expect(zonesAfterMove(caster.state, { moverId: FOE, path: [cell(3, 6), cell(6, 6)] }, zoneDeps())).toEqual([]);
    moveTo(caster.state, FOE2, [6, 7]);
    zonesAfterMove(caster.state, { moverId: FOE2, path: [cell(3, 7), cell(6, 7)] }, zoneDeps());
    expect(savesOf(caster.state, FOE2)).toHaveLength(1);
  });
});
