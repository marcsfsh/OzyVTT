import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { loadEquipment } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, type EquipmentCatalog } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
import { startEncounter } from "../src/encounter.js";
import { CommandRejectedError } from "../src/game-store.js";

/**
 * C9's SERVER-SIDE BIND, driven from the SHIPPED bundle - never a fixture record.
 *
 * A fixture cannot prove this mechanism: supplying the weapon block is precisely the thing the bind
 * builds, so every catalog record here comes from `loadEquipment()` over the committed bundles, and
 * every row is written through the real `setInventoryItem` path. The far end is the spec's own: ONE
 * shipped template row, TWO picked bases, TWO different derived-and-rolled numbers.
 *
 * The rows chosen stay rider-free by design (`sword-of-sharpness`, `sun-blade` - their printed
 * powers await other units), so these numbers hold still while the +N rows gain their riders.
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

const RECORDS = loadEquipment();
const CATALOG: EquipmentCatalog = {
  equipmentRecord: (id) => RECORDS.find((record) => record.id === id),
  featRecord: () => undefined
};

/** STR 12 (+1) / DEX 15 (+2), one point apart on purpose: max(str, dex) would swallow a wide gap. */
function definitionOf(over: Record<string, unknown> = {}): ActorDefinition {
  return {
    name: "Hero", armorClass: 12, proficiencyBonus: 2,
    abilityScores: { str: 12, dex: 15, con: 12, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [], extensions: {},
    character: { classes: [{ id: "fighter", name: "Fighter", level: 3 }], feats: [] },
    proficiencies: { saves: [], skills: [] },
    ...over
  } as unknown as ActorDefinition;
}

const row = (over: Record<string, unknown>): InventoryItem => InventoryItemSchema.parse(over);

function stateWith(inventory: InventoryItem[] = []): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 }, armorClass: 12, definitionId: "def-hero", inventory },
    { id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12 }
  ] });
}

const DEFINITION = definitionOf();
const resolve = () => DEFINITION;

function deps(faces: number[]): ResolveDependencies {
  let index = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession, now: () => "2026-08-14T00:00:00.000Z",
    definition: DEFINITION, catalog: CATALOG
  };
}

describe("the C9 bind: one shipped row, two picked bases, two different numbers", () => {
  it("binds Sword of Sharpness to a greatsword: the server copies the base's stats and the swing derives", () => {
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "sword-of-sharpness", name: "Sword of Sharpness", equipped: true, attuned: true, category: "weapon", baseId: "greatsword" }), resolve, { catalog: CATALOG });

    const stored = state.actors[0].inventory[0];
    expect(stored.baseId).toBe("greatsword");
    // The block is the SERVER's copy of the greatsword row - dice, type, band and properties.
    expect(stored.weapon).toEqual({ category: "martial", damageDice: "2d6", damageType: "slashing", rangeFeet: null, longRangeFeet: null, properties: ["heavy", "two-handed"] });

    const action = effectiveActions(DEFINITION, state.actors[0], CATALOG).find((entry) => entry.id === "item-sword-of-sharpness")!;
    // Heavy two-hander: Strength (+1) + proficiency (2). Labelled as the MAGIC item, not the base.
    expect(action.name).toBe("Sword of Sharpness");
    expect(action.attack!.bonus).toBe(3);
    expect(action.damage).toEqual([{ formula: "2d6 + 1", type: "slashing" }]);
  });

  it("the SAME shipped row bound to a scimitar swings off Dexterity - finesse travels with the pick", () => {
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "sword-of-sharpness", name: "Sword of Sharpness", equipped: true, attuned: true, category: "weapon", baseId: "scimitar" }), resolve, { catalog: CATALOG });

    const action = effectiveActions(DEFINITION, state.actors[0], CATALOG).find((entry) => entry.id === "item-sword-of-sharpness")!;
    // Finesse: max(str +1, dex +2) = Dexterity. One point apart so a wrong max cannot pass.
    expect(action.attack!.bonus).toBe(4);
    expect(action.damage).toEqual([{ formula: "1d6 + 2", type: "slashing" }]);

    // And the ROLL, not just the number: d20 = 10 -> 14 vs AC 12 (hit), 1d6 = 5 -> 7 damage.
    startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000201" }, deps([10, 5]));
    expect(resolution.attack).toMatchObject({ total: 14, outcome: "hit" });
    expect(resolution.damage).toEqual([{ formula: "1d6 + 2", type: "slashing", total: 7 }]);
  });

  it("refuses a base outside the printed eligibility, naming it", () => {
    const state = stateWith();
    expect(() => setInventoryItem(state, IDS.hero, row({ id: "dwarven-thrower", name: "Dwarven Thrower", equipped: true, category: "weapon", baseId: "greatsword" }), resolve, { catalog: CATALOG }))
      .toThrow(new CommandRejectedError('Dwarven Thrower applies to Warhammer - "greatsword" is not one of its printed bases.'));
  });

  it("auto-binds a single-base template - no question with one answer", () => {
    const state = stateWith();
    // Sun Blade is always a longsword; the row arrives with NO baseId and binds anyway.
    setInventoryItem(state, IDS.hero, row({ id: "sun-blade", name: "Sun Blade", equipped: true, attuned: true, category: "weapon" }), resolve, { catalog: CATALOG });
    const stored = state.actors[0].inventory[0];
    expect(stored.baseId).toBe("longsword");
    expect(stored.weapon).toMatchObject({ damageDice: "1d8", damageType: "slashing" });
    expect(effectiveActions(DEFINITION, state.actors[0], CATALOG).find((entry) => entry.id === "item-sun-blade")!.damage)
      .toEqual([{ formula: "1d8 + 1", type: "slashing" }]);
  });

  it("never trusts a client-supplied block on a template row - bound it is overwritten, unbound it is stripped", () => {
    const state = stateWith();
    // Bound, with a spoofed 9d10: the server's copy wins.
    setInventoryItem(state, IDS.hero, row({ id: "sword-of-sharpness", name: "Sword of Sharpness", equipped: true, category: "weapon", baseId: "greatsword", weapon: { category: "simple", damageDice: "9d10", damageType: "force", rangeFeet: null, longRangeFeet: null } }), resolve, { catalog: CATALOG });
    expect(state.actors[0].inventory[0].weapon!.damageDice).toBe("2d6");

    // Unbound choice template (a legacy add): the block is stripped and NOTHING derives - today's
    // honest dead state, kept legal so pre-C9 rows survive ordinary edits.
    setInventoryItem(state, IDS.hero, row({ id: "weapon-1", name: "Weapon, +1", equipped: true, category: "weapon", weapon: { category: "martial", damageDice: "2d6", damageType: "slashing", rangeFeet: null, longRangeFeet: null } }), resolve, { catalog: CATALOG });
    const unbound = state.actors[0].inventory.find((entry) => entry.id === "weapon-1")!;
    expect(unbound.baseId).toBeUndefined();
    expect(unbound.weapon).toBeUndefined();
    expect(effectiveActions(DEFINITION, state.actors[0], CATALOG).find((entry) => entry.id === "item-weapon-1")).toBeUndefined();

    // The legacy row still takes an ordinary edit (quantity) without a refusal.
    setInventoryItem(state, IDS.hero, row({ id: "weapon-1", name: "Weapon, +1", equipped: true, category: "weapon", quantity: 2 }), resolve, { catalog: CATALOG });
    expect(state.actors[0].inventory.find((entry) => entry.id === "weapon-1")!.quantity).toBe(2);
  });

  it("a bound weapon carries its base's mastery, and a mastery pick spent on the base covers it", () => {
    const definition = definitionOf({ character: { classes: [{ id: "fighter", name: "Fighter", level: 3 }], feats: [], choices: [{ kind: "weapon-mastery", id: "greatsword" }] } });
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "sword-of-sharpness", name: "Sword of Sharpness", equipped: true, category: "weapon", baseId: "greatsword" }), () => definition, { catalog: CATALOG });
    const derivation = deriveEquipment(state.actors[0], definition, CATALOG);
    // A bound Sword of Sharpness IS a greatsword: Graze, off the base record, unlocked by the pick.
    expect(derivation.masteryByActionId["item-sword-of-sharpness"]).toMatchObject({ id: "graze" });
  });
});

describe("the C9 bind: armor", () => {
  it("binds Armor of Vulnerability to chain mail: worn alone, the real base AC derives", () => {
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "armor-of-vulnerability", name: "Armor of Vulnerability", equipped: true, attuned: true, category: "armor", baseId: "chain-mail" }), resolve, { catalog: CATALOG });
    const stored = state.actors[0].inventory[0];
    expect(stored.baseId).toBe("chain-mail");
    expect(stored.armor).toEqual({ acBase: 16, addDexModifier: false, dexModifierCap: null, stealthDisadvantage: true, strengthRequired: 13 });
    // Chain mail's printed 16, not the unarmored 10 + Dex the unbound row used to read.
    expect(state.actors[0].armorClass).toBe(16);
  });

  it("a PLAYER cannot wear a bound magic armor over mundane armor - the slot rule already holds", () => {
    const state = stateWith([row({ id: "chain-mail", name: "Chain Mail", equipped: true, category: "armor", armor: { acBase: 16, addDexModifier: false, dexModifierCap: null, stealthDisadvantage: false, strengthRequired: 13 } })]);
    expect(() => setInventoryItem(state, IDS.hero, row({ id: "armor-of-vulnerability", name: "Armor of Vulnerability", equipped: true, category: "armor", baseId: "chain-mail" }), resolve, { catalog: CATALOG, role: "player" }))
      .toThrow(/already occupies the armor slot/);
  });

  it("refuses an armor base outside the printed eligibility, naming the printed form", () => {
    const state = stateWith();
    expect(() => setInventoryItem(state, IDS.hero, row({ id: "adamantine-armor", name: "Adamantine Armor", equipped: true, category: "armor", baseId: "hide-armor" }), resolve, { catalog: CATALOG }))
      .toThrow(/applies to Any Medium or Heavy, Except Hide Armor/);
  });
});
