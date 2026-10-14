import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { loadEquipment, loadMagicItems } from "@vtt/content-srd-5.2.1";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { effectiveActions } from "../src/effective-actions.js";
import { deriveEquipment, type EquipmentCatalog, type EquipmentRecordLike } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
import { startEncounter } from "../src/encounter.js";
import { applyDamageDetailed } from "../src/hit-points.js";

/**
 * C7a - THE BOTH-PATHS TEST FOR THE WEAPONS-AND-ARMOUR LANE.
 *
 * "Both paths" means the riders are read out of the SHIPPED bundle
 * (`bundles/magic-items.v1.json`, via `loadMagicItems()`) rather than injected as a fixture, and then
 * driven all the way to an ENGINE OUTCOME - a halved damage total and a moved Armor Class. Strip the
 * lane out of `scripts/item-mechanics/index.ts`, regenerate, and the far end fails naming its item.
 *
 * `item-riders.test.ts` proves the READERS with injected catalogs (13 criteria). This file proves the
 * AUTHORING: that the SRD items this lane wrote carry those riders in the bundle the server loads.
 *
 * ==============================================================================================
 * THE FIXTURE RULE THIS FILE IS WRITTEN UNDER, because breaking it is how the lane's FIRST far end
 * passed while the shipped data did nothing:
 *
 *   **NO FIXTURE HERE MAY SUPPLY A COLUMN THE SHIPPED ROW DOES NOT CARRY.**
 *
 * The retired far end drove `Dwarven Thrower`'s to-hit from an inventory row the test itself gave a
 * `weapon` block - `{damageDice: "1d8", rangeFeet: 20, properties: ["thrown"]}` - and **0 of the 33
 * `weapon`-category rows in the bundle carry one** (`weapon: null`, every row). Without that block
 * `weaponAction` returns null, no swing is derived, and the `this-item`-scoped `attack-bonus` has
 * nothing to bind to. The test was measuring its own fixture. So every inventory row below is minted
 * the way the browse-and-add picker mints one - id, name, category, equipped, attuned, and NOTHING
 * else - and `mintsTheWayThePickerDoes` below is the guard that keeps it that way.
 *
 * THE ONE SANCTIONED EXCEPTION, 2026-08-14: the C9 far ends mint their inventory rows the way the
 * C9 BIND mints one - the magic item's own id/name plus the chosen BASE weapon's block copied
 * VERBATIM from the shipped equipment catalog (`boundTo` below reads it out of `loadEquipment()`
 * rather than writing dice by hand, minus the `mastery` column `ItemWeaponSchema` does not carry).
 * That is not the retired far end's failure returning: the retired fixture supplied stats NO
 * shipped surface carried, while the bind copies stats the base weapon's own shipped row carries -
 * and the CATALOG record under test still comes only from `loadMagicItems()`.
 * ==============================================================================================
 */

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002"
} as const;

/** THE SHIPPED ROWS. No fixture anywhere in this file - this is the bundle the app loads. */
const MAGIC_ITEMS = loadMagicItems();
const shipped = (id: string): EquipmentRecordLike => {
  const row = MAGIC_ITEMS.find((item) => item.id === id);
  if (!row) throw new Error(`C7a: no row in magic-items.v1.json carries the id "${id}"`);
  return row as EquipmentRecordLike;
};

const LANE_CATEGORIES = ["weapon", "armor", "shield", "ammunition"] as const;
const laneRows = MAGIC_ITEMS.filter((row) => (LANE_CATEGORIES as readonly string[]).includes(row.category));

const catalogOf = (records: readonly EquipmentRecordLike[]): EquipmentCatalog => ({
  equipmentRecord: (id) => records.find((record) => record.id === id),
  featRecord: () => undefined
});

function definitionOf(): ActorDefinition {
  return {
    name: "Hero", armorClass: 12, proficiencyBonus: 2,
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 }, actions: [], extensions: {},
    character: { classes: [{ id: "paladin", name: "Paladin", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [], weapons: ["martial"], armor: [], tools: [] }
  } as unknown as ActorDefinition;
}

/**
 * EXACTLY what the browse-and-add picker mints for a magic item: the row's own id and name, its
 * category, and the two booleans the player sets. No `weapon` block, no `armor` block - because the
 * catalog summary this is built from (`apps/client/src/encounter/equipment.tsx`) has none to copy.
 */
const asPicked = (id: string, over: Record<string, unknown> = {}): InventoryItem => {
  const row = shipped(id);
  return InventoryItemSchema.parse({
    id, name: row.name, quantity: 1, category: row.category,
    equipped: true, attuned: (row as { attunement?: { required?: boolean } }).attunement?.required === true,
    ...over
  });
};

function stateWith(inventory: InventoryItem[]): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 }, armorClass: 12, definitionId: "def-hero", inventory },
    { id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 40, maximum: 40 }, armorClass: 12 }
  ] });
}

// -------------------------------------------------------------------------------------------------
// C9-bind helpers (2026-08-14). See the header's sanctioned exception.
// -------------------------------------------------------------------------------------------------

const EQUIPMENT = loadEquipment();

/**
 * The inventory row the C9 bind mints: the MAGIC item's id/name/category and the two booleans, plus
 * the chosen BASE weapon's block copied verbatim from its own shipped catalog row (the same
 * `loadEquipment()` weapon mapping the picker reads; `mastery` stays behind because
 * `ItemWeaponSchema` is strict and does not carry it).
 */
const boundTo = (magicId: string, baseId: string, over: Record<string, unknown> = {}): InventoryItem => {
  const base = EQUIPMENT.find((record) => record.id === baseId)?.weapon;
  if (!base) throw new Error(`C7a: no shipped equipment row "${baseId}" carries a weapon block to bind`);
  return asPicked(magicId, {
    weapon: {
      category: base.category, damageDice: base.damageDice, damageType: base.damageType,
      rangeFeet: base.rangeFeet, longRangeFeet: base.longRangeFeet,
      ...(base.properties ? { properties: [...base.properties] } : {})
    },
    ...over
  });
};

const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const GM_SESSION = "30000000-0000-4000-8000-00000000000a";
function fight(state: GameState): GameState {
  startEncounter(state, { mapAssetId: "20000000-0000-5000-8000-000000000001", entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
  return state;
}
function deps(faces: number[], catalog: EquipmentCatalog, definition: ActorDefinition): ResolveDependencies {
  let index = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: GM_SESSION, now: () => "2026-08-14T00:00:00.000Z", definition, catalog
  };
}

// -------------------------------------------------------------------------------------------------
// THE FAR END - Armor of Resistance halves a typed damage TOTAL on the damage command.
// -------------------------------------------------------------------------------------------------

describe("C7a far end: Armor of Resistance halves a typed damage total", () => {
  const ARMOR = shipped("armor-of-resistance");
  const catalog = catalogOf([ARMOR]);
  const definition = definitionOf();
  const worn = (equipped = true) => stateWith([asPicked("armor-of-resistance", { equipped })]);

  it("halves the authored damage type and names the armor on the line", () => {
    const state = worn();
    // The lane authored LIGHTNING. The SRD prints a d10 table and no fixed type
    // ("The GM chooses the type or determines it randomly"), so the choice is the lane's and the
    // module says which - this is the number that moves when that choice is edited.
    const outcome = applyDamageDetailed(
      state, IDS.hero, { parts: [{ amount: 12, type: "lightning" }], amount: 12 }, { role: "gm" },
      { resolveDefinition: () => definition, catalog }
    );
    expect(outcome.application.totalApplied, "C7a/armor-of-resistance: the authored lightning resistance did not halve the total").toBe(6);
    expect(outcome.application.parts[0]).toMatchObject({ adjustment: "resistance", adjustmentSource: "Armor of Resistance" });
    expect(state.actors[0].hp.current).toBe(24);
  });

  it("takes the resistance off with the armor, and never covers another damage type", () => {
    const off = worn(false);
    applyDamageDetailed(off, IDS.hero, { parts: [{ amount: 12, type: "lightning" }], amount: 12 }, { role: "gm" },
      { resolveDefinition: () => definition, catalog });
    expect(off.actors[0].hp.current, "unequipping must be the un-grant").toBe(18);

    // A type the armor does NOT resist lands in full while it is worn - the rider is typed, not blanket.
    const other = worn();
    applyDamageDetailed(other, IDS.hero, { parts: [{ amount: 12, type: "fire" }], amount: 12 }, { role: "gm" },
      { resolveDefinition: () => definition, catalog });
    expect(other.actors[0].hp.current).toBe(18);
  });

  it("applies nothing before attunement - the SRD gates this row behind it", () => {
    const unattuned = stateWith([asPicked("armor-of-resistance", { attuned: false })]);
    expect(deriveEquipment(unattuned.actors[0], definition, catalog).damageResistances,
      "C7a/armor-of-resistance: an unattuned armor still granted its resistance").toHaveLength(0);
  });

  it("mintsTheWayThePickerDoes: the far end's own inventory row carries no column the bundle lacks", () => {
    // THE GUARD ON THE FIXTURE RULE in this file's header. If a later edit hands one of these rows a
    // `weapon` or `armor` block to make something "work", this fails - which is the check the retired
    // Dwarven Thrower far end did not have.
    const row = asPicked("armor-of-resistance") as unknown as Record<string, unknown>;
    expect(row.weapon, "the picker cannot mint a weapon block the catalog row does not carry").toBeUndefined();
    expect(row.armor, "the picker cannot mint an armor block the catalog row does not carry").toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// The second kept family, driven through the REAL write path: flat Armor Class.
// -------------------------------------------------------------------------------------------------

describe("C7a: the armour and shield rows move a real Armor Class", () => {
  it("raises actor.armorClass on equip and gives it back on unequip", () => {
    // `armor-class` is NOT in `THIS_ITEM_BY_DEFAULT`, so it is a standing BEARER rider and the missing
    // `armor` block costs it nothing - which is exactly what separates these rows from the weapons.
    for (const [id, amount] of [["armor-1", 1], ["shield-2", 2], ["dwarven-plate", 2]] as const) {
      const catalog = catalogOf([shipped(id)]);
      const definition = definitionOf();
      const state = stateWith([]);
      setInventoryItem(state, IDS.hero, asPicked(id), () => definition, { catalog });
      expect(state.actors[0].armorClass, `C7a/${id}: the authored +${amount} did not reach the sheet's AC`).toBe(12 + amount);
      setInventoryItem(state, IDS.hero, asPicked(id, { equipped: false }), () => definition, { catalog });
      expect(state.actors[0].armorClass, `C7a/${id}: unequipping must be the un-grant`).toBe(12);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// THE C9 FAR ENDS (2026-08-14) - the re-authored weapon rows, driven from the SHIPPED bundle on a
// bound base-weapon block to ROLLED numbers. The catalog record is `loadMagicItems()`'s in every
// case; only the inventory row is minted the way the bind mints one (`boundTo`, header exception).
// -------------------------------------------------------------------------------------------------

describe("C9 far end: the shipped +1 weapon record on a bound base weapon block", () => {
  const catalog = catalogOf([shipped("weapon-1")]);

  it("(a) on a greatsword: prints 2d6 + 4 at attack bonus 6, and the ROLLED total pays the +1", () => {
    // STR 16 (+3), prof 2, martial-proficient (definitionOf): to-hit 3 + 2 + 1 = 6, damage
    // str +3 and the flat +1 folded into ONE printed formula.
    const definition = definitionOf();
    const state = fight(stateWith([boundTo("weapon-1", "greatsword")]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-weapon-1")!;
    expect(action.damage, "C7a/weapon-1: the shipped damage-bonus did not fold into the greatsword swing").toEqual([{ formula: "2d6 + 4", type: "slashing" }]);
    expect(action.attack!.bonus).toBe(6);

    // The ROLL: d20 = 10 -> 16 vs AC 12 (hit); 2d6 = 3 + 4 -> 11 damage, the +1 inside the total.
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000201" }, deps([10, 3, 4], catalog, definition));
    expect(resolution.attack).toMatchObject({ total: 16, naturalRoll: 10, targetAc: 12, outcome: "hit" });
    expect(resolution.damage).toEqual([{ formula: "2d6 + 4", type: "slashing", total: 11 }]);
    expect(resolution.damageTotal).toBe(11);
  });

  it("(b) on a dagger: finesse travels with the bound block - dex swings it when dex is the better", () => {
    // COMPUTED HONESTLY, and the honest rule is `Math.max(str, dex)` (`weaponAbilityModifierFrom`,
    // @vtt/rules-5e): under (a)'s STR 16 / DEX 14 hero a finesse dagger still swings STRENGTH, so
    // proving the property TRAVELED needs a bearer whose dex wins. STR 10 (+0) / DEX 14 (+2),
    // prof 2, simple-proficient: to-hit 2 + 2 + 1 = 5, damage dex +2 and the flat +1 -> "1d4 + 3".
    // (If the properties had NOT been copied onto the bound row, str +0 would print "1d4 + 1".)
    const definition = {
      ...definitionOf(),
      abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencies: { saves: [], skills: [], weapons: ["simple"], armor: [], tools: [] }
    } as unknown as ActorDefinition;
    const state = fight(stateWith([boundTo("weapon-1", "dagger")]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-weapon-1")!;
    expect(action.damage, "C7a/weapon-1: finesse did not travel with the bound dagger block").toEqual([{ formula: "1d4 + 3", type: "piercing" }]);
    expect(action.attack!.bonus).toBe(5);

    // The ROLL: d20 = 10 -> 15 vs AC 12 (hit); 1d4 = 2 -> 5 damage.
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000202" }, deps([10, 2], catalog, definition));
    expect(resolution.damage).toEqual([{ formula: "1d4 + 3", type: "piercing", total: 5 }]);
    expect(resolution.damageTotal).toBe(5);
  });

  it("(d) unequipped, the bound row derives no swing at all - the negative control for the +N family", () => {
    const definition = definitionOf();
    const state = fight(stateWith([boundTo("weapon-1", "greatsword", { equipped: false })]));
    expect(effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-weapon-1")).toBeUndefined();
  });
});

describe("C9 far end: the shipped on-hit dice on a bound melee block", () => {
  it("(c) flame-tongue on a longsword: the resolution carries TWO typed entries, slashing + 2d6 fire", () => {
    const definition = definitionOf();
    const catalog = catalogOf([shipped("flame-tongue")]);
    const state = fight(stateWith([boundTo("flame-tongue", "longsword")]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-flame-tongue")!;
    // No +N on this row: str +3 + prof 2 and nothing else. The die lands at resolution, typed.
    expect(action.attack!.bonus).toBe(5);

    // d20 = 10 (hit); longsword 1d8 = 5 -> 8 slashing; rider 2d6 = 2 + 6 -> 8 fire.
    const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000203" }, deps([10, 5, 2, 6], catalog, definition));
    expect(resolution.damage, "C7a/flame-tongue: the shipped 2d6 fire did not land as its own typed entry").toEqual([
      { formula: "1d8 + 3", type: "slashing", total: 8 },
      { formula: "2d6", type: "fire", total: 8 }
    ]);
    expect(resolution.damageTotal).toBe(16);
  });

  it("frost-brand and sword-of-wounding land their dice the same way, each from its shipped record", () => {
    const definition = definitionOf();
    for (const [id, formula, faces, type, total] of [
      ["frost-brand", "1d6", [10, 5, 4], "cold", 4],
      ["sword-of-wounding", "2d6", [10, 5, 2, 6], "necrotic", 8]
    ] as const) {
      const catalog = catalogOf([shipped(id)]);
      const state = fight(stateWith([boundTo(id, "longsword")]));
      const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === `item-${id}`)!;
      const resolution = resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000204" }, deps([...faces], catalog, definition));
      expect(resolution.damage, `C7a/${id}: the shipped ${formula} ${type} did not land`).toEqual([
        { formula: "1d8 + 3", type: "slashing", total: 8 },
        { formula, type, total }
      ]);
    }
  });

  it("(d) unattuned, the die and the +1 pair stay off while the swing itself remains - the attunement control", () => {
    const definition = definitionOf();
    // flame-tongue: the bound swing still derives (the block is the inventory row's), but the
    // carrier is inactive, so the resolution has ONE damage entry.
    const flameCatalog = catalogOf([shipped("flame-tongue")]);
    const cold = fight(stateWith([boundTo("flame-tongue", "longsword", { attuned: false })]));
    const flameAction = effectiveActions(definition, cold.actors[0], flameCatalog).find((entry) => entry.id === "item-flame-tongue")!;
    const resolution = resolveDefinitionAction(cold, flameAction, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000205" }, deps([10, 5], flameCatalog, definition));
    expect(resolution.damage).toEqual([{ formula: "1d8 + 3", type: "slashing", total: 8 }]);

    // luck-blade (attunement-gated +N carrier): unattuned, the printed numbers are the longsword's own.
    const luckCatalog = catalogOf([shipped("luck-blade")]);
    const plain = fight(stateWith([boundTo("luck-blade", "longsword", { attuned: false })]));
    const luckAction = effectiveActions(definition, plain.actors[0], luckCatalog).find((entry) => entry.id === "item-luck-blade")!;
    expect(luckAction.attack!.bonus).toBe(5);
    expect(luckAction.damage).toEqual([{ formula: "1d8 + 3", type: "slashing" }]);
  });
});

// -------------------------------------------------------------------------------------------------
// The lane's own module-level guards, against the SHIPPED bundle.
// -------------------------------------------------------------------------------------------------

describe("C7a: the lane's riders are present in the shipped bundle", () => {
  it("carries the authored riders on the rows that print them", () => {
    // One representative per rider family the lane authors, so a family silently vanishing from the
    // bundle is caught here rather than at a table.
    expect(shipped("armor-2").modifiers).toContainEqual(expect.objectContaining({ type: "armor-class", amount: 2 }));
    expect(shipped("shield-3").modifiers).toContainEqual(expect.objectContaining({ type: "armor-class", amount: 3 }));
    expect(shipped("ammunition-3").modifiers).toContainEqual(expect.objectContaining({ type: "attack-bonus", amount: 3 }));
    expect(shipped("luck-blade").modifiers).toContainEqual(expect.objectContaining({ type: "save-bonus", amount: 1 }));
    expect(shipped("sentinel-shield").modifiers).toContainEqual(expect.objectContaining({ type: "roll-mode", roll: "initiative", mode: "advantage" }));
    // The Perception half, harvested 2026-08-13 once `roll: "check"` gained a consumer. Gated on the
    // ABILITY because `BUILTIN_CHECKS.search` passes no skill and `skill-is` fails closed without one
    // - a `skill-is: ["perception"]` here would ship a rider that fires nowhere. Driven to the die in
    // `item-mechanics-program.test.ts`, beside the Rod of Alertness that prints the same sentence.
    expect(shipped("sentinel-shield").modifiers).toContainEqual({
      type: "roll-mode", roll: "check", mode: "advantage",
      when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["wis"] }]
    });
    expect(shipped("plate-armor-of-etherealness").casts).toContainEqual(expect.objectContaining({ spellId: "etherealness" }));
    expect(shipped("armor-of-invulnerability").grants!.damageResistances).toEqual(["bludgeoning", "piercing", "slashing"]);
    expect(shipped("frost-brand").grants!.damageResistances).toEqual(["fire"]);
    expect(shipped("demon-armor").cursed).toBe(true);
  });

  it("pins the re-authored weapon rows BY NAME AND VALUE - and every other weapon row to none", () => {
    /**
     * INVERTED 2026-08-14. Until C9 this pin held the lane's governing finding - NO weapon row may
     * carry a weapon-scoped rider, because with no `weapon` block none could fire. C9's bind copies
     * the chosen base weapon's block onto the inventory row at mint time, the client ruling
     * re-authored the printed riders, and the pin now holds the OTHER direction: exactly these rows
     * carry exactly these riders (the C1 discipline - names and values, never a count), and a row
     * this map does not name carries none of the five weapon-scoped families at all.
     *
     * Two premises of the old pin survive unchanged and stay pinned: the lane still has 33 weapon
     * rows, and none of them carries a `weapon` block of its own - the swing is the BASE weapon's,
     * arriving only at bind time.
     */
    const weapons = MAGIC_ITEMS.filter((row) => row.category === "weapon");
    expect(weapons).toHaveLength(33);
    expect(weapons.filter((row) => row.weapon != null), "the premise moved: a weapon row now carries a weapon block").toHaveLength(0);

    const AUTHORED: Readonly<Record<string, readonly string[]>> = {
      "weapon-1": ["attack-bonus +1", "damage-bonus +1"],
      "weapon-2": ["attack-bonus +2", "damage-bonus +2"],
      "weapon-3": ["attack-bonus +3", "damage-bonus +3"],
      "dwarven-thrower": ["attack-bonus +3", "damage-bonus +3"],
      "defender": ["attack-bonus +3", "damage-bonus +3"],
      "vorpal-sword": ["attack-bonus +3", "damage-bonus +3"],
      "holy-avenger": ["attack-bonus +3", "damage-bonus +3"],
      "scimitar-of-speed": ["attack-bonus +2", "damage-bonus +2"],
      "nine-lives-stealer": ["attack-bonus +2", "damage-bonus +2"],
      "quarterstaff-of-the-acrobat": ["attack-bonus +2", "damage-bonus +2"],
      "dagger-of-venom": ["attack-bonus +1", "damage-bonus +1"],
      "giant-slayer": ["attack-bonus +1", "damage-bonus +1"],
      "dragon-slayer": ["attack-bonus +1", "damage-bonus +1"],
      "mace-of-smiting": ["attack-bonus +1", "damage-bonus +1"],
      "hammer-of-thunderbolts": ["attack-bonus +1", "damage-bonus +1"],
      "berserker-axe": ["attack-bonus +1", "damage-bonus +1"],
      "luck-blade": ["attack-bonus +1", "damage-bonus +1"],
      "flame-tongue": ["extra-damage 2d6 fire"],
      "frost-brand": ["extra-damage 1d6 cold"],
      "sword-of-wounding": ["extra-damage 2d6 necrotic"]
    };
    const WEAPON_SCOPED = ["attack-bonus", "extra-damage", "critical-range", "critical-bonus-dice", "damage-bonus"];
    const nameOf = (modifier: { type: string; amount?: number; formula?: string; damageType?: string }): string =>
      modifier.type === "extra-damage"
        ? `extra-damage ${modifier.formula} ${modifier.damageType}`
        : `${modifier.type} ${(modifier.amount ?? 0) >= 0 ? "+" : ""}${modifier.amount}`;
    const actual = Object.fromEntries(weapons
      .map((row) => [row.id, (row.modifiers ?? [])
        .filter((modifier) => WEAPON_SCOPED.includes(modifier.type))
        .map((modifier) => nameOf(modifier as { type: string; amount?: number; formula?: string; damageType?: string }))] as const)
      .filter(([, riders]) => riders.length > 0));
    expect(actual, "the shipped weapon-scoped riders moved: a row this map does not name must stay empty, and a named row must carry exactly its printed values").toEqual(AUTHORED);

    // Every +N pair carries NO explicit gate and NO explicit scope: `THIS_ITEM_BY_DEFAULT` is the
    // "made with this magic weapon", and `scope: "bearer"` would stack two magic weapons in a pack.
    for (const row of weapons) {
      for (const modifier of row.modifiers ?? []) {
        if (!WEAPON_SCOPED.includes(modifier.type)) continue;
        expect((modifier as { when?: unknown[] }).when, `${row.id}/${modifier.type} must stay ungated`).toEqual([]);
        expect((modifier as { scope?: string }).scope, `${row.id}/${modifier.type} must not set an explicit scope`).toBeUndefined();
      }
    }
  });

  it("leaves every RESERVED item bare, so a later unit finds an unauthored carrier", () => {
    // U20 (Sun Blade, Energy Bow), U23 (Vicious Weapon), U29 (Spellguard Shield), and the
    // schema-refusal group's remaining undisturbed carrier (Thunderous Greatclub). `berserker-axe`
    // left this list 2026-08-14: the client ruling named it among the +N carriers, so its printed
    // pair is authored and pinned by name and value above - the hit-points-per-level refusal itself
    // is unchanged and still recorded at its entry.
    for (const id of ["sun-blade", "energy-bow", "vicious-weapon", "spellguard-shield", "thunderous-greatclub"]) {
      const row = shipped(id) as unknown as { modifiers: unknown[]; casts: unknown[]; cursed: boolean };
      expect(row.modifiers, `${id} is reserved and must carry no modifiers`).toEqual([]);
      expect(row.casts, `${id} is reserved and must carry no casts`).toEqual([]);
      expect(row.cursed, `${id} is reserved and must not be cursed`).toBe(false);
    }
  });

  it("holds the two riders this salvage REMOVED to their named absences", () => {
    /**
     * Both were authored by the lane's first pass and both are wrong in a way only a table would
     * notice, which is why they are pinned rather than merely deleted.
     *
     * 1. `demon-armor`'s "you know Abyssal". An item's `grants.languages` lands in
     *    `derivation.languages` (`equipment-derivation.ts:576`) and NOTHING reads that field; the
     *    sheet's languages are built once at character-build time from `feature.grants.languages`
     *    (`character-build.ts:545` -> `:1440`), which no item feeds.
     * 2. `armor-of-vulnerability`. `FeatureGrantsSchema` has no `damageVulnerabilities`, so the
     *    lane's first pass authored the cursed item's RESISTANCE half alone - a curse whose only
     *    effect was to lock a benefit on, making cursed armour strictly better than plain.
     */
    expect(shipped("demon-armor").grants?.languages ?? [],
      "demon-armor's Abyssal has no reader; it is a named absence, not a grant").toEqual([]);
    const vulnerable = shipped("armor-of-vulnerability") as unknown as { modifiers: unknown[]; grants: unknown; cursed: boolean };
    expect(vulnerable.modifiers, "armor-of-vulnerability must author nothing until both halves can land").toEqual([]);
    expect(vulnerable.cursed, "a curse with no downside is an inverted item").toBe(false);
    expect((vulnerable.grants as { damageResistances?: string[] } | undefined)?.damageResistances ?? []).toEqual([]);
  });

  it("holds the module's own counts, so the header cannot drift from the bundle", () => {
    // `weapons-armour.ts` states "42 of 60 carry a rider - 11 armour, 6 shields, 3 ammunition, 22
    // weapons" and "18 of 60 are prose-only" (24/36 with 4 weapons until 2026-08-14, when the C9
    // bind and the closed limit (A) re-authored 18 weapon rows). A row moving between those groups
    // without the header moving with it is exactly the "we skipped it / we decided it" confusion
    // this lane exists to end.
    const carriesRider = (row: (typeof laneRows)[number]) =>
      (row.modifiers?.length ?? 0) > 0 || (row.casts?.length ?? 0) > 0 || row.cursed === true
      || (row.grants !== undefined && Object.values(row.grants).some((value) => Array.isArray(value) && value.length > 0));

    expect(laneRows, "the lane's category footprint moved").toHaveLength(60);
    const authored = laneRows.filter(carriesRider);
    expect(authored, "the module header says 42 of 60").toHaveLength(42);
    expect(laneRows.length - authored.length, "the module header says 18 prose-only").toBe(18);
    const byCategory = Object.fromEntries(LANE_CATEGORIES.map((category) =>
      [category, authored.filter((row) => row.category === category).length]));
    expect(byCategory).toEqual({ armor: 11, shield: 6, ammunition: 3, weapon: 22 });
  });
});
