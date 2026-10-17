import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { checkRollMode } from "../src/ability-checks.js";
import { ContentLibrary } from "../src/content-library.js";
import { deriveEquipment, equipmentCatalogOf } from "../src/equipment-derivation.js";
import { currentSpeedFeet } from "../src/speed.js";

// SRD Armor: Chain Mail gives Disadvantage on Dexterity (Stealth) checks and asks for Strength 13. The drawbacks are the
// catalog's, so they hold for every row shape: one carrying the armor block, and one that names the item only.

const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));
const definition = (str: number) =>
  ({
    name: "Borin",
    armorClass: 18,
    proficiencyBonus: 3,
    abilityScores: { str, dex: 10, con: 14, int: 10, wis: 12, cha: 10 },
    hitPoints: { maximum: 50 },
    actions: [],
    extensions: {},
    proficiencies: { saves: [], skills: [], armor: ["light", "medium", "heavy", "shields"] }
  }) as unknown as ActorDefinition;

const wearing = (row: Record<string, unknown>) =>
  GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: "10000000-0000-4000-8000-000000000001",
        name: "Borin",
        kind: "player-character",
        visibility: "public",
        hp: { current: 50, maximum: 50 },
        speedFeet: 30,
        inventory: [InventoryItemSchema.parse({ quantity: 1, equipped: true, attuned: false, ...row })]
      }
    ]
  }).actors[0]!;

const BARE = { id: "chain-mail", name: "Chain Mail" };
const BLOCKED = {
  id: "chain-mail",
  name: "Chain Mail",
  category: "armor",
  armor: { acBase: 16, addDexModifier: false, dexModifierCap: null, stealthDisadvantage: true, strengthRequired: 13 }
};

describe("Chain Mail's drawbacks", () => {
  for (const [shape, row] of [
    ["a row that names the item only", BARE],
    ["a row carrying the armor block", BLOCKED]
  ] as const)
    it(`gives Disadvantage on Dexterity (Stealth) checks, from ${shape}`, () => {
      const borin = wearing(row);
      const derivation = deriveEquipment(borin, definition(16), catalog);
      expect(checkRollMode(derivation, { ability: "dex", skill: "stealth" }).mode).toBe("disadvantage");
      expect(checkRollMode(derivation, { ability: "dex", skill: "acrobatics" }).mode).toBe("normal");
    });

  it("costs 10 feet of Speed below Strength 13, from a row that names the item only", () => {
    const borin = wearing(BARE);
    expect(currentSpeedFeet(borin, deriveEquipment(borin, definition(12), catalog))).toBe(20);
    expect(currentSpeedFeet(borin, deriveEquipment(borin, definition(13), catalog))).toBe(30);
  });
});
