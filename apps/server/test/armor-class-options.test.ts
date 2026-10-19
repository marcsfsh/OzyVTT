import { describe, expect, it } from "vitest";
import { armorClassInPlay } from "@vtt/domain";
import { InventoryItemSchema } from "@vtt/schemas";
import { setInventoryItem } from "../src/inventory.js";
import { ALLY, catalog, HERO, heroTurnAgain } from "./spell-casters.js";
import { actorOf, cast, caster, wizard } from "./spell-lifetimes-kit.js";

// SRD 5.2.1 Mage Armor: "the target's base AC becomes 13 plus its Dexterity modifier", a way to work out AC that a
// Shield and other bonuses add to; Barkskin: "the target has an Armor Class of 17 if its AC is lower than that", a floor
// that bonuses don't stack on.

const item = (fields: Record<string, unknown>) =>
  InventoryItemSchema.parse({ quantity: 1, equipped: true, attuned: false, ...fields });

describe("Mage Armor is a base AC the effect turns on", () => {
  it("keeps a Ring of Protection's +1 on top: Dex 14 with the ring is AC 16, and 18 with Bracers of Defense too", () => {
    const table = caster();
    const resolveDefinition = () => wizard;
    setInventoryItem(
      table.state,
      HERO,
      item({ id: "ring-of-protection", name: "Ring of Protection", attuned: true }),
      resolveDefinition,
      { catalog, role: "gm" }
    );
    const hero = actorOf(table.state, HERO);
    expect(armorClassInPlay(hero)).toBe(13);
    cast(table, "mage-armor", { targetIds: [HERO] });
    expect(armorClassInPlay(hero)).toBe(16);
    setInventoryItem(
      table.state,
      HERO,
      item({ id: "bracers-of-defense", name: "Bracers of Defense", attuned: true }),
      resolveDefinition,
      { catalog, role: "gm" }
    );
    expect(armorClassInPlay(hero)).toBe(18);
  });

  it("adds nothing for a creature whose own AC is better", () => {
    const table = caster();
    const ally = actorOf(table.state, ALLY);
    ally.armorClass = 18;
    cast(table, "mage-armor", { targetIds: [ALLY] });
    // A stat block's printed 18 beats 13 + its Dexterity modifier.
    expect(armorClassInPlay(ally)).toBe(18);
  });
});

describe("Barkskin is a floor", () => {
  it("makes AC 12 into 17, and Shield of Faith's +2 doesn't stack on the floor", () => {
    const table = caster();
    cast(table, "barkskin", { targetIds: [ALLY] });
    const ally = actorOf(table.state, ALLY);
    ally.armorClass = 12;
    expect(armorClassInPlay(ally)).toBe(17);
    heroTurnAgain(table.state);
    cast(table, "shield-of-faith", { targetIds: [ALLY] });
    expect(armorClassInPlay(ally)).toBe(17);
    // An AC that rises past the floor counts in full.
    ally.armorClass = 16;
    expect(armorClassInPlay(ally)).toBe(18);
  });
});
