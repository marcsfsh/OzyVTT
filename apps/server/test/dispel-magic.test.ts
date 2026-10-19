import { describe, expect, it } from "vitest";
import { InventoryItemSchema } from "@vtt/schemas";
import { setInventoryItem } from "../src/inventory.js";
import { ALLY, catalog, FOE, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, answer, cast, caster, effectNames } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Dispel Magic: "Any ongoing spell of level 3 or lower on the target ends. For each ongoing spell of level 4
// or higher on the target, make an ability check using your spellcasting ability (DC 10 plus that spell's level). On a
// successful check, the spell ends." With a higher slot: "You automatically end a spell on the target if the spell's
// level is equal to or less than the level of the spell slot you use." Remove Curse: "all curses affecting one creature
// or object end", and a cursed item's Attunement breaks.

const concentrating = (state: Parameters<typeof actorOf>[0]) =>
  actorOf(state, HERO)
    .effects.filter((effect) => effect.tags.includes("concentrating"))
    .map((effect) => effect.name);

describe("Dispel Magic", () => {
  it("ends a level 1 Bless on its target outright, and the caster's Concentration with it", () => {
    const table = caster();
    cast(table, "bless", { targetIds: [ALLY] });
    expect(actorOf(table.state, ALLY).effects[0]?.spell).toEqual({ id: "bless", level: 1 });
    heroTurnAgain(table.state);
    const dispel = cast(table, "dispel-magic", { targetIds: [ALLY] });
    expect(effectNames(table.state, ALLY)).toEqual([]);
    expect(concentrating(table.state)).toEqual([]);
    expect(dispel.effectsEnded).toEqual([expect.objectContaining({ actorId: ALLY, name: "Bless" })]);
  });

  it("rolls the caster's spellcasting check against DC 10 plus the level for a level 4 Hold Person", () => {
    const table = caster();
    cast(table, "hold-person", { targetIds: [FOE], slotLevel: 4 });
    answer(table.state, FOE, 2);
    heroTurnAgain(table.state);
    // Intelligence 19: +4. A 9 makes 13, short of DC 14.
    const held = cast(table, "dispel-magic", { targetIds: [FOE] }, [9]);
    expect(held.tableNarration?.map((line) => line.text)).toContain(
      "Ansel's Intelligence check against Hold Person (DC 14): 13. Hold Person holds."
    );
    expect(actorOf(table.state, FOE).conditions.map((condition) => condition.id)).toEqual(["paralyzed"]);
    heroTurnAgain(table.state);
    cast(table, "dispel-magic", { targetIds: [FOE] }, [10]);
    expect(actorOf(table.state, FOE).conditions).toEqual([]);
    expect(concentrating(table.state)).toEqual([]);
  });

  it("ends a level 4 spell with no check when cast from a level 4 slot", () => {
    const table = caster();
    cast(table, "hold-person", { targetIds: [FOE], slotLevel: 4 });
    answer(table.state, FOE, 2);
    heroTurnAgain(table.state);
    const rolls = table.state.rolls.length;
    cast(table, "dispel-magic", { targetIds: [FOE], slotLevel: 4 });
    expect(actorOf(table.state, FOE).conditions).toEqual([]);
    expect(table.state.rolls.length).toBe(rolls);
  });

  it("ends a spell area the GM aims it at, and the Concentration holding it", () => {
    const table = caster();
    cast(table, "spirit-guardians", { targetIds: [] });
    const zone = table.state.combat.spellZones[0]!;
    heroTurnAgain(table.state);
    cast(table, "dispel-magic", { targetIds: [], zoneId: zone.id });
    expect(table.state.combat.spellZones).toEqual([]);
    expect(concentrating(table.state)).toEqual([]);
  });
});

describe("Remove Curse", () => {
  it("ends Hex on the cursed creature", () => {
    const table = caster();
    cast(table, "hex", { ability: "wis" });
    expect(effectNames(table.state, FOE)).toEqual(["Hex (Wisdom)"]);
    heroTurnAgain(table.state);
    cast(table, "remove-curse", { targetIds: [FOE] });
    expect(effectNames(table.state, FOE)).toEqual([]);
  });

  it("breaks a cursed item's Attunement, so it can come off, and leaves its curse on the item", () => {
    const table = caster();
    const resolveDefinition = () => undefined;
    setInventoryItem(
      table.state,
      ALLY,
      InventoryItemSchema.parse({
        id: "berserker-axe",
        name: "Berserker Axe",
        quantity: 1,
        equipped: true,
        attuned: true
      }),
      resolveDefinition,
      { catalog, role: "gm" }
    );
    const removed = cast(table, "remove-curse", { targetIds: [ALLY] });
    expect(actorOf(table.state, ALLY).inventory[0]).toMatchObject({ id: "berserker-axe", attuned: false });
    expect(removed.tableNarration?.map((line) => line.text)).toContain(
      "Bran is no longer attuned to Berserker Axe. Its curse stays on the item, which can now be removed."
    );
    // Unattuned, the player may now take it off.
    setInventoryItem(
      table.state,
      ALLY,
      InventoryItemSchema.parse({ id: "berserker-axe", name: "Berserker Axe", quantity: 1, equipped: false }),
      resolveDefinition,
      { catalog, role: "player" }
    );
    expect(actorOf(table.state, ALLY).inventory[0]).toMatchObject({ equipped: false });
  });
});
