import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMagicItems } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
// The lane list is authoring-side and outside the package's `exports` map, so it is imported by path.
import { ITEM_MECHANICS_LANES } from "../../../packages/content-srd-5.2.1/scripts/item-mechanics/index.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
import { initiativeRollMode, startEncounter } from "../src/encounter.js";

// Program-wide properties no single lane test can hold:
//   1. Every prose-only item carries a recorded absence (its id in backticks in the module's prose).
//   2. The four lanes partition the bundle: every row belongs to exactly one lane.
//   3. The cast sweeps apply to every lane, because `castAction` is lane-blind.
// Each sweep first pins the size of its population, so a sweep that matches nothing fails.

const view = new ContentLibrary().forAudience("gm");
const catalog = equipmentCatalogOf(view);
const ROWS = loadMagicItems();

const IDS = {
  hero: "10000000-0000-4000-8000-000000000001",
  foe: "10000000-0000-4000-8000-000000000002",
  gmSession: "30000000-0000-4000-8000-00000000000a",
  map: "20000000-0000-5000-8000-000000000001"
} as const;
const GEOMETRY = { width: 900, height: 600, calibration: null } as const;

/** A Wizard 5, Dex 14, PB 3, proficient in nothing, so every number below is the item's. */
function definitionOf(): ActorDefinition {
  return {
    name: "Hero",
    armorClass: 12,
    proficiencyBonus: 3,
    abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 },
    actions: [],
    extensions: {},
    character: { classes: [{ id: "wizard", name: "Wizard", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [], weapons: [], armor: [], tools: [] }
  } as unknown as ActorDefinition;
}
const item = (over: Record<string, unknown>): InventoryItem =>
  InventoryItemSchema.parse({ id: "x", name: "X", ...over });
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
        hp: { current: 60, maximum: 60 },
        armorClass: 12
      }
    ]
  });
}
function fight(state: GameState) {
  startEncounter(
    state,
    {
      mapAssetId: IDS.map,
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
function deps(faces: number[], definition: ActorDefinition): ResolveDependencies {
  let index = 0;
  return {
    random: () => {
      const face = faces.shift();
      if (face === undefined) throw new Error("dice queue empty");
      return face;
    },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession,
    now: () => "2026-08-12T00:00:00.000Z",
    definition,
    catalog
  };
}
/** The row the browse-and-add picker mints: id, name, category, equipped, attuned, nothing else. */
const picked = (id: string, over: Record<string, unknown> = {}): InventoryItem => {
  const row = view.equipmentRecord(id)!;
  return item({
    id,
    name: row.name,
    quantity: 1,
    category: row.category,
    equipped: true,
    attuned: row.attunement?.required === true,
    ...over
  });
};
/** A mundane weapon, minted from the shipped catalog. */
const fromCatalog = (id: string): InventoryItem => {
  const record = view.equipmentRecord(id)!;
  const weapon = record.weapon!;
  return item({
    id: record.id,
    name: record.name,
    quantity: 1,
    equipped: true,
    category: record.category,
    weapon: {
      category: weapon.category,
      damageDice: weapon.damageDice,
      damageType: weapon.damageType,
      rangeFeet: weapon.rangeFeet,
      longRangeFeet: weapon.longRangeFeet,
      ...(weapon.properties ? { properties: [...weapon.properties] } : {})
    }
  });
};

const WORN_SLOTS = ["neck", "shoulders", "head", "feet", "hands", "belt"];

// Lane ownership from the modules' headers, not `lane.categories` (which overlap): `wands-rods-rings.ts`
// owns the scroll and `carried-and-potions.ts` the other consumables.
const LANES: ReadonlyArray<{
  readonly lane: string;
  readonly module: string;
  readonly rows: number;
  readonly authored: number;
  readonly owns: (row: (typeof ROWS)[number]) => boolean;
}> = [
  {
    lane: "C7a",
    module: "weapons-armour.ts",
    rows: 60,
    authored: 42,
    owns: (row) => ["weapon", "armor", "shield", "ammunition"].includes(row.category)
  },
  {
    lane: "C7b",
    module: "wands-rods-rings.ts",
    rows: 57,
    authored: 27,
    owns: (row) => ["wand", "staff", "rod", "ring"].includes(row.category) || row.id === "spell-scroll"
  },
  {
    lane: "C7c",
    module: "worn-wondrous.ts",
    rows: 56,
    authored: 21,
    owns: (row) => row.category === "wondrous-item" && WORN_SLOTS.includes(row.slot ?? "")
  },
  {
    lane: "C7d",
    module: "carried-and-potions.ts",
    rows: 95,
    authored: 18,
    owns: (row) =>
      ((row.category === "wondrous-item" && row.slot === "wondrous") || row.category === "consumable") &&
      row.id !== "spell-scroll"
  }
];

const moduleSource = (file: string): string =>
  readFileSync(
    fileURLToPath(new URL(`../../../packages/content-srd-5.2.1/scripts/item-mechanics/${file}`, import.meta.url)),
    "utf8"
  );

describe("the content program: every prose-only item carries a recorded absence", () => {
  it("covers all 268 rows exactly once - a row nobody owns is a row nobody owes an absence for", () => {
    const owners = ROWS.map((row) => ({
      id: row.id,
      owners: LANES.filter((lane) => lane.owns(row)).map((lane) => lane.lane)
    }));
    expect(
      owners.filter((row) => row.owners.length !== 1),
      "every row belongs to exactly one lane"
    ).toEqual([]);
    expect(LANES.map((lane) => `${lane.lane}:${ROWS.filter(lane.owns).length}`)).toEqual([
      "C7a:60",
      "C7b:57",
      "C7c:56",
      "C7d:95"
    ]);
    expect(LANES.reduce((total, lane) => total + lane.rows, 0)).toBe(ROWS.length);
    expect(ROWS).toHaveLength(268);
  });

  it.each(LANES)("$lane: every one of its $rows rows is authored or named in $module", (lane) => {
    const composed = ITEM_MECHANICS_LANES.find((entry) => entry.lane === lane.lane);
    expect(composed, `no ${lane.lane} lane is composed into ITEM_MECHANICS_LANES at all`).toBeDefined();
    const authored = new Set(Object.keys(composed!.entries));
    const mine = ROWS.filter(lane.owns);
    const source = moduleSource(lane.module);

    // A recorded absence is the id in backticks in the module's prose (authored keys are `"id":`); the backticks
    // also stop `crystal-ball` matching `crystal-ball-of-telepathy`.
    const unrecorded = mine
      .filter((row) => !authored.has(row.id) && !source.includes(`\`${row.id}\``))
      .map((row) => row.id);
    expect(
      { lane: lane.lane, unrecorded },
      `${lane.lane}: these rows are neither authored nor named as an absence in ${lane.module}. A row that is silently skipped is indistinguishable from one that was decided - name it, with the sentence it could not express and what would unblock it`
    ).toEqual({ lane: lane.lane, unrecorded: [] });

    // The counts, so "everything is named" cannot be satisfied by a lane that authors nothing.
    expect({ lane: lane.lane, rows: mine.length, authored: authored.size }).toEqual({
      lane: lane.lane,
      rows: lane.rows,
      authored: lane.authored
    });
    expect(mine.length - authored.size, `${lane.lane}'s absence count`).toBe(lane.rows - lane.authored);
    for (const id of authored)
      expect(
        mine.some((row) => row.id === id),
        `${lane.lane} authors ${id}, which is not one of its own rows`
      ).toBe(true);
  });

  it("walks a real population - 108 authored and 160 absences over the four lanes", () => {
    const authored = ITEM_MECHANICS_LANES.reduce((total, lane) => total + Object.keys(lane.entries).length, 0);
    expect(authored).toBe(108);
    expect(ROWS.length - authored).toBe(160);
  });
});

// Every cast any lane authors, attributed to its lane so a refusal names both. Lazy so that removing
// a lane from `index.ts` fails a named test instead of throwing during collection.
const authoredCasts = () => {
  expect(ITEM_MECHANICS_LANES.length, "no lane is composed into ITEM_MECHANICS_LANES at all").toBe(4);
  return ITEM_MECHANICS_LANES.flatMap((lane) =>
    Object.entries(lane.entries).flatMap(([itemId, mechanics]) =>
      (mechanics.casts ?? []).map((cast) => ({ lane: lane.lane, itemId, spellId: cast.spellId }))
    )
  );
};

describe("the content program: the two cast rules apply to every lane, not just C7b", () => {
  it("walks a real population - the two sweeps below are vacuous if this number is ever 0", () => {
    const casts = authoredCasts();
    expect(casts).toHaveLength(43);
    expect(new Set(casts.map((cast) => cast.itemId)).size).toBe(29);
    expect(
      Object.fromEntries(
        ITEM_MECHANICS_LANES.map((lane) => [lane.lane, casts.filter((cast) => cast.lane === lane.lane).length])
      )
    ).toEqual({ C7a: 2, C7b: 28, C7c: 6, C7d: 7 });
  });

  it("names no spell whose damage roll carries no damage type - in ANY lane", () => {
    // `castAction` types damage as `spell.damage.types[0] ?? "force"`, so a spell with dice and no type would
    // become Force damage; those spells (healing, buffs, choose-your-type) must not be authored as casts.
    for (const cast of authoredCasts()) {
      const spell = view.spellRecord!(cast.spellId);
      expect(
        spell,
        `${cast.lane}/${cast.itemId} casts "${cast.spellId}", which resolves to no spell record`
      ).toBeDefined();
      const offends = spell!.damage?.roll != null && (spell!.damage?.types?.length ?? 0) === 0;
      expect(
        offends,
        `${cast.lane}/${cast.itemId} casts ${cast.spellId}, whose damage is ${JSON.stringify(spell!.damage)} - castAction types an untyped roll as "force", so this cast would deal Force damage to the ally it is pointed at. Record it as a named absence`
      ).toBe(false);
    }
  });

  it("names no spell the record marks as an attack roll - in ANY lane", () => {
    // The `attackRoll` column is set by any mention of an attack roll in the text, including other
    // creatures' attacks, so no authored cast may rely on it.
    for (const cast of authoredCasts()) {
      const spell = view.spellRecord!(cast.spellId)!;
      expect(
        spell.attackRoll,
        `${cast.lane}/${cast.itemId} casts ${cast.spellId}, which the record marks attackRoll - castAction would hang an attack block on it`
      ).toBe(false);
    }
  });
});

// Rider families that lane tests only check survive into the bundle (`ammunition-3`, `sentinel-shield`,
// `demon-armor`), driven here to an engine outcome.
describe("the content program: the rider families held only by a bundle assertion, driven", () => {
  it("ammunition's attack-bonus lands on a RANGED to-hit and stays off a MELEE one", () => {
    const definition = definitionOf();
    const shot = (inventory: InventoryItem[], actionId: string) => {
      const state = fight(stateWith(inventory));
      const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === actionId)!;
      return resolveDefinitionAction(
        state,
        action,
        { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000001" },
        deps([9, 4], definition)
      ).attack!.total;
    };
    // The bow and the mace come from the shipped catalog; the ammunition is picker-minted. d20 = 9.
    expect(
      shot([fromCatalog("longbow"), picked("ammunition-3")], "item-longbow"),
      "the +3 did not reach the shot"
    ).toBe(14);
    expect(shot([fromCatalog("longbow")], "item-longbow"), "the control: Dex +2 alone").toBe(11);
    // `attack-kind-is: ["ranged"]` keeps this from being a blanket +3.
    expect(shot([fromCatalog("mace"), picked("ammunition-3")], "item-mace"), "the arrow reached a melee swing").toBe(9);
  });

  it("a roll-mode rider really reaches the initiative die, on all three of its carriers", () => {
    const definition = definitionOf();
    for (const id of ["sentinel-shield", "weapon-of-warning", "rod-of-alertness"]) {
      expect(
        initiativeRollMode(stateWith([picked(id)]), IDS.hero, () => definition, catalog),
        `${id}: the authored advantage did not reach initiativeRollMode`
      ).toBe("advantage");
      expect(
        initiativeRollMode(stateWith([picked(id, { equipped: false })]), IDS.hero, () => definition, catalog),
        `${id}: unequipping must be the un-grant`
      ).toBe("normal");
    }
  });

  // "Advantage on ... Wisdom (Perception) checks" is authored to the ability, because `BUILTIN_CHECKS.search`
  // has no `skill` key and `skill-is` fails closed. The same rider must leave Hide and Study alone.
  it("Wisdom (Perception) advantage reaches the SEARCH die on both its carriers, and no other check", () => {
    const searchWith = (id: string, n: number, over: Record<string, unknown> = {}) => {
      const definition = definitionOf();
      const state = fight(stateWith([picked(id, over)]));
      const resolution = resolveDefinitionAction(
        state,
        builtinAction("search")!,
        {
          actorId: IDS.hero,
          targetIds: [],
          commandId: `50000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
          builtin: true
        },
        deps([6, 19], definition)
      );
      return { resolution, formula: state.rolls.find((roll) => roll.purpose === "check")!.normalizedFormula };
    };

    // Wis 10 = +0, so the total is the die.
    for (const [n, id, name] of [
      [30, "sentinel-shield", "Sentinel Shield"],
      [31, "rod-of-alertness", "Rod of Alertness"]
    ] as const) {
      const worn = searchWith(id, n);
      expect(worn.resolution.check, `${id}: Search did not keep the higher die`).toMatchObject({
        skill: "Wisdom (Search)",
        naturalRoll: 19,
        total: 19
      });
      expect(worn.formula).toBe("2d20kh1+0");
      expect(worn.resolution.rollMode).toEqual({ mode: "advantage", advantage: [name], disadvantage: [] });

      // The control. For the Rod it is attunement rather than equipping: `picked` sets `attuned` from the
      // row's `attunement.required`.
      const off = searchWith(id, n + 10, id === "rod-of-alertness" ? { attuned: false } : { equipped: false });
      expect(off.resolution.check, `${id}: taking it off must be the un-grant`).toMatchObject({
        naturalRoll: 6,
        total: 6
      });
      expect(off.formula).toBe("1d20+0");
      expect(off.resolution.rollMode).toBeUndefined();
    }

    // And it narrows: `ability-is: ["wis"]` must not touch Hide (dex) or Study (int).
    for (const [n, actionId, formula] of [
      [50, "hide", "1d20+2"],
      [51, "study", "1d20+3"]
    ] as const) {
      const definition = definitionOf();
      const state = fight(stateWith([picked("sentinel-shield")]));
      const resolution = resolveDefinitionAction(
        state,
        builtinAction(actionId)!,
        {
          actorId: IDS.hero,
          targetIds: [],
          commandId: `50000000-0000-4000-8000-0000000000${n}`,
          builtin: true
        },
        deps([6, 19], definition)
      );
      expect(resolution.rollMode, `${actionId} must not see a Wisdom-narrowed rider`).toBeUndefined();
      expect(state.rolls.find((roll) => roll.purpose === "check")!.normalizedFormula).toBe(formula);
    }
  });

  it("a cursed item refuses to come off for a PLAYER and comes off for the GM", () => {
    const definition = definitionOf();
    for (const [id, name] of [
      ["demon-armor", "Demon Armor"],
      ["shield-of-missile-attraction", "Shield of Missile Attraction"]
    ] as const) {
      const worn = stateWith([picked(id)]);
      // Captured rather than asserted with `.toThrow`, so a failure shows the item's id in the diff.
      const attempt = (() => {
        try {
          setInventoryItem(worn, IDS.hero, picked(id, { equipped: false }), () => definition, {
            catalog,
            role: "player"
          });
          return "the player took it off";
        } catch (error) {
          return (error as Error).message;
        }
      })();
      expect({ id, attempt }).toEqual({ id, attempt: `${name} will not come off. Ask the GM.` });
      const gm = stateWith([picked(id)]);
      setInventoryItem(gm, IDS.hero, picked(id, { equipped: false }), () => definition, { catalog, role: "gm" });
      expect(gm.actors[0].inventory[0].equipped, `${id}: the GM must be able to take it off`).toBe(false);
    }
    // These two are the whole population, so a third cursed carrier has to be looked at.
    expect(ROWS.filter((row) => row.cursed === true).map((row) => row.id)).toEqual([
      "demon-armor",
      "shield-of-missile-attraction"
    ]);
  });
});
