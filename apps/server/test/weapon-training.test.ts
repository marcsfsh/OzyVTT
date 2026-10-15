import { describe, expect, it } from "vitest";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { weaponAction } from "../src/item-actions.js";

/** Dex 16 (+3), Str 10, proficiency +2: a proficient finesse swing is +5, an unproficient one +3. */
const definitionWith = (weapons: readonly string[]) =>
  ({
    name: "Pip",
    armorClass: 14,
    proficiencyBonus: 2,
    abilityScores: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
    hitPoints: { maximum: 20 },
    actions: [],
    extensions: {},
    proficiencies: { saves: [], skills: [], weapons: [...weapons], armor: [], tools: [] }
  }) as unknown as ActorDefinition;

const weapon = (id: string, category: "simple" | "martial", properties: string[]) =>
  InventoryItemSchema.parse({
    id,
    name: id,
    equipped: true,
    category: "weapon",
    weapon: { category, damageDice: "1d6", damageType: "piercing", rangeFeet: null, longRangeFeet: null, properties }
  });

const RAPIER = weapon("rapier", "martial", ["finesse"]);
const SHORTSWORD = weapon("shortsword", "martial", ["finesse", "light"]);
const SCIMITAR = weapon("scimitar", "martial", ["finesse", "light"]);
const LONGSWORD = weapon("longsword", "martial", ["versatile"]);
const bonusOf = (item: ReturnType<typeof weapon>, trained: readonly string[], granted: readonly string[] = []) =>
  weaponAction(item, definitionWith(trained), granted)!.attack!.bonus;

describe("qualified Martial weapon training", () => {
  it("makes a Rogue proficient with finesse or light Martial weapons, and with nothing else Martial", () => {
    const rogue = ["simple", "martial-finesse-or-light"];
    expect(bonusOf(RAPIER, rogue)).toBe(5);
    expect(bonusOf(SCIMITAR, rogue)).toBe(5);
    // A longsword is neither: Dex does not apply either, so it is Str +0 with no proficiency.
    expect(bonusOf(LONGSWORD, rogue)).toBe(0);
  });

  it("makes a Monk proficient with light Martial weapons only", () => {
    const monk = ["simple", "martial-light"];
    expect(bonusOf(SHORTSWORD, monk)).toBe(5);
    expect(bonusOf(RAPIER, monk)).toBe(3);
  });

  it("reads an authored grant's 'martial-weapons' as the whole category", () => {
    expect(bonusOf(LONGSWORD, ["simple"], ["martial-weapons"])).toBe(2);
    expect(bonusOf(LONGSWORD, ["simple"])).toBe(0);
  });
});
