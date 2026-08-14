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

  it("auto-binds a single-base template - no question with one answer - and its riders land whole", () => {
    const state = stateWith();
    // Dwarven Thrower is always a warhammer; the row arrives with NO baseId and binds anyway,
    // and its authored +3/+3 lands: attack 1 (str) + 2 (prof) + 3 = 6, damage 1d8 + 1 + 3.
    setInventoryItem(state, IDS.hero, row({ id: "dwarven-thrower", name: "Dwarven Thrower", equipped: true, attuned: true, category: "weapon" }), resolve, { catalog: CATALOG });
    const stored = state.actors[0].inventory[0];
    expect(stored.baseId).toBe("warhammer");
    expect(stored.weapon).toMatchObject({ damageDice: "1d8", damageType: "bludgeoning" });
    const action = effectiveActions(DEFINITION, state.actors[0], CATALOG).find((entry) => entry.id === "item-dwarven-thrower")!;
    expect(action.attack!.bonus).toBe(6);
    expect(action.damage).toEqual([{ formula: "1d8 + 4", type: "bludgeoning" }]);
  });

  it("Sun Blade and Energy Bow do NOT bind - a wrong swing may not replace an honest absence", () => {
    // The 2026-08-14 review's finding: their print is MORE than the base (Radiant/Force conversion,
    // +2/+1 - U20's mechanism), so the ETL withholds their appliesTo and the rows stay dead.
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "sun-blade", name: "Sun Blade", equipped: true, attuned: true, category: "weapon" }), resolve, { catalog: CATALOG });
    expect(state.actors[0].inventory[0].baseId).toBeUndefined();
    expect(effectiveActions(DEFINITION, state.actors[0], CATALOG).find((entry) => entry.id === "item-sun-blade")).toBeUndefined();
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

describe("the C9 headline far end: the +N ladder lands whole through the real bind", () => {
  it("one shipped 'Weapon, +1' row, bound to a greatsword: +1 to hit AND +1 damage, derived and ROLLED", () => {
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "weapon-1", name: "Weapon, +1", equipped: true, category: "weapon", baseId: "greatsword" }), resolve, { catalog: CATALOG });
    const action = effectiveActions(DEFINITION, state.actors[0], CATALOG).find((entry) => entry.id === "item-weapon-1")!;
    // Str +1, proficiency 2, and the SHIPPED attack-bonus rider's +1 = 4; the SHIPPED damage-bonus
    // folds into the printed formula: 2d6 + 1 (str) + 1 (flat) = "2d6 + 2". This is the number the
    // plan said must never be understated - the whole reason limit (A) was co-scheduled with C9.
    expect(action.attack!.bonus).toBe(4);
    expect(action.damage).toEqual([{ formula: "2d6 + 2", type: "slashing" }]);

    startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000210" }, deps([10, 3, 4]));
    expect(resolution.attack).toMatchObject({ total: 14, outcome: "hit" });
    expect(resolution.damage).toEqual([{ formula: "2d6 + 2", type: "slashing", total: 9 }]);
    expect(resolution.damageTotal).toBe(9);
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

describe("the C9 bind: the 2026-08-14 review's four write-path rules", () => {
  it("a stale pick fails OPEN on an existing bind, and the row stays removable by anyone", () => {
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "sword-of-sharpness", name: "Sword of Sharpness", equipped: true, category: "weapon", baseId: "greatsword" }), resolve, { catalog: CATALOG });
    // The base leaves the catalog (a homebrew base soft-deleted, a template narrowed).
    const drifted: EquipmentCatalog = { equipmentRecord: (id) => id === "greatsword" ? undefined : RECORDS.find((record) => record.id === id), featRecord: () => undefined };
    // An ordinary edit keeps the frozen copied stats rather than throwing...
    setInventoryItem(state, IDS.hero, row({ ...state.actors[0].inventory[0], equipped: false }), resolve, { catalog: drifted, role: "player" });
    expect(state.actors[0].inventory[0].weapon).toMatchObject({ damageDice: "2d6" });
    expect(state.actors[0].inventory[0].baseId).toBe("greatsword");
    // ...and the row is still REMOVABLE - the review's stuck-row reproduction, closed.
    setInventoryItem(state, IDS.hero, row({ id: "sword-of-sharpness", name: "Sword of Sharpness", quantity: 0, category: "weapon", baseId: "greatsword" }), resolve, { catalog: drifted, role: "player" });
    expect(state.actors[0].inventory).toHaveLength(0);
  });

  it("a non-template row STRIPS a forged baseId - proficiency and mastery cannot be self-granted", () => {
    const definition = definitionOf({ proficiencies: { saves: [], skills: [], weapons: ["rapier"] }, character: { classes: [{ id: "fighter", name: "Fighter", level: 3 }], feats: [], choices: [{ kind: "weapon-mastery", id: "rapier" }] } });
    const state = stateWith();
    // A plain greatsword row arrives claiming to BE a rapier: the forged identity dies at the door.
    setInventoryItem(state, IDS.hero, row({ id: "greatsword", name: "Greatsword", equipped: true, category: "weapon", baseId: "rapier" }), () => definition, { catalog: CATALOG, role: "player" });
    expect(state.actors[0].inventory[0].baseId).toBeUndefined();
    const derivation = deriveEquipment(state.actors[0], definition, CATALOG);
    expect(derivation.masteryByActionId["item-greatsword"]).toBeUndefined();
  });

  it("a baseId-less write INHERITS the stored pick - the free-text slug collision cannot unbind", () => {
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "weapon-1", name: "Weapon, +1", equipped: true, category: "weapon", baseId: "dagger" }), resolve, { catalog: CATALOG });
    // The free-text add mints the same slug with no baseId; the write must not unbind the row.
    setInventoryItem(state, IDS.hero, row({ id: "weapon-1", name: "Weapon, +1", equipped: true, category: "weapon", quantity: 2 }), resolve, { catalog: CATALOG });
    const stored = state.actors[0].inventory[0];
    expect(stored.quantity).toBe(2);
    expect(stored.baseId).toBe("dagger");
    expect(stored.weapon).toMatchObject({ damageDice: "1d4" });
  });

  it("a player cannot swap an existing pick in place; the GM can (the audited override)", () => {
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "weapon-1", name: "Weapon, +1", equipped: true, category: "weapon", baseId: "dagger" }), resolve, { catalog: CATALOG });
    expect(() => setInventoryItem(state, IDS.hero, row({ id: "weapon-1", name: "Weapon, +1", equipped: true, category: "weapon", baseId: "greatsword" }), resolve, { catalog: CATALOG, role: "player" }))
      .toThrow(/already bound - remove it and add it again/);
    setInventoryItem(state, IDS.hero, row({ id: "weapon-1", name: "Weapon, +1", equipped: true, category: "weapon", baseId: "greatsword" }), resolve, { catalog: CATALOG, role: "gm" });
    expect(state.actors[0].inventory[0].weapon).toMatchObject({ damageDice: "2d6" });
  });

  it("authored on-hit dice DOUBLE on a critical hit - a Flame Tongue crit deals 4d6 fire, as printed", () => {
    const state = stateWith();
    setInventoryItem(state, IDS.hero, row({ id: "flame-tongue", name: "Flame Tongue", equipped: true, attuned: true, category: "weapon", baseId: "longsword" }), resolve, { catalog: CATALOG });
    const action = effectiveActions(DEFINITION, state.actors[0], CATALOG).find((entry) => entry.id === "item-flame-tongue")!;
    startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
    // d20 = 20 (crit): the longsword's 1d8 doubles to 2d8 (3 + 4), and the rider's 2d6 fire doubles
    // to 4d6 (2 + 2 + 3 + 3) - SRD 5.2.1 Critical Hits: "you also roll those dice twice".
    const crit = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000220" }, deps([20, 3, 4, 2, 2, 3, 3]));
    expect(crit.attack?.outcome).toBe("crit");
    expect(crit.damage).toEqual([
      { formula: "2d8 + 1", type: "slashing", total: 8 },
      { formula: "4d6", type: "fire", total: 10 }
    ]);
    expect(crit.damageTotal).toBe(18);
  });
});
