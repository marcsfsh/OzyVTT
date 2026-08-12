import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ITEM_MECHANICS_LANES } from "../scripts/item-mechanics/index.js";
import { applyItemMechanics, CARRIER_RIDER_DISPOSITION_MIRROR, CHECKED_SLUG_KEYS, OPEN_BY_DESIGN } from "../scripts/item-mechanics/overlay.js";
import type { ItemMechanics, ItemMechanicsLane } from "../scripts/item-mechanics/overlay.js";
import { ITEM_REFUSED_MODIFIER_MESSAGE } from "../src/character-content.js";
import { loadMagicItems } from "../src/index.js";
import { PROBE_TAG } from "./fixtures/item-mechanics-etl-probe.js";

/**
 * THE ITEM MECHANICS SEAM, held to what it claims.
 *
 * `magic-items.test.ts` owns the ETL's parsed columns. This file owns the OTHER half of the same
 * bundle - the hand-authored riders `scripts/item-mechanics/` merges in at build time - and the
 * things that seam has to be true for four lanes to author into it concurrently:
 *
 *   1. a rider keyed to a real item LANDS on that row, in the bundle's own serialized form;
 *   2. the empty overlay is a BYTE-FOR-BYTE no-op - in process AND through the real ETL;
 *   3. THE ETL ACTUALLY APPLIES IT. Everything else here calls `applyItemMechanics` directly, which
 *      is precisely why the hook needed its own test: measured before this file grew one, replacing
 *      step 7 with `const merged = rows;` left all 143 content tests green and `npm run check` at 0;
 *   4. every way a lane can author NOTHING fails the build, naming the lane and the item: a key no
 *      row carries, two lanes on one id, an entry outside its lane's categories, a present-but-empty
 *      rider list, a rider type nothing reads yet, a slug pointing into another bundle that nothing
 *      resolves, and a merged row the schema refuses.
 *
 * THE FAR END HERE IS THE EMITTED FILE, and that is the whole product of a build-time seam. The
 * runtime that makes a landed rider take effect is not this unit's and is already proven across 13
 * criteria in `apps/server/test/item-riders.test.ts`; what was missing was a home for the riders
 * whose output survives the next `npm run build-magic-item-bundle`. So the assertions below end at
 * the exact bytes `build-magic-items.ts` writes, at a thrown refusal, or at that script's own stdout.
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(here, "..");
const BUNDLE = join(packageRoot, "bundles/magic-items.v1.json");

/** The exact string `build-magic-items.ts` writes, reproduced from a row list. */
const emit = (rows: readonly unknown[]): string => `${JSON.stringify(rows, null, 1)}\n`;

const rows = loadMagicItems();
const committed = readFileSync(BUNDLE, "utf8");

/** One probe lane. `categories` defaults to the row's own so a test about X is not about categories. */
const lane = (entries: Record<string, ItemMechanics>, categories: readonly string[] = ["wondrous-item"], name = "C7-probe"): ItemMechanicsLane =>
  ({ lane: name, categories, entries });

/**
 * THE INFERENCE-BUDGET GUARD, the same TYPE assertion `bundle.test.ts` carries and for the same
 * reason: `EquipmentReferenceSchema` is the largest object in this package, and `ItemMechanics` is a
 * `Pick` off its `z.input`. If that expansion is ever truncated to `any` or `never` the values would
 * still merge and still validate at runtime - the schema re-parse is what makes the merge safe - but
 * a lane would silently lose every compile-time check on the riders it authors. `Has` fails to
 * compile on a missing key and on both collapse arms.
 */
type Has<T, K extends keyof T, Expected> =
  0 extends (1 & T[K]) ? never
  : [T[K]] extends [never] ? never
  : T[K] extends Expected ? true : never;
const _inferenceBudget: [
  Has<ItemMechanics, "modifiers", ReadonlyArray<unknown> | undefined>,
  Has<ItemMechanics, "casts", ReadonlyArray<unknown> | undefined>,
  Has<ItemMechanics, "grantsFeatIds", ReadonlyArray<unknown> | undefined>,
  Has<ItemMechanics, "cursed", boolean | undefined>
] = [true, true, true, true];
void _inferenceBudget;

describe("the item mechanics overlay", () => {
  it("is inert until a lane fills it: the empty overlay re-emits the committed bundle byte for byte", () => {
    // The far end is the FILE. `emit` is `build-magic-items.ts`'s own serialization, so this is the
    // exact string that script would write with the overlay empty - which is the proof the seam
    // added no bytes to a generated artifact. (Measured at the time of landing: both sides are
    // md5 98b9d52283d2349cf1a0cf81eea77d4c, 268 rows. The comparison is against the file rather
    // than that literal so a lane authoring riders updates one side and not two.)
    expect(emit(rows)).toBe(committed);
    expect(emit(applyItemMechanics(rows, []))).toBe(committed);
  });

  it("lands a rider on the real row, and on no other row, in the emitted bundle", () => {
    // `Cloak of Protection` is C7c's item and is NOT authored here - the riders below live in this
    // test only and never reach `scripts/item-mechanics/`. They are deliberately unmistakable
    // (`armor-class -3` on a cloak the SRD prints as +1, and a tag no reading produces) so that this
    // test keeps meaning what it says once a lane authors this row for real.
    const merged = applyItemMechanics(rows, [lane({
      "cloak-of-protection": { tags: ["overlay-probe"], modifiers: [{ type: "armor-class", amount: -3 }] }
    })]);

    const landed = merged.find((row) => row.id === "cloak-of-protection")!;
    expect(landed.modifiers).toEqual([{ type: "armor-class", amount: -3, whileArmored: false, when: [] }]);
    // The merge re-parses the touched row, so the authored input form comes back out in the bundle's
    // OUTPUT form - `whileArmored` and the rider gate materialised, exactly as every other row's
    // columns are. An overlay that skipped the parse would write a row shaped unlike its neighbours.
    expect(landed.modifiers).not.toEqual(rows.find((row) => row.id === "cloak-of-protection")!.modifiers);

    // The far end again: the emitted bundle differs from the INERT emission, and only on this row.
    // Compared against the inert emission rather than the committed file's literal contents, because
    // three of the four lanes are contracted to author `armor-class` into that file.
    const inert = emit(applyItemMechanics(rows, []));
    const emitted = emit(merged);
    expect(emitted).not.toBe(inert);
    expect(inert.split("overlay-probe")).toHaveLength(1);
    expect(emitted.split("overlay-probe")).toHaveLength(2);
    expect(merged.filter((row, index) => row !== rows[index]).map((row) => row.id)).toEqual(["cloak-of-protection"]);
  });

  it("fails closed on a key that matches no row, naming the lane and the key", () => {
    // The typo'd or renamed id: the exact failure four concurrent lanes are most likely to commit,
    // and the one that would otherwise ship as a rider that parses and does nothing.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protecton": { tags: ["typo"] } })])).toThrow(
      "item-mechanics: 1 refusal across 1 lane(s) and 1 entry; the bundle is NOT written.\n" +
      "  [C7-probe] cloak-of-protecton - no row in magic-items.v1.json carries this id, so the riders keyed to it would author nothing at all\n" +
      "Fix it in scripts/item-mechanics/ - a rider that cannot land is a rider that silently authors nothing, which is the failure this overlay exists to make loud."
    );
    // Several bad keys are reported TOGETHER - a lane fixes its module once, not once per run.
    expect(() => applyItemMechanics(rows, [lane({ "not-an-item": { tags: ["a"] }, "also-not": { tags: ["b"] } })]))
      .toThrow(/2 refusals across 1 lane\(s\) and 2 entries[\s\S]*not-an-item[\s\S]*also-not/);
  });

  it("refuses two lanes keyed to one item, naming both - the collision an object spread would have eaten", () => {
    /**
     * THE COMPOSITION DEFECT THIS SHAPE EXISTS TO FIX. `index.ts` composed the lanes with an object
     * spread until this change, so two lanes keyed to one id collapsed by JS last-wins BEFORE the
     * merge could see them. Measured through the real ETL at the time: exit 0, "rows carrying
     * overlay mechanics: 1", and the first lane's rider nowhere in the bundle.
     */
    const first = lane({ "cloak-of-protection": { modifiers: [{ type: "armor-class", amount: 1 }] } }, ["wondrous-item"], "C7c");
    const second = lane({ "cloak-of-protection": { modifiers: [{ type: "save-bonus", amount: 1 }] } }, ["wondrous-item"], "C7d");

    // The old shape, reproduced here so the regression is a fact in the file rather than a memory:
    // two lanes' work, one surviving key, no error anywhere.
    expect(Object.keys({ ...first.entries, ...second.entries })).toEqual(["cloak-of-protection"]);

    // The list shape keeps both, so the merge can see the collision and refuse it by name.
    expect(() => applyItemMechanics(rows, [first, second])).toThrow(
      '[C7d] cloak-of-protection - already authored by lane "C7c". Two lanes on one item silently collapse to one when composed, so the seam refuses instead; one item belongs to one lane'
    );
  });

  it("refuses an entry outside its lane's declared categories, naming both categories", () => {
    // `plan-content-program.md` §3 justifies the whole category split by claiming a lane authoring
    // outside its own category "fails the build the same way an unmatched key does". It did not:
    // before `categories`, a probe lane standing in for C7a authored a Potion and a Ring and the
    // build exited 0. `Potion of Climbing` is a `consumable`; C7a owns weapons and armour.
    expect(() => applyItemMechanics(rows, [lane(
      { "potion-of-climbing": { tags: ["misfiled"] } },
      ["weapon", "armor", "shield", "ammunition"],
      "C7a"
    )])).toThrow(
      '[C7a] potion-of-climbing - is a "consumable" and lane "C7a" owns "weapon", "armor", "shield", "ammunition". The lane split is by category (plan §3); author this item in the lane that owns it'
    );
  });

  it("refuses an entry outside its lane's declared SLOTS - the boundary category cannot draw", () => {
    // The category check above CANNOT separate C7c from C7d: both own `wondrous-item`, and 127 of the
    // 268 rows carry it, so for every one of them the check passes for both lanes and says nothing.
    // What was left holding that line was the duplicate-id refusal, which fires only once the OTHER
    // lane has already authored the item - so a C7c entry on a carried `Bag of Holding` lands, ships
    // and is found by a reader. `slots` is the same check one column further in.
    //
    // `bag-of-holding` is `wondrous-item` / slot `wondrous`; C7c owns the six WORN slots.
    expect(() => applyItemMechanics(rows, [{
      lane: "C7c", categories: ["wondrous-item"], slots: ["neck", "shoulders", "head", "feet", "hands", "belt"],
      entries: { "bag-of-holding": { tags: ["misfiled"] } }
    }])).toThrow(
      '[C7c] bag-of-holding - has slot "wondrous" and lane "C7c" owns "neck", "shoulders", "head", "feet", "hands", "belt". Two lanes share the "wondrous-item" category, so the slot is what divides them (plan §3); author this item in the lane that owns it'
    );

    // IT NARROWS, IT DOES NOT REPLACE. The same entry is still refused by CATEGORY when the slot
    // would have admitted it, so declaring `slots` cannot widen a lane past its categories.
    expect(() => applyItemMechanics(rows, [{
      lane: "C7c", categories: ["wondrous-item"], slots: ["neck", "ring"],
      entries: { "ring-of-protection": { tags: ["misfiled"] } }
    }])).toThrow(/is a "ring" and lane "C7c" owns "wondrous-item"/);

    // A lane that declares NO slots is checked exactly as it was - which is C7a and C7b, untouched.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": { tags: ["fine"] } })])).not.toThrow();

    // Present-but-empty admits no row at all, so it is refused at the lane the way `categories` is.
    expect(() => applyItemMechanics(rows, [{
      lane: "C7c", categories: ["wondrous-item"], slots: [], entries: { "cloak-of-protection": { tags: ["x"] } }
    }])).toThrow('lane "C7c" declares an empty "slots" list, which matches no row at all');
  });

  it("fails closed on an entry that names no rider at all, and on one whose riders are empty", () => {
    // An empty entry is indistinguishable from a forgotten one. The plan's shape for "we read this
    // item and it stays prose" is a COMMENT beside the entry, not an entry with nothing in it.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": {} })])).toThrow(
      "[C7-probe] cloak-of-protection - the entry names no rider; record a named absence as a comment beside it, not as an empty entry"
    );

    // The subtler half, and the one that was accepted silently: a PRESENT but empty rider list
    // satisfies "the key is there" and authors exactly as much as a missing key. Measured before
    // this check existed: `{modifiers: []}`, `{tags: []}` and `{casts: []}` were all accepted, left
    // the row byte-identical, and were counted by the console as authoring. A lane that writes
    // `modifiers: []` believes it authored something.
    for (const empty of [{ modifiers: [] }, { tags: [] }, { casts: [] }, { grantsFeatIds: [] }] as ItemMechanics[]) {
      const key = Object.keys(empty)[0];
      expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": empty })]), key).toThrow(
        `[C7-probe] cloak-of-protection - "${key}" is present but empty, which authors nothing. Drop the key, or author the rider you meant`
      );
    }
    // `grants: {}` and `cursed: false` are the same mistake wearing different clothes: both parse,
    // both leave the row byte-identical, and `false` is the schema's own default.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": { grants: {} } })])).toThrow(
      '[C7-probe] cloak-of-protection - "grants" is present but empty, which authors nothing'
    );
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": { cursed: false } })])).toThrow(
      '[C7-probe] cloak-of-protection - "cursed" is present but false, which is the default, which authors nothing'
    );
    // The row is byte-identical under every one of them - which is why none of them can be allowed
    // to pass as authoring.
    expect(emit(applyItemMechanics(rows, []))).toBe(committed);
  });

  it("refuses a top-level key it does not know, instead of silently dropping the typo", () => {
    /**
     * A REGRESSION FIX, 2026-08-11, and it is here because the hardening pass opened it while
     * closing six other holes — which is the ordinary risk of a hardening pass and the reason the
     * re-verification existed.
     *
     * `applyItemMechanics` builds the merged row by PICKING the nine known rider keys out of the
     * entry. That pick is deliberate — it is what stops a lane setting a PARSED column like `slot`
     * or `rarity` that the ETL owns — but it also meant a misspelled key was never handed to the
     * schema, so `.strict()`, which HAD caught it before the hardening, never saw it. The build then
     * exited 0 having authored only the half the author spelled correctly.
     *
     * The typo beside a REAL key is the shape that matters: with `modifiers` present and correct,
     * every other guard is satisfied and nothing else would ever have noticed.
     */
    expect(() => applyItemMechanics(rows, [lane({
      "cloak-of-protection": { modifers: [{ type: "armor-class", amount: 1 }], modifiers: [{ type: "armor-class", amount: 1 }] } as unknown as ItemMechanics
    })])).toThrow('[C7-probe] cloak-of-protection - "modifers" is not a rider key');

    // ...and the parsed columns the ETL owns are refused by the same check, which is what the pick
    // was protecting in the first place. A lane may not restate what the source printed.
    for (const owned of ["slot", "rarity", "attunement", "category", "description"]) {
      expect(() => applyItemMechanics(rows, [lane({
        "cloak-of-protection": { modifiers: [{ type: "armor-class", amount: 1 }], [owned]: "anything" } as unknown as ItemMechanics
      })]), owned).toThrow(`"${owned}" is not a rider key`);
    }
  });

  it("refuses a rider type no consumer reads yet, pointing at the disposition table", () => {
    // THE ADMISSION RULE, enforced. The plan's rule is "a lane authors a rider only when its reader
    // ships today", and the repo already knows which readers ship. Measured before this check:
    // `spell-attack-bonus` was accepted, and `CARRIER_RIDER_DISPOSITION` marks it "unread" -
    // "reaches derivation.spellAttackBonus; no spell-attack path reads it yet". Six items across
    // C7b and C7c are reserved for U26 for exactly this reason.
    expect(CARRIER_RIDER_DISPOSITION_MIRROR["spell-attack-bonus"]).toBe("unread");
    expect(() => applyItemMechanics(rows, [lane({
      "cloak-of-protection": { modifiers: [{ type: "spell-attack-bonus", amount: 1 }] }
    })])).toThrow(
      '[C7-probe] cloak-of-protection - modifiers.0 is "spell-attack-bonus", which CARRIER_RIDER_DISPOSITION (apps/server/src/character-build.ts) marks "unread": the rider reaches derivation and no consumer applies it yet, so it would change nothing at the table. Record it as a named absence in a comment, with the unit that unblocks it'
    );
    // Its readable sibling is not refused, so the check is about the disposition and not the family.
    expect(() => applyItemMechanics(rows, [lane({
      "cloak-of-protection": { modifiers: [{ type: "spell-save-dc", amount: 1 }] }
    })])).not.toThrow();
  });

  it("keeps the disposition mirror honest against the server's own table", () => {
    /**
     * THE MIRROR CANNOT SILENTLY ROT. `CARRIER_RIDER_DISPOSITION` lives in
     * `apps/server/src/character-build.ts` and is not exported; `apps/server` DEPENDS ON this
     * package, so importing it here would invert the dependency edge. The table is therefore copied
     * into `overlay.ts` and this test reads the server file as TEXT - a file read, not an import,
     * so no dependency is created - and holds the copy to it key for key.
     *
     * If a 22nd rider variant lands, or a rider's disposition changes from "unread" to a reader,
     * this test names the drift and the mirror is one line behind rather than quietly wrong.
     */
    const serverFile = readFileSync(join(packageRoot, "../../apps/server/src/character-build.ts"), "utf8");
    const block = serverFile.split("const CARRIER_RIDER_DISPOSITION")[1]?.split("\n};")[0] ?? "";
    const table = Object.fromEntries([...block.matchAll(/^\s*"?([a-z-]+)"?:\s*"([a-z-]+)"/gm)].map((match) => [match[1], match[2]]));
    expect(Object.keys(table).length, "the disposition table was not found in character-build.ts").toBeGreaterThan(10);
    expect(table).toEqual({ ...CARRIER_RIDER_DISPOSITION_MIRROR });
  });

  it("cross-checks every slug that points into another bundle, and says which id it meant", () => {
    /**
     * `casts[].spellId`, `grantsFeatIds[]` and the `grants.*` id lists are OPEN slugs by schema
     * (principle 3, so homebrew needs no schema change), which at authoring time makes a typo
     * invisible: it parses, it ships, and the runtime consequence is silence. C7b is 55 items whose
     * entire mechanic is `casts`, and `fire-ball` is the obvious typo for `fireball` - the spell
     * bundle ships `fireball`, `fire-bolt` and `delayed-blast-fireball`, and not `fire-ball`.
     */
    const refusals: Array<readonly [ItemMechanics, string]> = [
      [{ casts: [{ spellId: "fyre-ball" }] }, 'casts.0.spellId names "fyre-ball", which is no spell this content ships (bundles/spells.v1.json); did you mean "fireball"?'],
      [{ grantsFeatIds: ["not-a-real-feat"] }, 'grantsFeatIds.0 names "not-a-real-feat", which is no feat this content ships (bundles/feats.v1.json)'],
      [{ grants: { spells: [{ id: "not-a-spell" }] } }, 'grants.spells.0.id names "not-a-spell", which is no spell this content ships (bundles/spells.v1.json)'],
      [{ grants: { damageResistances: ["frost"] } }, 'grants.damageResistances.0 names "frost", which is no damage type this content ships (src/enums.ts DAMAGE_TYPE_IDS)'],
      [{ grants: { skills: ["basket-weaving"] } }, 'grants.skills.0 names "basket-weaving", which is no skill this content ships (bundles/skills.v1.json)'],
      [{ grants: { languages: ["mermish"] } }, 'grants.languages.0 names "mermish", which is no language this content ships (bundles/languages.v1.json)'],
      [{ grants: { conditionImmunities: ["asleep"] } }, 'grants.conditionImmunities.0 names "asleep", which is no condition this content ships (src/enums.ts CONDITION_IDS)'],
      // Nested inside a rider gate, four levels down, which is where a walker that only looked at
      // the top level would have stopped.
      [{ modifiers: [{ type: "attack-bonus", amount: 1, when: [{ type: "on-attack-roll" }, { type: "spell-id-is", spellIds: ["magic-missle"] }] }] },
        'modifiers.0.when.1.spellIds.0 names "magic-missle", which is no spell this content ships (bundles/spells.v1.json); did you mean "magic-missile"?'],
      [{ modifiers: [{ type: "save-bonus", amount: 1, when: [{ type: "while-condition", conditionIds: ["cursed"] }] }] },
        'modifiers.0.when.0.conditionIds.0 names "cursed", which is no condition this content ships (src/enums.ts CONDITION_IDS)'],
      [{ modifiers: [{ type: "spell-save-dc", amount: 1, classId: "wizzard" }] },
        'modifiers.0.classId names "wizzard", which is no class this content ships (bundles/classes.v1.json); did you mean "wizard"?'],
      // Inside an action's damage list, where the key is `type` and only its container says what it
      // means - `damage[].type` is a damage type, `modifiers[].type` is a discriminator.
      [{ actions: [{ id: "probe", name: "Probe", activation: "action", description: "Probe.", damage: [{ formula: "1d6", type: "frost" }] }] },
        'actions.0.damage.0.type names "frost", which is no damage type this content ships (src/enums.ts DAMAGE_TYPE_IDS)']
    ];
    for (const [mechanics, message] of refusals) {
      expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": mechanics })]), message).toThrow(message);
    }

    // And the same riders spelled correctly land, so the check is about resolution and not about the
    // shape - a cross-check that refused everything would pass every line above and block every lane.
    expect(() => applyItemMechanics(rows, [lane({
      "cloak-of-protection": {
        casts: [{ spellId: "fireball" }],
        grants: { skills: ["arcana"], damageResistances: ["cold"], languages: ["elvish"], spells: [{ id: "shield" }] },
        modifiers: [{ type: "attack-bonus", amount: 1, when: [{ type: "on-attack-roll" }, { type: "spell-id-is", spellIds: ["magic-missile"] }] }]
      }
    })])).not.toThrow();
  });

  it("names the slugs it deliberately leaves open, so a gap in the walker is a decision", () => {
    // A walker keyed by property name is only as good as its table, and "we did not think of it"
    // and "there is nothing to check it against" look identical in a walker's absence. The two
    // lists are disjoint and both are documented in `overlay.ts`.
    expect(CHECKED_SLUG_KEYS.filter((key) => OPEN_BY_DESIGN.includes(key))).toEqual([]);
    expect(CHECKED_SLUG_KEYS).toContain("spellId");
    expect(OPEN_BY_DESIGN).toContain("tags");
    // `tags` is the proof it is a decision: a lane may tag an item anything, and no bundle says
    // which tags exist, so an unresolvable tag is not a mistake.
    expect(() => applyItemMechanics(rows, [lane({ "cloak-of-protection": { tags: ["not-in-any-bundle"] } })])).not.toThrow();
  });

  it("surfaces the schema's refusal of an item-carrier modifier instead of swallowing it", () => {
    // `ITEM_REFUSED_MODIFIER_TYPES` is `["hit-points-per-level", "ability-score"]`, enforced by
    // `EquipmentReferenceSchema`'s superRefine. The seam does not re-implement that refusal - it
    // re-parses the merged row so the refusal arrives WITH the item id attached, at the seam, rather
    // than out of the bundle's final `z.array(...).parse` with nothing to say which item caused it.
    // `Amulet of Health` is one of the plan's seven refused items; C7c ships it as prose.
    expect(() => applyItemMechanics(rows, [lane({
      "amulet-of-health": { modifiers: [{ type: "ability-score", ability: "con", amount: 4 }] }
    })])).toThrow(`[C7-probe] amulet-of-health - the schema refuses the merged row. modifiers.0.type: ${ITEM_REFUSED_MODIFIER_MESSAGE}`);

    // The other refusal on this carrier: a curse the bearer could drop by taking the item off. The
    // ETL parses `attunement` off the printed type line, and `boots-of-elvenkind` requires none.
    expect(rows.find((row) => row.id === "boots-of-elvenkind")!.attunement?.required).toBe(false);
    expect(() => applyItemMechanics(rows, [lane({ "boots-of-elvenkind": { cursed: true } })])).toThrow(
      "[C7-probe] boots-of-elvenkind - the schema refuses the merged row. cursed: A cursed item must require attunement - attunement is both what springs the curse and what reveals it."
    );

    // A malformed rider of any other shape is refused by the same path - the overlay has exactly one
    // validator and it is the bundle's own.
    expect(() => applyItemMechanics(rows, [lane({
      "cloak-of-protection": { modifiers: [{ type: "armor-class", amount: 99 }] }
    })])).toThrow(/cloak-of-protection - the schema refuses the merged row\. modifiers\.0\.amount:/);
  });

  it("holds every SHIPPED lane to a real item id, its own categories and a name of its own", () => {
    // The module-level guard each of C7a-C7d inherits: a lane whose module names an id the ETL does
    // not emit, or an item another lane already claimed, turns THIS test red without anyone running
    // the build. It is vacuous while `ITEM_MECHANICS_LANES` is empty and becomes the lanes' guard the
    // moment one lands, which is why it is written now rather than four times later.
    expect(() => applyItemMechanics(rows, ITEM_MECHANICS_LANES)).not.toThrow();
    const names = ITEM_MECHANICS_LANES.map((entry) => entry.lane);
    expect(names, "two lanes cannot share a name - the refusals identify a lane by it").toEqual([...new Set(names)]);
    for (const entry of ITEM_MECHANICS_LANES) {
      expect(entry.categories.length, `${entry.lane} declares no categories`).toBeGreaterThan(0);
      // `slots` is optional; declared, it may not be empty (that narrows to no row at all).
      if (entry.slots !== undefined) expect(entry.slots.length, `${entry.lane} declares an empty slots list`).toBeGreaterThan(0);
      for (const id of Object.keys(entry.entries)) expect(rows.map((row) => row.id), `${entry.lane} / ${id}`).toContain(id);
    }
    // EVERY DECLARED SLOT MUST EXIST INSIDE THE LANE'S OWN CATEGORIES, or the narrowing is a typo
    // that silently refuses the lane's own items instead of the other lane's. Checked against the
    // committed rows rather than a list, so a slug the ETL renames is caught here.
    for (const entry of ITEM_MECHANICS_LANES) {
      for (const slot of entry.slots ?? []) {
        expect(rows.some((row) => entry.categories.includes(row.category) && row.slot === slot),
          `${entry.lane} declares slot "${slot}", which no row in its own categories carries`).toBe(true);
      }
    }
  });
});

describe("the ETL's overlay hook", () => {
  /**
   * THE ONE THING NO UNIT TEST ABOVE CAN REACH. `build-magic-items.ts` is a top-level script, and
   * with the overlay empty its merge is a no-op by construction - so nothing observable distinguishes
   * "the ETL applies the overlay" from "the ETL ignores it" on a normal run. Measured: replacing step
   * 7 with `const merged = rows;` left the content suite at 8 files / 143 tests green.
   *
   * So these two RUN THE REAL GENERATOR, through the same `node --import tsx` the npm script uses,
   * with `--out=` pointed at a scratch directory so the committed bundle is never touched.
   */
  const run = (...flags: readonly string[]): string =>
    execFileSync("node", ["--import", "tsx", "scripts/build-magic-items.ts", ...flags], { cwd: packageRoot, encoding: "utf8" });

  const scratch = mkdtempSync(join(tmpdir(), "item-mechanics-"));

  // The "- the seam is inert end to end" this title used to carry was true only while
  // `ITEM_MECHANICS_LANES` was empty; C7a landed 2026-08-11 and the run now reports 24 changed rows.
  // What the assertion always actually proved is REPRODUCIBILITY: the generator plus whatever lanes
  // are composed re-emits exactly the committed bytes.
  it("re-emits the committed bundle byte for byte on a real run", { timeout: 120_000 }, () => {
    const out = join(scratch, "inert.json");
    const stdout = run(`--out=${out}`);
    expect(stdout).toContain("wrote 268 magic items");
    expect(stdout).toMatch(/rows changed by the overlay: \d+/);
    // The far end: the bytes the generator writes today, against the bytes committed. This is also
    // what keeps `magic-items.v1.json` honest - a source or parser change that moves the bundle
    // without regenerating it turns this red.
    expect(readFileSync(out, "utf8")).toBe(committed);
  });

  it("applies the overlay it is given - a probe lane's rider reaches the emitted file", { timeout: 120_000 }, () => {
    const out = join(scratch, "probe.json");
    const stdout = run(`--out=${out}`, `--overlay=${join(here, "fixtures/item-mechanics-etl-probe.ts")}`);

    // The COUNT is of rows whose bytes moved, not of keys in the module - the console used to print
    // the latter and reported 1 while writing a bundle with no riders in it.
    expect(stdout).toContain("rows changed by the overlay: 1 (1 lane(s): C7-probe)");

    const emitted = JSON.parse(readFileSync(out, "utf8")) as Array<{ id: string; tags: string[]; modifiers: unknown[] }>;
    expect(emitted).toHaveLength(268);
    const landed = emitted.filter((row) => row.tags.includes(PROBE_TAG));
    expect(landed.map((row) => row.id)).toEqual(["cloak-of-protection"]);
    // In the bundle's OUTPUT form, materialised by the merge's re-parse - the same shape every other
    // row's columns carry.
    expect(landed[0].modifiers).toEqual([{ type: "armor-class", amount: -3, whileArmored: false, when: [] }]);
    // And the committed bundle is untouched by a run that wrote elsewhere.
    expect(readFileSync(BUNDLE, "utf8")).toBe(committed);
  });
});
