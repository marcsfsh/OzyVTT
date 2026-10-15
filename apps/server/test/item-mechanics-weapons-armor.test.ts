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

// Magic weapons, armor, shields and ammunition, read from the shipped bundle (`loadMagicItems()`) and driven to an
// engine outcome: a halved damage total, a moved Armor Class, rolled weapon numbers.
// `item-riders.test.ts` covers the readers with injected catalogs; this file covers the authored data.
// Fixture rule: no inventory row may supply a column the shipped row does not carry. Rows are minted
// as the browse-and-add picker mints them (id, name, category, equipped, attuned, and the row's own
// armor block when it has one), and `mintsTheWayThePickerDoes` guards that. The one exception is
// `boundTo`, which mints a row as the weapon bind does: the magic item's identity plus the chosen
// base weapon's block copied verbatim from the shipped equipment catalog.

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002"
} as const;

/** The shipped rows; the bundle the app loads. */
const MAGIC_ITEMS = loadMagicItems();
const shipped = (id: string): EquipmentRecordLike => {
  const row = MAGIC_ITEMS.find((item) => item.id === id);
  if (!row) throw new Error(`no row in magic-items.v1.json carries the id "${id}"`);
  return row as EquipmentRecordLike;
};

const catalogOf = (records: readonly EquipmentRecordLike[]): EquipmentCatalog => ({
  equipmentRecord: (id) => records.find((record) => record.id === id),
  featRecord: () => undefined
});

function definitionOf(): ActorDefinition {
  return {
    name: "Hero",
    armorClass: 12,
    proficiencyBonus: 2,
    abilityScores: { str: 16, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [],
    extensions: {},
    character: { classes: [{ id: "paladin", name: "Paladin", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [], weapons: ["martial"], armor: [], tools: [] }
  } as unknown as ActorDefinition;
}

// What the browse-and-add picker mints for a magic item: id, name, category, the two booleans, and
// the catalog row's `armor` block when it carries one (only shields do), as `addFromCatalog` in
// `apps/client/src/encounter/CharacterSheet.tsx` copies it. A magic weapon or body armor has no block
// of its own; it gets one only from the bind.
const asPicked = (id: string, over: Record<string, unknown> = {}): InventoryItem => {
  const row = shipped(id);
  return InventoryItemSchema.parse({
    id,
    name: row.name,
    quantity: 1,
    category: row.category,
    equipped: true,
    attuned: (row as { attunement?: { required?: boolean } }).attunement?.required === true,
    ...(row.armor ? { armor: row.armor } : {}),
    ...over
  });
};

function stateWith(inventory: InventoryItem[]): GameState {
  return GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      {
        id: IDS.hero,
        name: "Hero",
        kind: "player-character",
        visibility: "public",
        hp: { current: 30, maximum: 30 },
        armorClass: 12,
        definitionId: "def-hero",
        inventory
      },
      {
        id: IDS.foe,
        name: "Foe",
        kind: "monster",
        visibility: "public",
        hp: { current: 40, maximum: 40 },
        armorClass: 12
      }
    ]
  });
}

// Weapon-bind helpers; see the header's exception.

const EQUIPMENT = loadEquipment();

// The inventory row the weapon bind mints: the magic item's id/name/category and the two booleans,
// plus the base weapon's block copied from its shipped catalog row (minus `mastery`, which the strict
// `ItemWeaponSchema` does not carry).
const boundTo = (magicId: string, baseId: string, over: Record<string, unknown> = {}): InventoryItem => {
  const base = EQUIPMENT.find((record) => record.id === baseId)?.weapon;
  if (!base) throw new Error(`no shipped equipment row "${baseId}" carries a weapon block to bind`);
  return asPicked(magicId, {
    weapon: {
      category: base.category,
      damageDice: base.damageDice,
      damageType: base.damageType,
      rangeFeet: base.rangeFeet,
      longRangeFeet: base.longRangeFeet,
      ...(base.properties ? { properties: [...base.properties] } : {})
    },
    ...over
  });
};

const GEOMETRY = { width: 900, height: 600, calibration: null } as const;
const GM_SESSION = "30000000-0000-4000-8000-00000000000a";
function fight(state: GameState): GameState {
  startEncounter(
    state,
    {
      mapAssetId: "20000000-0000-5000-8000-000000000001",
      entries: [
        { actorId: IDS.hero, score: 20 },
        { actorId: IDS.foe, score: 10 }
      ]
    },
    () => 1,
    GEOMETRY
  );
  return state;
}
function deps(faces: number[], catalog: EquipmentCatalog, definition: ActorDefinition): ResolveDependencies {
  let index = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: GM_SESSION,
    now: () => "2026-08-14T00:00:00.000Z",
    definition,
    catalog
  };
}

describe("Armor of Resistance halves a typed damage total", () => {
  const ARMOR = shipped("armor-of-resistance");
  const catalog = catalogOf([ARMOR]);
  const definition = definitionOf();
  const worn = (equipped = true) => stateWith([asPicked("armor-of-resistance", { equipped })]);

  it("halves the authored damage type and names the armor on the line", () => {
    const state = worn();
    // The SRD prints a d10 table and no fixed type ("The GM chooses the type or determines it
    // randomly"); the map authors lightning.
    const outcome = applyDamageDetailed(
      state,
      IDS.hero,
      { parts: [{ amount: 12, type: "lightning" }], amount: 12 },
      { role: "gm" },
      { resolveDefinition: () => definition, catalog }
    );
    expect(
      outcome.application.totalApplied,
      "armor-of-resistance: the authored lightning resistance did not halve the total"
    ).toBe(6);
    expect(outcome.application.parts[0]).toMatchObject({
      adjustment: "resistance",
      adjustmentSource: "Armor of Resistance"
    });
    expect(state.actors[0].hp.current).toBe(24);
  });

  it("takes the resistance off with the armor, and never covers another damage type", () => {
    const off = worn(false);
    applyDamageDetailed(
      off,
      IDS.hero,
      { parts: [{ amount: 12, type: "lightning" }], amount: 12 },
      { role: "gm" },
      { resolveDefinition: () => definition, catalog }
    );
    expect(off.actors[0].hp.current, "unequipping must be the un-grant").toBe(18);

    // A type the armor does not resist lands in full: the rider is typed, not blanket.
    const other = worn();
    applyDamageDetailed(
      other,
      IDS.hero,
      { parts: [{ amount: 12, type: "fire" }], amount: 12 },
      { role: "gm" },
      { resolveDefinition: () => definition, catalog }
    );
    expect(other.actors[0].hp.current).toBe(18);
  });

  it("applies nothing before attunement - the SRD gates this row behind it", () => {
    const unattuned = stateWith([asPicked("armor-of-resistance", { attuned: false })]);
    expect(
      deriveEquipment(unattuned.actors[0], definition, catalog).damageResistances,
      "armor-of-resistance: an unattuned armor still granted its resistance"
    ).toHaveLength(0);
  });

  it("mintsTheWayThePickerDoes: the far end's own inventory row carries no column the bundle lacks", () => {
    // Guards the fixture rule in the header: a picker-minted row carries only the blocks its row carries.
    const row = asPicked("armor-of-resistance") as unknown as Record<string, unknown>;
    expect(row.weapon, "the picker cannot mint a weapon block the catalog row does not carry").toBeUndefined();
    expect(row.armor, "the picker cannot mint an armor block the catalog row does not carry").toBeUndefined();
    expect(asPicked("shield-2").armor, "a shield arrives with the shield block its row carries").toEqual(
      shipped("shield-2").armor
    );
  });
});

describe("the armour and shield rows move a real Armor Class", () => {
  it("raises actor.armorClass on equip and gives it back on unequip", () => {
    // `armor-class` is not in `THIS_ITEM_BY_DEFAULT`, so it is a standing bearer rider and needs no
    // `armor` block. A shield adds the plain shield's +2 from its block on top of its own bonus: Dex 14
    // and no body armor make 10 + 2 + 2 = 14 before the rider.
    for (const [id, amount] of [
      ["armor-1", 1],
      ["shield-2", 2 + 2],
      ["sentinel-shield", 2],
      ["dwarven-plate", 2]
    ] as const) {
      const catalog = catalogOf([shipped(id)]);
      const definition = definitionOf();
      const state = stateWith([]);
      setInventoryItem(state, IDS.hero, asPicked(id), () => definition, { catalog });
      expect(state.actors[0].armorClass, `${id}: +${amount} did not reach the sheet's AC`).toBe(12 + amount);
      setInventoryItem(state, IDS.hero, asPicked(id, { equipped: false }), () => definition, { catalog });
      expect(state.actors[0].armorClass, `${id}: unequipping must be the un-grant`).toBe(12);
    }
  });
});

// Weapon rows driven from the shipped bundle on a bound base-weapon block to rolled numbers.

describe("the shipped +1 weapon record on a bound base weapon block", () => {
  const catalog = catalogOf([shipped("weapon-1")]);

  it("(a) on a greatsword: prints 2d6 + 4 at attack bonus 6, and the ROLLED total pays the +1", () => {
    // STR 16 (+3), prof 2, martial-proficient: to-hit 3 + 2 + 1 = 6; damage str +3 and the flat +1
    // folded into one printed formula.
    const definition = definitionOf();
    const state = fight(stateWith([boundTo("weapon-1", "greatsword")]));
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-weapon-1"
    )!;
    expect(action.damage, "weapon-1: the shipped damage-bonus did not fold into the greatsword swing").toEqual([
      { formula: "2d6 + 4", type: "slashing" }
    ]);
    expect(action.attack!.bonus).toBe(6);

    // The roll: d20 = 10 -> 16 vs AC 12 (hit); 2d6 = 3 + 4 -> 11 damage, the +1 inside the total.
    const resolution = resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000201" },
      deps([10, 3, 4], catalog, definition)
    );
    expect(resolution.attack).toMatchObject({ total: 16, naturalRoll: 10, targetAc: 12, outcome: "hit" });
    expect(resolution.damage).toEqual([{ formula: "2d6 + 4", type: "slashing", total: 11 }]);
    expect(resolution.damageTotal).toBe(11);
  });

  it("(b) on a dagger: finesse travels with the bound block - dex swings it when dex is the better", () => {
    // A finesse weapon uses `Math.max(str, dex)` (`weaponAbilityModifierFrom`), so proving the finesse
    // property was copied needs a bearer whose Dex wins: STR 10 / DEX 14, prof 2, simple-proficient:
    // to-hit 2 + 2 + 1 = 5, damage "1d4 + 3". Without the property it would print "1d4 + 1".
    const definition = {
      ...definitionOf(),
      abilityScores: { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 },
      proficiencies: { saves: [], skills: [], weapons: ["simple"], armor: [], tools: [] }
    } as unknown as ActorDefinition;
    const state = fight(stateWith([boundTo("weapon-1", "dagger")]));
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-weapon-1"
    )!;
    expect(action.damage, "weapon-1: finesse did not travel with the bound dagger block").toEqual([
      { formula: "1d4 + 3", type: "piercing" }
    ]);
    expect(action.attack!.bonus).toBe(5);

    // The roll: d20 = 10 -> 15 vs AC 12 (hit); 1d4 = 2 -> 5 damage.
    const resolution = resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000202" },
      deps([10, 2], catalog, definition)
    );
    expect(resolution.damage).toEqual([{ formula: "1d4 + 3", type: "piercing", total: 5 }]);
    expect(resolution.damageTotal).toBe(5);
  });

  it("(d) unequipped, the bound row derives no swing at all - the negative control for the +N family", () => {
    const definition = definitionOf();
    const state = fight(stateWith([boundTo("weapon-1", "greatsword", { equipped: false })]));
    expect(
      effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-weapon-1")
    ).toBeUndefined();
  });
});

describe("the shipped on-hit dice on a bound melee block", () => {
  it("(c) flame-tongue on a longsword: the resolution carries TWO typed entries, slashing + 2d6 fire", () => {
    const definition = definitionOf();
    const catalog = catalogOf([shipped("flame-tongue")]);
    const state = fight(stateWith([boundTo("flame-tongue", "longsword")]));
    const action = effectiveActions(definition, state.actors[0], catalog).find(
      (entry) => entry.id === "item-flame-tongue"
    )!;
    // No +N on this row: str +3 + prof 2 only. The extra die lands at resolution, typed.
    expect(action.attack!.bonus).toBe(5);

    // d20 = 10 (hit); longsword 1d8 = 5 -> 8 slashing; rider 2d6 = 2 + 6 -> 8 fire.
    const resolution = resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000203" },
      deps([10, 5, 2, 6], catalog, definition)
    );
    expect(resolution.damage, "flame-tongue: the shipped 2d6 fire did not land as its own typed entry").toEqual([
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
      const resolution = resolveDefinitionAction(
        state,
        action,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000204" },
        deps([...faces], catalog, definition)
      );
      expect(resolution.damage, `${id}: the shipped ${formula} ${type} did not land`).toEqual([
        { formula: "1d8 + 3", type: "slashing", total: 8 },
        { formula, type, total }
      ]);
    }
  });

  it("(d) unattuned, the die and the +1 pair stay off while the swing itself remains - the attunement control", () => {
    const definition = definitionOf();
    // flame-tongue: the bound swing still derives, but the carrier is inactive, so one damage entry.
    const flameCatalog = catalogOf([shipped("flame-tongue")]);
    const cold = fight(stateWith([boundTo("flame-tongue", "longsword", { attuned: false })]));
    const flameAction = effectiveActions(definition, cold.actors[0], flameCatalog).find(
      (entry) => entry.id === "item-flame-tongue"
    )!;
    const resolution = resolveDefinitionAction(
      cold,
      flameAction,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000205" },
      deps([10, 5], flameCatalog, definition)
    );
    expect(resolution.damage).toEqual([{ formula: "1d8 + 3", type: "slashing", total: 8 }]);

    // luck-blade (attunement-gated +N carrier): unattuned, the printed numbers are the longsword's own.
    const luckCatalog = catalogOf([shipped("luck-blade")]);
    const plain = fight(stateWith([boundTo("luck-blade", "longsword", { attuned: false })]));
    const luckAction = effectiveActions(definition, plain.actors[0], luckCatalog).find(
      (entry) => entry.id === "item-luck-blade"
    )!;
    expect(luckAction.attack!.bonus).toBe(5);
    expect(luckAction.damage).toEqual([{ formula: "1d8 + 3", type: "slashing" }]);
  });
});

describe("the authored riders are present in the shipped bundle", () => {
  it("carries the authored riders on the rows that print them", () => {
    // One representative per rider family authored on these rows.
    expect(shipped("armor-2").modifiers).toContainEqual(expect.objectContaining({ type: "armor-class", amount: 2 }));
    expect(shipped("shield-3").modifiers).toContainEqual(expect.objectContaining({ type: "armor-class", amount: 3 }));
    expect(shipped("ammunition-3").modifiers).toContainEqual(
      expect.objectContaining({ type: "attack-bonus", amount: 3 })
    );
    expect(shipped("luck-blade").modifiers).toContainEqual(expect.objectContaining({ type: "save-bonus", amount: 1 }));
    expect(shipped("sentinel-shield").modifiers).toContainEqual(
      expect.objectContaining({ type: "roll-mode", roll: "initiative", mode: "advantage" })
    );
    // Gated on the ability because `BUILTIN_CHECKS.search` passes no skill and `skill-is` fails closed
    // without one. Driven to the die in `item-mechanics-shared.test.ts`.
    expect(shipped("sentinel-shield").modifiers).toContainEqual({
      type: "roll-mode",
      roll: "check",
      mode: "advantage",
      when: [{ type: "on-ability-check" }, { type: "ability-is", abilities: ["wis"] }]
    });
    expect(shipped("plate-armor-of-etherealness").casts).toContainEqual(
      expect.objectContaining({ spellId: "etherealness" })
    );
    expect(shipped("armor-of-invulnerability").grants!.damageResistances).toEqual([
      "bludgeoning",
      "piercing",
      "slashing"
    ]);
    expect(shipped("frost-brand").grants!.damageResistances).toEqual(["fire"]);
    expect(shipped("demon-armor").cursed).toBe(true);
  });

  it("pins the re-authored weapon rows BY NAME AND VALUE - and every other weapon row to none", () => {
    // Exactly these weapon rows carry exactly these weapon-scoped riders (by name and value), and any
    // other weapon row carries none. Magic weapon rows still carry no `weapon` block of their own;
    // the swing comes from the base weapon at bind time.
    const weapons = MAGIC_ITEMS.filter((row) => row.category === "weapon");
    expect(
      weapons.filter((row) => row.weapon != null),
      "the premise moved: a weapon row now carries a weapon block"
    ).toHaveLength(0);

    const AUTHORED: Readonly<Record<string, readonly string[]>> = {
      "weapon-1": ["attack-bonus +1", "damage-bonus +1"],
      "weapon-2": ["attack-bonus +2", "damage-bonus +2"],
      "weapon-3": ["attack-bonus +3", "damage-bonus +3"],
      "dwarven-thrower": ["attack-bonus +3", "damage-bonus +3"],
      defender: ["attack-bonus +3", "damage-bonus +3"],
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
    const actual = Object.fromEntries(
      weapons
        .map(
          (row) =>
            [
              row.id,
              (row.modifiers ?? [])
                .filter((modifier) => WEAPON_SCOPED.includes(modifier.type))
                .map((modifier) =>
                  nameOf(modifier as { type: string; amount?: number; formula?: string; damageType?: string })
                )
            ] as const
        )
        .filter(([, riders]) => riders.length > 0)
    );
    expect(
      actual,
      "the shipped weapon-scoped riders moved: a row this map does not name must stay empty, and a named row must carry exactly its printed values"
    ).toEqual(AUTHORED);

    // Every +N pair has no explicit gate or scope: `THIS_ITEM_BY_DEFAULT` means "made with this magic
    // weapon", and `scope: "bearer"` would let two magic weapons in a pack stack.
    for (const row of weapons) {
      for (const modifier of row.modifiers ?? []) {
        if (!WEAPON_SCOPED.includes(modifier.type)) continue;
        expect((modifier as { when?: unknown[] }).when, `${row.id}/${modifier.type} must stay ungated`).toEqual([]);
        expect(
          (modifier as { scope?: string }).scope,
          `${row.id}/${modifier.type} must not set an explicit scope`
        ).toBeUndefined();
      }
    }
  });

  it("leaves every RESERVED item bare, so a later unit finds an unauthored carrier", () => {
    // Rows whose printed effects need mechanics the engine does not model yet.
    for (const id of ["sun-blade", "energy-bow", "vicious-weapon", "spellguard-shield", "thunderous-greatclub"]) {
      const row = shipped(id) as unknown as { modifiers: unknown[]; casts: unknown[]; cursed: boolean };
      expect(row.modifiers, `${id} is reserved and must carry no modifiers`).toEqual([]);
      expect(row.casts, `${id} is reserved and must carry no casts`).toEqual([]);
      expect(row.cursed, `${id} is reserved and must not be cursed`).toBe(false);
    }
  });

  it("holds the two riders this salvage REMOVED to their named absences", () => {
    // Two authoring mistakes pinned so they do not return:
    // 1. `demon-armor`'s "you know Abyssal": an item's `grants.languages` lands in
    //    `derivation.languages`, which nothing reads; sheet languages are built at character-build time.
    // 2. `armor-of-vulnerability`: `FeatureGrantsSchema` has no `damageVulnerabilities`, so authoring
    //    the resistance half alone would make the cursed armor strictly better than plain.
    expect(
      shipped("demon-armor").grants?.languages ?? [],
      "demon-armor's Abyssal has no reader; it is a named absence, not a grant"
    ).toEqual([]);
    const vulnerable = shipped("armor-of-vulnerability") as unknown as {
      modifiers: unknown[];
      grants: unknown;
      cursed: boolean;
    };
    expect(vulnerable.modifiers, "armor-of-vulnerability must author nothing until both halves can land").toEqual([]);
    expect(vulnerable.cursed, "a curse with no downside is an inverted item").toBe(false);
    expect((vulnerable.grants as { damageResistances?: string[] } | undefined)?.damageResistances ?? []).toEqual([]);
  });
});
