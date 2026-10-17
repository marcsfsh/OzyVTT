import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMagicItems } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
// The authored map is authoring-side and outside the package's `exports` map, so it is imported by path.
import { ITEM_MECHANICS } from "../../../packages/content-srd-5.2.1/scripts/item-mechanics/items.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
import { initiativeRollMode, startEncounter } from "../src/encounter.js";

// Properties of the authored item mechanics as a whole, which no per-category file can hold: the cast
// sweeps apply to every authored cast, because `castAction` does not care what kind of item casts, and
// the rider families shared across categories are driven to an engine outcome. Each sweep first checks
// its population is not empty, so a sweep that matches nothing fails.

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
/** The row the browse-and-add picker mints: id, name, category, equipped, attuned, and a shield's armor block. */
const picked = (id: string, over: Record<string, unknown> = {}): InventoryItem => {
  const row = view.equipmentRecord(id)!;
  return item({
    id,
    name: row.name,
    quantity: 1,
    category: row.category,
    equipped: true,
    attuned: row.attunement?.required === true,
    ...(row.armor ? { armor: row.armor } : {}),
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

/** Every cast the map authors, with the item that casts it. */
const AUTHORED_CASTS = Object.entries(ITEM_MECHANICS).flatMap(([itemId, mechanics]) =>
  (mechanics.casts ?? []).map((cast) => ({ itemId, spellId: cast.spellId }))
);

// Spells no item may cast, each with what the cast would have done. `castAction` reads
// `spell.damage.roll` as the cast's damage, `spell.damage.types[0] ?? "force"` as its type, and emits
// an `attack` block from `spell.attackRoll`; for these records those columns describe the spell's text
// rather than what one cast rolls at a target.
const REFUSED_CASTS: ReadonlyArray<readonly [string, string]> = [
  [
    "cure-wounds",
    "{roll: '2d8', types: []} -> a 2d8 FORCE damage action; a Staff of Healing would hit the ally it heals"
  ],
  [
    "heal",
    "{roll: null, types: []} -> no damage, no save, no attack: a Rod of Resurrection that restores nothing and debits a charge"
  ],
  ["magic-missile", "{roll: '1d4 + 1'} is ONE of the THREE darts the SRD prints - ~3.5 where the spell averages ~10.5"],
  ["web", "{roll: '2d4', types: ['fire']} is the damage of BURNING webs, and the cast rolls it on every press"],
  [
    "ray-of-enfeeblement",
    "{roll: '1d8', types: []} -> a 1d8 Force damage action; the 1d8 is what the TARGET subtracts from its own damage rolls"
  ],
  ["protection-from-evil-and-good", "a ward that rolls nothing at anybody"],
  ["faerie-fire", "a spell whose only roll is the target's Dexterity save"]
];

describe("the cast rules apply to every authored cast", () => {
  it("walks a real population - the sweeps below are vacuous if it is ever empty", () => {
    expect(AUTHORED_CASTS.length).toBeGreaterThan(0);
  });

  it("names none of the seven spells whose record does not describe what a cast rolls", () => {
    for (const [spellId, why] of REFUSED_CASTS) {
      const found = AUTHORED_CASTS.filter((cast) => cast.spellId === spellId).map((cast) => cast.itemId);
      expect(found, `${spellId} is cast by ${found.join(", ")} and it must not be: ${why}`).toEqual([]);
    }
  });

  it("names no spell whose damage roll carries no damage type", () => {
    // `castAction` types damage as `spell.damage.types[0] ?? "force"`, so a spell with dice and no type would
    // become Force damage; those spells (healing, buffs, choose-your-type) must not be authored as casts.
    for (const cast of AUTHORED_CASTS) {
      const spell = view.spellRecord!(cast.spellId);
      expect(spell, `${cast.itemId} casts "${cast.spellId}", which resolves to no spell record`).toBeDefined();
      const offends = spell!.damage?.roll != null && (spell!.damage?.types?.length ?? 0) === 0;
      expect(
        offends,
        `${cast.itemId} casts ${cast.spellId}, whose damage is ${JSON.stringify(spell!.damage)} - castAction types an untyped roll as "force", so this cast would deal Force damage to the ally it is pointed at. Record it as a named absence`
      ).toBe(false);
    }
  });

  it("names no spell the record marks as an attack roll", () => {
    // An item's cast takes its attack from the spell's cast model, so none of them relies on this column.
    for (const cast of AUTHORED_CASTS) {
      const spell = view.spellRecord!(cast.spellId)!;
      expect(
        spell.attackRoll,
        `${cast.itemId} casts ${cast.spellId}, which the record marks attackRoll - castAction would hang an attack block on it`
      ).toBe(false);
    }
  });
});

// Rider families the per-category files only check survive into the bundle (`ammunition-3`,
// `sentinel-shield`, `demon-armor`), driven here to an engine outcome.
describe("the rider families held only by a bundle assertion, driven", () => {
  it("ammunition's bonuses land on a shot from a launcher and stay off a melee swing or a thrown weapon", () => {
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
    // The bow and the mace come from the shipped catalog; the ammunition is picker-minted, picked as arrows (a +3
    // still waiting for its kind fits no launcher). d20 = 9.
    const arrows3 = picked("ammunition-3", { baseId: "arrows-20" });
    expect(shot([fromCatalog("longbow"), arrows3], "item-longbow"), "the +3 did not reach the shot").toBe(14);
    expect(shot([fromCatalog("longbow"), picked("arrows-20")], "item-longbow"), "the control: Dex +2 alone").toBe(11);
    // `weapon-property-is: ["ammunition"]` keeps this from being a blanket +3.
    expect(shot([fromCatalog("mace"), arrows3], "item-mace"), "the arrow reached a melee swing").toBe(9);
    // A thrown dagger is a ranged attack that fires no ammunition: d20 9 + Dex 2 + PB 3.
    expect(shot([fromCatalog("dagger"), arrows3], "item-dagger"), "the arrow reached a thrown dagger").toBe(11);
  });

  it("ammunition's damage half lands on the launcher's hit", () => {
    const definition = definitionOf();
    const state = fight(stateWith([fromCatalog("longbow"), picked("ammunition-2", { baseId: "arrows-20" })]));
    const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === "item-longbow")!;
    const resolution = resolveDefinitionAction(
      state,
      action,
      { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000001" },
      deps([19, 4], definition)
    );
    expect(resolution.attack!.outcome).toBe("hit");
    expect(resolution.bonusDamage).toEqual([{ amount: 2, type: "piercing", source: "Ammunition, +2" }]);
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
      ["shield-of-missile-attraction", "Shield of Missile Attraction"],
      ["berserker-axe", "Berserker Axe"],
      ["armor-of-vulnerability", "Armor of Vulnerability"]
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
    // The SRD prints a Curse on exactly these four, so a fifth cursed carrier has to be looked at.
    expect(
      ROWS.filter((row) => row.cursed === true)
        .map((row) => row.id)
        .sort()
    ).toEqual(["armor-of-vulnerability", "berserker-axe", "demon-armor", "shield-of-missile-attraction"]);
  });
});
