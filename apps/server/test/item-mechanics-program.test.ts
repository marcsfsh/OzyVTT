import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState } from "@vtt/domain";
import { loadMagicItems } from "@vtt/content-srd-5.2.1";
import { InventoryItemSchema, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
// The lane list is authoring-side and outside the package's `exports` map, so it is reached by path -
// the same import the four lane tests make, for the same reason: this file's subject IS the lane list.
import { ITEM_MECHANICS_LANES } from "../../../packages/content-srd-5.2.1/scripts/item-mechanics/index.js";
import { resolveDefinitionAction, type ResolveDependencies } from "../src/action-resolution.js";
import { builtinAction } from "../src/builtin-actions.js";
import { ContentLibrary } from "../src/content-library.js";
import { effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { setInventoryItem } from "../src/inventory.js";
import { initiativeRollMode, startEncounter } from "../src/encounter.js";

/**
 * ============================================================================================
 * THE CONTENT PROGRAM'S OWN GUARDS - what no single lane's test can hold, because each of them
 * ends at its own lane's boundary.
 * ============================================================================================
 *
 * `item-mechanics-c7{a,b,c,d}.test.ts` each prove ONE lane: its far end, its rider families, its own
 * counts. Three properties belong to the PROGRAM instead, and all three were true when this file was
 * written and guarded by nothing - which is the shape a claim rots in.
 *
 *   1. EVERY PROSE-ONLY ITEM CARRIES A RECORDED ABSENCE. The four modules' headers each promise it
 *      ("every one named below with its reason"), each lane test pins its own AUTHORED count, and
 *      nothing anywhere checks the other side of the subtraction. A lane could drop a row from its
 *      absence list, or the ETL could add a row nobody has looked at, and every existing test would
 *      stay green. MEASURED 2026-08-12 before this guard existed: 0 unrecorded across all four lanes,
 *      181 absences over 268 rows - so this refuses nothing today and exists so it cannot drift.
 *
 *   2. THE FOUR LANES PARTITION THE BUNDLE. The scope predicates below are the four modules' own
 *      claims (60 + 57 + 56 + 95 = 268). A row claimed twice, or claimed by nobody, is a row whose
 *      absence nobody owes - and `spell-scroll` is exactly why that has to be checked rather than
 *      assumed: C7b and C7d both declare the `consumable` category and no lane-level check separates
 *      them on that row (`scripts/item-mechanics/index.ts` states the hole).
 *
 *   3. C7b's TWO CAST SWEEPS ARE THE PROGRAM'S RULES, NOT C7b's. `item-mechanics-c7b.test.ts`'s
 *      `authoredCasts()` filters to `lane === "C7b"`, so "no cast on a spell with an untyped damage
 *      roll" and "no cast given an `attackRoll` the spell does not make" cover 28 of the program's 43
 *      authored casts and let the other 15 through. The mechanism they defend against is
 *      `castAction`'s (`equipment-derivation.ts:922-961`), which is lane-blind: a healing cast added
 *      by C7c or C7d would synthesise Force damage exactly as C7b's did. Widened here to every lane.
 *
 * NON-VACUITY IS ASSERTED, NOT ASSUMED. Each sweep first pins the size of the population it walks, so
 * a sweep that starts matching nothing fails instead of passing. That is the failure mode this whole
 * file is a reaction to.
 */

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

/** A Wizard 5, Dex 14, PB 3, proficient in nothing - so every number below is the item's. */
function definitionOf(): ActorDefinition {
  return {
    name: "Hero", armorClass: 12, proficiencyBonus: 3,
    abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
    hitPoints: { maximum: 30 }, actions: [], extensions: {},
    character: { classes: [{ id: "wizard", name: "Wizard", level: 5 }], feats: [] },
    proficiencies: { saves: [], skills: [], weapons: [], armor: [], tools: [] }
  } as unknown as ActorDefinition;
}
const item = (over: Record<string, unknown>): InventoryItem => InventoryItemSchema.parse({ id: "x", name: "X", ...over });
function stateWith(inventory: InventoryItem[]): GameState {
  return GameStateSchema.parse({ schemaVersion: 1, actors: [
    { id: IDS.hero, name: "Hero", kind: "player-character", visibility: "public", hp: { current: 30, maximum: 30 }, armorClass: 12, definitionId: "def-hero", inventory },
    { id: IDS.foe, name: "Foe", kind: "monster", visibility: "public", hp: { current: 60, maximum: 60 }, armorClass: 12 }
  ] });
}
function fight(state: GameState) {
  startEncounter(state, { mapAssetId: IDS.map, entries: [{ actorId: IDS.hero, score: 20 }, { actorId: IDS.foe, score: 10 }] }, () => 1, GEOMETRY);
  return state;
}
function deps(faces: number[], definition: ActorDefinition): ResolveDependencies {
  let index = 0;
  return {
    random: () => { const face = faces.shift(); if (face === undefined) throw new Error("dice queue empty"); return face; },
    newRollId: () => `40000000-0000-4000-8000-0000000000${String(index++).padStart(2, "0")}`,
    gmSessionId: IDS.gmSession, now: () => "2026-08-12T00:00:00.000Z", definition, catalog
  };
}
/** The row the browse-and-add picker mints: id, name, category, equipped, attuned - nothing else. */
const picked = (id: string, over: Record<string, unknown> = {}): InventoryItem => {
  const row = view.equipmentRecord(id)!;
  return item({ id, name: row.name, quantity: 1, category: row.category, equipped: true, attuned: row.attunement?.required === true, ...over });
};
/** A MUNDANE weapon, minted from the SHIPPED catalog rather than written here. */
const fromCatalog = (id: string): InventoryItem => {
  const record = view.equipmentRecord(id)!;
  const weapon = record.weapon!;
  return item({
    id: record.id, name: record.name, quantity: 1, equipped: true, category: record.category,
    weapon: {
      category: weapon.category, damageDice: weapon.damageDice, damageType: weapon.damageType,
      rangeFeet: weapon.rangeFeet, longRangeFeet: weapon.longRangeFeet,
      ...(weapon.properties ? { properties: [...weapon.properties] } : {})
    }
  });
};

// -------------------------------------------------------------------------------------------------
// THE FOUR LANES' SCOPES, and the absence contract over them
// -------------------------------------------------------------------------------------------------

const WORN_SLOTS = ["neck", "shoulders", "head", "feet", "hands", "belt"];

/**
 * WHICH ROWS EACH LANE OWES AN ANSWER FOR, taken from the four modules' own headers rather than from
 * `lane.categories`, because those overlap on purpose and cannot partition anything by themselves:
 * C7b and C7d BOTH declare `consumable`, and C7c and C7d BOTH declare `wondrous-item`. The `slots`
 * column separates the second pair; nothing separates the first, so the split below is the modules'
 * stated one - **C7b owns the scroll and C7d owns the other 24 consumables** - and the partition test
 * is what holds the four predicates to covering all 268 rows exactly once.
 */
const LANES: ReadonlyArray<{
  readonly lane: string; readonly module: string; readonly rows: number; readonly authored: number;
  readonly owns: (row: (typeof ROWS)[number]) => boolean;
}> = [
  // C7a was 24 until 2026-08-14: C9's bind plus the closed limit (A) re-authored the 18 weapon rows
  // the old limit (0) had emptied (the +N pairs, flame-tongue's, frost-brand's and
  // sword-of-wounding's dice - `item-mechanics-c7a.test.ts` pins each by name and value).
  { lane: "C7a", module: "weapons-armour.ts", rows: 60, authored: 42,
    owns: (row) => ["weapon", "armor", "shield", "ammunition"].includes(row.category) },
  { lane: "C7b", module: "wands-rods-rings.ts", rows: 57, authored: 27,
    owns: (row) => ["wand", "staff", "rod", "ring"].includes(row.category) || row.id === "spell-scroll" },
  { lane: "C7c", module: "worn-wondrous.ts", rows: 56, authored: 21,
    owns: (row) => row.category === "wondrous-item" && WORN_SLOTS.includes(row.slot ?? "") },
  { lane: "C7d", module: "carried-and-potions.ts", rows: 95, authored: 18,
    owns: (row) => ((row.category === "wondrous-item" && row.slot === "wondrous") || row.category === "consumable") && row.id !== "spell-scroll" }
];

const moduleSource = (file: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../packages/content-srd-5.2.1/scripts/item-mechanics/${file}`, import.meta.url)), "utf8");

describe("the content program: every prose-only item carries a recorded absence", () => {
  it("covers all 268 rows exactly once - a row nobody owns is a row nobody owes an absence for", () => {
    const owners = ROWS.map((row) => ({ id: row.id, owners: LANES.filter((lane) => lane.owns(row)).map((lane) => lane.lane) }));
    expect(owners.filter((row) => row.owners.length !== 1), "every row belongs to exactly one lane").toEqual([]);
    expect(LANES.map((lane) => `${lane.lane}:${ROWS.filter(lane.owns).length}`)).toEqual(["C7a:60", "C7b:57", "C7c:56", "C7d:95"]);
    expect(LANES.reduce((total, lane) => total + lane.rows, 0)).toBe(ROWS.length);
    expect(ROWS).toHaveLength(268);
  });

  it.each(LANES)("$lane: every one of its $rows rows is authored or named in $module", (lane) => {
    const composed = ITEM_MECHANICS_LANES.find((entry) => entry.lane === lane.lane);
    expect(composed, `no ${lane.lane} lane is composed into ITEM_MECHANICS_LANES at all`).toBeDefined();
    const authored = new Set(Object.keys(composed!.entries));
    const mine = ROWS.filter(lane.owns);
    const source = moduleSource(lane.module);

    // A RECORDED ABSENCE IS THE ITEM'S ID, IN BACKTICKS, IN THE MODULE'S PROSE. That is the shape all
    // four modules already use and the only one a machine can check: an authored entry's key is
    // `"id":` in double quotes, so a backticked id can only be a comment. The backticks matter -
    // without them `crystal-ball` would be "recorded" by `crystal-ball-of-telepathy`'s entry.
    const unrecorded = mine.filter((row) => !authored.has(row.id) && !source.includes(`\`${row.id}\``)).map((row) => row.id);
    expect({ lane: lane.lane, unrecorded },
      `${lane.lane}: these rows are neither authored nor named as an absence in ${lane.module}. A row that is silently skipped is indistinguishable from one that was decided - name it, with the sentence it could not express and what would unblock it`)
      .toEqual({ lane: lane.lane, unrecorded: [] });

    // THE ARITHMETIC, so "everything is named" cannot be satisfied by a lane that authors nothing.
    expect({ lane: lane.lane, rows: mine.length, authored: authored.size }).toEqual({ lane: lane.lane, rows: lane.rows, authored: lane.authored });
    expect(mine.length - authored.size, `${lane.lane}'s absence count`).toBe(lane.rows - lane.authored);
    for (const id of authored) expect(mine.some((row) => row.id === id), `${lane.lane} authors ${id}, which is not one of its own rows`).toBe(true);
  });

  it("walks a real population - 108 authored and 160 absences over the four lanes", () => {
    // The non-vacuity anchor for the sweep above: if these numbers ever go to zero the per-lane
    // checks are satisfied trivially and this is what says so.
    //
    // WAS 87/181 UNTIL 2026-08-13. The harvest that followed `roll-mode {roll: "check"}` getting a
    // consumer moved exactly three rows, all C7c's and all the same sentence - `boots-of-elvenkind`,
    // `cloak-of-elvenkind`, `cloak-of-the-bat`, *"Advantage on Dexterity (Stealth) checks"*. C7a and
    // C7b each gained a SECOND modifier on a row they already authored (`sentinel-shield`,
    // `rod-of-alertness`), which moves no count here, and C7d gained nothing: five of its rows cited
    // the closed limit and every one of them had a second reason that outlived it.
    //
    // WAS 90/178 UNTIL 2026-08-14. C9's bind and the closed limit (A) added exactly 18 new C7a
    // entries, all weapon rows - the sixteen "+N to attack rolls and damage rolls" pairs plus
    // `flame-tongue`'s and `sword-of-wounding`'s on-hit dice. `luck-blade` and `frost-brand` gained
    // their weapon-scoped halves on entries they already had, which moves no count here.
    const authored = ITEM_MECHANICS_LANES.reduce((total, lane) => total + Object.keys(lane.entries).length, 0);
    expect(authored).toBe(108);
    expect(ROWS.length - authored).toBe(160);
  });
});

// -------------------------------------------------------------------------------------------------
// C7b's TWO CAST SWEEPS, WIDENED TO EVERY LANE
// -------------------------------------------------------------------------------------------------

/**
 * Every cast ANY lane authors, lane-attributed so a refusal names the lane as well as the item.
 *
 * LAZY, for the reason `item-mechanics-c7b.test.ts` states at its own copy: computed at module scope
 * this throws during COLLECTION when a lane is stripped from `index.ts`, and a probe that reports
 * "0 tests" is a weaker signal than a named failure by a distance.
 */
const authoredCasts = () => {
  expect(ITEM_MECHANICS_LANES.length, "no lane is composed into ITEM_MECHANICS_LANES at all").toBe(4);
  return ITEM_MECHANICS_LANES.flatMap((lane) =>
    Object.entries(lane.entries).flatMap(([itemId, mechanics]) =>
      (mechanics.casts ?? []).map((cast) => ({ lane: lane.lane, itemId, spellId: cast.spellId }))));
};

describe("the content program: the two cast rules apply to every lane, not just C7b", () => {
  it("walks a real population - the two sweeps below are vacuous if this number is ever 0", () => {
    const casts = authoredCasts();
    expect(casts).toHaveLength(43);
    expect(new Set(casts.map((cast) => cast.itemId)).size).toBe(29);
    // AND IT IS NOT ONE LANE'S. This is the whole point of widening: C7b's own sweep sees 28 of these.
    expect(Object.fromEntries(ITEM_MECHANICS_LANES.map((lane) => [lane.lane, casts.filter((cast) => cast.lane === lane.lane).length])))
      .toEqual({ C7a: 2, C7b: 28, C7c: 6, C7d: 7 });
  });

  it("names no spell whose damage roll carries no damage type - in ANY lane", () => {
    /**
     * `castAction` reads `spell.damage.roll` as the cast's damage and `spell.damage.types[0] ?? "force"`
     * as its type, so a record with dice and no type becomes a FORCE damage action. 24 of the 339
     * shipped spells are in that shape and they are a MIXTURE - healing, flat buffs, temporary hit
     * points, choose-your-type - so it is not a healing marker and must not be used as one. What it
     * reliably is, is a record that cannot say what one cast rolls. C7b removed seven casts over this
     * and guarded only its own lane; the reader is lane-blind, so the guard has to be.
     */
    for (const cast of authoredCasts()) {
      const spell = view.spellRecord!(cast.spellId);
      expect(spell, `${cast.lane}/${cast.itemId} casts "${cast.spellId}", which resolves to no spell record`).toBeDefined();
      const offends = spell!.damage?.roll != null && (spell!.damage?.types?.length ?? 0) === 0;
      expect(offends, `${cast.lane}/${cast.itemId} casts ${cast.spellId}, whose damage is ${JSON.stringify(spell!.damage)} - castAction types an untyped roll as "force", so this cast would deal Force damage to the ally it is pointed at. Record it as a named absence`).toBe(false);
    }
  });

  it("names no spell the record marks as an attack roll - in ANY lane", () => {
    // `attackRoll` is true for 42 of the 339 shipped spells and every occurrence this program reached
    // for was a false positive: the column is set by a mention of an attack roll ANYWHERE in the text,
    // including attack rolls other creatures make. A floor for the whole program while that is true.
    for (const cast of authoredCasts()) {
      const spell = view.spellRecord!(cast.spellId)!;
      expect(spell.attackRoll, `${cast.lane}/${cast.itemId} casts ${cast.spellId}, which the record marks attackRoll - castAction would hang an attack block on it`).toBe(false);
    }
  });
});

// -------------------------------------------------------------------------------------------------
// THE THREE RIDER FAMILIES NO LANE TEST CARRIES TO AN ENGINE OUTCOME
// -------------------------------------------------------------------------------------------------

/**
 * Each of these three was MEASURED by its lane and the measurement was left in a comment. A rider
 * family whose only proof is prose is one edit away from being a rider family nothing reads - which
 * is the failure the whole program is built around - so each is driven here instead.
 *
 * `item-mechanics-c7a.test.ts` asserts all three as SURVIVING FIELDS in the bundle
 * (`shipped("ammunition-3").modifiers` contains an `attack-bonus`, `shipped("sentinel-shield")`
 * contains a `roll-mode`, `shipped("demon-armor").cursed` is true) and stops there. A field surviving
 * the merge is not a number at a table.
 */
describe("the content program: the rider families held only by a bundle assertion, driven", () => {
  it("ammunition's attack-bonus lands on a RANGED to-hit and stays off a MELEE one", () => {
    const definition = definitionOf();
    const shot = (inventory: InventoryItem[], actionId: string) => {
      const state = fight(stateWith(inventory));
      const action = effectiveActions(definition, state.actors[0], catalog).find((entry) => entry.id === actionId)!;
      return resolveDefinitionAction(state, action, { actorId: IDS.hero, targetIds: [IDS.foe], commandId: "50000000-0000-4000-8000-000000000001" }, deps([9, 4], definition)).attack!.total;
    };
    // The bow and the mace come out of the SHIPPED catalog; the ammunition is picker-minted. d20 = 9.
    expect(shot([fromCatalog("longbow"), picked("ammunition-3")], "item-longbow"), "the +3 did not reach the shot").toBe(14);
    expect(shot([fromCatalog("longbow")], "item-longbow"), "the control: Dex +2 alone").toBe(11);
    // THE GATE. `attack-kind-is: ["ranged"]` is the whole reason this is not a blanket +3, and a magic
    // arrow that improved a mace swing would be the wrong number rather than a missing one.
    expect(shot([fromCatalog("mace"), picked("ammunition-3")], "item-mace"), "the arrow reached a melee swing").toBe(9);
  });

  it("a roll-mode rider really reaches the initiative die, on all three of its carriers", () => {
    const definition = definitionOf();
    for (const id of ["sentinel-shield", "weapon-of-warning", "rod-of-alertness"]) {
      expect(initiativeRollMode(stateWith([picked(id)]), IDS.hero, () => definition, catalog), `${id}: the authored advantage did not reach initiativeRollMode`).toBe("advantage");
      expect(initiativeRollMode(stateWith([picked(id, { equipped: false })]), IDS.hero, () => definition, catalog), `${id}: unequipping must be the un-grant`).toBe("normal");
    }
  });

  /**
   * THE HARVEST'S SECOND FAR END, AND IT SPANS TWO LANES - which is why it is here rather than in
   * either. `sentinel-shield` (C7a) and `rod-of-alertness` (C7b) print the SAME sentence,
   * *"Advantage on ... Wisdom (Perception) checks"*, and both had to be authored to the ABILITY
   * rather than the skill: `BUILTIN_CHECKS.search` is `{label: "Wisdom (Search)", ability: "wis"}`
   * with no `skill` key at all, and `skill-is` fails CLOSED against a narrow that carries none. A
   * `skill-is: ["perception"]` rider on either row would parse, ship, and fire on nothing - the exact
   * silence both modules recorded as an absence for two rounds.
   *
   * The negative control is the load-bearing half: the SAME rider must leave Hide and Study alone,
   * or "author to the ability" would mean "advantage on every check the engine rolls".
   */
  it("Wisdom (Perception) advantage reaches the SEARCH die on both its carriers, and no other check", () => {
    const searchWith = (id: string, n: number, over: Record<string, unknown> = {}) => {
      const definition = definitionOf();
      const state = fight(stateWith([picked(id, over)]));
      const resolution = resolveDefinitionAction(state, builtinAction("search")!, {
        actorId: IDS.hero, targetIds: [], commandId: `50000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`, builtin: true
      }, deps([6, 19], definition));
      return { resolution, formula: state.rolls.find((roll) => roll.purpose === "check")!.normalizedFormula };
    };

    // Wis 10 = +0, so the total IS the die and there is nowhere for a bonus to hide.
    for (const [n, id, name] of [[30, "sentinel-shield", "Sentinel Shield"], [31, "rod-of-alertness", "Rod of Alertness"]] as const) {
      const worn = searchWith(id, n);
      expect(worn.resolution.check, `${id}: Search did not keep the higher die`).toMatchObject({ skill: "Wisdom (Search)", naturalRoll: 19, total: 19 });
      expect(worn.formula).toBe("2d20kh1+0");
      expect(worn.resolution.rollMode).toEqual({ mode: "advantage", advantage: [name], disadvantage: [] });

      // THE CONTROL, and for the Rod it is ATTUNEMENT rather than the strap: `picked` sets `attuned`
      // from the row's own `attunement.required`, so dropping it is the SRD's own gate.
      const off = searchWith(id, n + 10, id === "rod-of-alertness" ? { attuned: false } : { equipped: false });
      expect(off.resolution.check, `${id}: taking it off must be the un-grant`).toMatchObject({ naturalRoll: 6, total: 6 });
      expect(off.formula).toBe("1d20+0");
      expect(off.resolution.rollMode).toBeUndefined();
    }

    // AND IT NARROWS. `ability-is: ["wis"]` must not touch Hide (dex) or Study (int).
    for (const [n, actionId, formula] of [[50, "hide", "1d20+2"], [51, "study", "1d20+3"]] as const) {
      const definition = definitionOf();
      const state = fight(stateWith([picked("sentinel-shield")]));
      const resolution = resolveDefinitionAction(state, builtinAction(actionId)!, {
        actorId: IDS.hero, targetIds: [], commandId: `50000000-0000-4000-8000-0000000000${n}`, builtin: true
      }, deps([6, 19], definition));
      expect(resolution.rollMode, `${actionId} must not see a Wisdom-narrowed rider`).toBeUndefined();
      expect(state.rolls.find((roll) => roll.purpose === "check")!.normalizedFormula).toBe(formula);
    }
  });

  it("a cursed item refuses to come off for a PLAYER and comes off for the GM", () => {
    const definition = definitionOf();
    for (const [id, name] of [["demon-armor", "Demon Armor"], ["shield-of-missile-attraction", "Shield of Missile Attraction"]] as const) {
      const worn = stateWith([picked(id)]);
      // The refusal is CAPTURED rather than asserted with `.toThrow`, so a curse that stopped being
      // read fails with the item's own id in the diff instead of "expected [Function] to throw".
      const attempt = (() => {
        try {
          setInventoryItem(worn, IDS.hero, picked(id, { equipped: false }), () => definition, { catalog, role: "player" });
          return "the player took it off";
        } catch (error) { return (error as Error).message; }
      })();
      expect({ id, attempt }).toEqual({ id, attempt: `${name} will not come off. Ask the GM.` });
      // The GM half is "remove curse", and it needs no new command.
      const gm = stateWith([picked(id)]);
      setInventoryItem(gm, IDS.hero, picked(id, { equipped: false }), () => definition, { catalog, role: "gm" });
      expect(gm.actors[0].inventory[0].equipped, `${id}: the GM must be able to take it off`).toBe(false);
    }
    // And the two are the whole population, so a third carrier appearing has to be looked at.
    expect(ROWS.filter((row) => row.cursed === true).map((row) => row.id)).toEqual(["demon-armor", "shield-of-missile-attraction"]);
  });
});
