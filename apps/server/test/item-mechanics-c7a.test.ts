import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { loadMagicItems } from "@vtt/content-srd-5.2.1";
import { deriveEquipment, type EquipmentCatalog, type EquipmentRecordLike } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
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
    expect(shipped("plate-armor-of-etherealness").casts).toContainEqual(expect.objectContaining({ spellId: "etherealness" }));
    expect(shipped("armor-of-invulnerability").grants!.damageResistances).toEqual(["bludgeoning", "piercing", "slashing"]);
    expect(shipped("frost-brand").grants!.damageResistances).toEqual(["fire"]);
    expect(shipped("demon-armor").cursed).toBe(true);
  });

  it("pins limit (0): NO weapon-category row carries a weapon-scoped rider, because none can fire", () => {
    /**
     * THE LANE'S GOVERNING FINDING, held as a test so a later pass cannot quietly re-add the riders
     * this salvage removed. `attack-bonus` and `extra-damage` are `THIS_ITEM_BY_DEFAULT`
     * (`packages/rules-5e/src/riders.ts:231`) and every one of these rows carries `slot: "weapon"`, so
     * `scopeOf` resolves them to `"this-item"` - and `weaponAction` derives no swing without a
     * `weapon` block, so there is no `sourceItemId` for them to match. Measured: `weaponActionIds: []`
     * and `effectiveActions: []` on a picker-minted Dwarven Thrower.
     */
    const weapons = MAGIC_ITEMS.filter((row) => row.category === "weapon");
    expect(weapons).toHaveLength(33);
    expect(weapons.filter((row) => row.weapon != null), "the premise moved: a weapon row now carries a weapon block").toHaveLength(0);
    const weaponScoped = weapons.flatMap((row) => (row.modifiers ?? [])
      .filter((modifier) => ["attack-bonus", "extra-damage", "critical-range", "critical-bonus-dice", "damage-bonus"].includes(modifier.type))
      .map((modifier) => `${row.id}/${modifier.type}`));
    expect(weaponScoped, "a weapon-scoped rider on a row with no weapon block can never fire - record it as a named absence instead").toEqual([]);
  });

  it("leaves every RESERVED item bare, so a later unit finds an unauthored carrier", () => {
    // U20 (Sun Blade, Energy Bow), U23 (Vicious Weapon), U29 (Spellguard Shield), and the two the
    // schema refuses outright (Berserker Axe, Thunderous Greatclub).
    for (const id of ["sun-blade", "energy-bow", "vicious-weapon", "spellguard-shield", "berserker-axe", "thunderous-greatclub"]) {
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
    // `weapons-armour.ts` states "24 of 60 carry a rider - 11 armour, 6 shields, 3 ammunition, 4
    // weapons" and "36 of 60 are prose-only". A row moving between those groups without the header
    // moving with it is exactly the "we skipped it / we decided it" confusion this lane exists to end.
    const carriesRider = (row: (typeof laneRows)[number]) =>
      (row.modifiers?.length ?? 0) > 0 || (row.casts?.length ?? 0) > 0 || row.cursed === true
      || (row.grants !== undefined && Object.values(row.grants).some((value) => Array.isArray(value) && value.length > 0));

    expect(laneRows, "the lane's category footprint moved").toHaveLength(60);
    const authored = laneRows.filter(carriesRider);
    expect(authored, "the module header says 24 of 60").toHaveLength(24);
    expect(laneRows.length - authored.length, "the module header says 36 prose-only").toBe(36);
    const byCategory = Object.fromEntries(LANE_CATEGORIES.map((category) =>
      [category, authored.filter((row) => row.category === category).length]));
    expect(byCategory).toEqual({ armor: 11, shield: 6, ammunition: 3, weapon: 4 });
  });
});
