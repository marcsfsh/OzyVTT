import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import type { InventoryItem } from "@vtt/schemas";
import { catalogRow } from "./equipment-table.js";
import { bootSummons, CASTER, summonTable } from "./summon-fixtures.js";

// The SRD 5.2.1 magic items that summon: each brings its creature onto the map, on its user's side unless the item
// says otherwise, for the item's time.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** The summoning table with the Wizard carrying these items, equipped and attuned. */
/** The caster carrying these items; "id#kind" is a copy the GM says is that kind (an Elemental Gem's red corundum). */
async function carrying(...ids: string[]) {
  const state = summonTable();
  const caster = state.actors.find((actor) => actor.id === CASTER)!;
  caster.inventory = [
    ...caster.inventory,
    ...ids.map((entry): InventoryItem => {
      const [id, variantId] = entry.split("#") as [string, string | undefined];
      return catalogRow(id, { attuned: true, equipped: true, ...(variantId ? { variantId } : {}) });
    })
  ];
  return bootSummons(cleanups, state);
}

const pathFor = (path: string, actorId: string) => path.replace("{actorId}", actorId);

describe("Bowl of Commanding Water Elementals and its kin", () => {
  it("brings a Water Elemental that acts right after its user for an hour and leaves when dismissed", async () => {
    const table = await carrying("bowl-of-commanding-water-elementals");
    const used = await table.resolve({ actionId: "item-bowl-of-commanding-water-elementals-summon" });
    expect(used.status, await used.clone().text()).toBe(200);
    const [elemental] = table.named("Water Elemental");
    expect(elemental!.control).toMatchObject({ by: CASTER, side: "party" });
    expect(table.snapshot().combat.initiative.find((entry) => entry.actorId === elemental!.id)!.follows).toBe(CASTER);
    const kept = elemental!.effects.find((effect) => effect.id === elemental!.summon!.keptBy)!;
    expect(kept.duration).toEqual({ type: "minutes", remaining: 60 });
    const dismissed = await table.post(pathFor(GAME_PATHS.summonDismiss, elemental!.id), table.gmToken, {
      actorId: elemental!.id
    });
    expect(dismissed.status, await dismissed.clone().text()).toBe(200);
    expect(table.snapshot().combat.turn.bonusActionUsed).toBe(true);
    expect(table.named("Water Elemental")).toEqual([]);
  });

  it("an Elemental Gem is used up as its elemental comes", async () => {
    const table = await carrying("elemental-gem#red-corundum");
    const used = await table.resolve({ actionId: "item-elemental-gem-break-red-corundum" });
    expect(used.status, await used.clone().text()).toBe(200);
    expect(table.named("Fire Elemental")).toHaveLength(1);
    expect(table.actor(CASTER)!.inventory.some((row) => row.id === "elemental-gem")).toBe(false);
  });
});

describe("Bag of Tricks", () => {
  it("rolls the d8 on the bag's table for a creature that stays until its user's Long Rest", async () => {
    const table = await carrying("bag-of-tricks#gray");
    const used = await table.resolve({ actionId: "item-bag-of-tricks-pull-gray" });
    expect(used.status, await used.clone().text()).toBe(200);
    const gray = ["Weasel", "Giant Rat", "Badger", "Boar", "Panther", "Giant Badger", "Dire Wolf", "Giant Elk"];
    const pulled = table.snapshot().actors.filter((actor) => actor.summon?.by === CASTER);
    expect(pulled).toHaveLength(1);
    expect(gray.some((name) => pulled[0]!.name.startsWith(name))).toBe(true);
    expect(pulled[0]!.control).toMatchObject({ by: CASTER, commandedWith: "bonus-action" });
    expect(table.actor(CASTER)!.effects.find((effect) => effect.id === pulled[0]!.summon!.keptBy)!.duration).toEqual({
      type: "until-rest",
      rest: "long"
    });
  });
});

describe("Horn of Valhalla", () => {
  it("the silver horn's two Berserkers obey its user", async () => {
    const table = await carrying("horn-of-valhalla#silver");
    const silver = await table.resolve({ actionId: "item-horn-of-valhalla-blow-silver" });
    expect(silver.status, await silver.clone().text()).toBe(200);
    const friendly = table.named("Berserker");
    expect(friendly).toHaveLength(2);
    expect(friendly.every((berserker) => berserker.control?.by === CASTER)).toBe(true);
    // "They have Immunity to the Charmed and Frightened conditions."
    expect(friendly[0]!.conditionImmunities).toEqual(expect.arrayContaining(["charmed", "frightened"]));
  });

  it("the iron horn's five Berserkers attack a user without Martial weapons", async () => {
    const table = await carrying("horn-of-valhalla#iron");
    const iron = await table.resolve({ actionId: "item-horn-of-valhalla-blow-iron" });
    expect(iron.status, await iron.clone().text()).toBe(200);
    const hostile = table.named("Berserker").filter((berserker) => berserker.control === undefined);
    expect(hostile).toHaveLength(5);
  });
});

describe("Ring of Djinni Summoning", () => {
  it("keeps its Djinni while its wearer keeps Concentration", async () => {
    const table = await carrying("ring-of-djinni-summoning");
    const used = await table.resolve({ actionId: "item-ring-of-djinni-summoning-summon-djinni" });
    expect(used.status, await used.clone().text()).toBe(200);
    expect(table.named("Djinni")).toHaveLength(1);
    const holding = table.actor(CASTER)!.effects.find((effect) => effect.concentration)!;
    expect(holding.name).toBe("Concentrating on Summon the Djinni");
    await table.post(pathFor(GAME_PATHS.effectEnd, CASTER).replace("{effectId}", holding.id), table.gmToken, {
      actorId: CASTER,
      effectId: holding.id
    });
    expect(table.named("Djinni")).toEqual([]);
  });
});

describe("Efreeti Bottle, Figurines and the Staff of the Python", () => {
  it("the Efreeti obeys for an hour, or attacks its user and leaves after 5 rounds", async () => {
    const table = await carrying("efreeti-bottle");
    const used = await table.resolve({ actionId: "item-efreeti-bottle-open" });
    expect(used.status, await used.clone().text()).toBe(200);
    const [efreeti] = table.named("Efreeti");
    const kept = efreeti!.effects.find((effect) => effect.id === efreeti!.summon!.keptBy)!;
    if (efreeti!.control) expect(kept.duration).toEqual({ type: "minutes", remaining: 60 });
    else expect(kept.duration).toEqual({ type: "rounds", remaining: 5 });
  });

  it("an Ivory Goat becomes the goat picked, for 3 hours", async () => {
    const table = await carrying("figurine-of-wondrous-power#ivory-goats");
    const used = await table.resolve({
      actionId: "item-figurine-of-wondrous-power-ivory-goats",
      summon: { picks: [{ monsterId: "giant-goat", form: "travail" }] }
    });
    expect(used.status, await used.clone().text()).toBe(200);
    const [goat] = table.named("Goat of Travail");
    expect(goat!.control).toMatchObject({ by: CASTER, dodgesUncommanded: true });
    expect(goat!.effects.find((effect) => effect.id === goat!.summon!.keptBy)!.duration).toEqual({
      type: "minutes",
      remaining: 180
    });
  });

  it("a Staff of Swarming Insects' Giant Insect costs 4 charges and brings the insect", async () => {
    const table = await carrying("staff-of-swarming-insects");
    const used = await table.resolve({
      actionId: "item-staff-of-swarming-insects-cast-giant-insect",
      summon: { picks: [{ monsterId: "giant-insect", form: "spider" }] }
    });
    expect(used.status, await used.clone().text()).toBe(200);
    expect(table.named("Giant Insect (Spider)")).toHaveLength(1);
    expect(table.actor(CASTER)!.actionUses["staff-of-swarming-insects-charges"]).toBe(4);
  });

  it("the staff becomes a Giant Constrictor Snake within 10 feet that a Bonus Action turns back", async () => {
    const table = await carrying("staff-of-the-python");
    const used = await table.resolve({ actionId: "item-staff-of-the-python-snake" });
    expect(used.status, await used.clone().text()).toBe(200);
    const [snake] = table.named("Giant Constrictor Snake");
    expect(snake!.control).toMatchObject({ by: CASTER, commandFeet: 60 });
    expect(snake!.summon?.dismiss).toBe("bonus-action");
  });
});
