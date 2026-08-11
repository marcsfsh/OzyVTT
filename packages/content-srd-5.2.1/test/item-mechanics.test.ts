import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ITEM_MECHANICS } from "../scripts/item-mechanics/index.js";
import { applyItemMechanics } from "../scripts/item-mechanics/overlay.js";
import type { ItemMechanics, ItemMechanicsModule } from "../scripts/item-mechanics/overlay.js";
import { ITEM_REFUSED_MODIFIER_MESSAGE } from "../src/character-content.js";
import { loadMagicItems } from "../src/index.js";

/**
 * THE ITEM MECHANICS SEAM, held to what it claims.
 *
 * `magic-items.test.ts` owns the ETL's parsed columns. This file owns the OTHER half of the same
 * bundle - the hand-authored riders `scripts/item-mechanics/` merges in at build time - and the four
 * things that seam has to be true for four lanes to author into it concurrently:
 *
 *   1. a rider keyed to a real item LANDS on that row, in the bundle's own serialized form;
 *   2. a key matching no row FAILS the build naming the key, rather than authoring nothing;
 *   3. the empty overlay is a BYTE-FOR-BYTE no-op - the seam is inert until a lane fills it;
 *   4. a rider the schema refuses FAILS loudly rather than being dropped.
 *
 * THE FAR END HERE IS THE EMITTED FILE, and that is the whole product of a build-time seam. The
 * runtime that makes a landed rider take effect is not this unit's and is already proven across 13
 * criteria in `apps/server/test/item-riders.test.ts`; what was missing was a home for the riders
 * whose output survives the next `npm run build-magic-item-bundle`. So the assertions below end at
 * the exact bytes `build-magic-items.ts` would write, at a thrown refusal, or at a rendered message.
 *
 * `applyItemMechanics` is exercised directly because the ETL is a top-level script, not a module a
 * test can call - importing it would REWRITE the bundle - and because the interesting cases must
 * FAIL the build, which a test cannot observe by rebuilding.
 */

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, "../bundles/magic-items.v1.json");

/** The exact string `build-magic-items.ts` writes, reproduced from a row list. */
const emit = (rows: readonly unknown[]): string => `${JSON.stringify(rows, null, 1)}\n`;

const rows = loadMagicItems();
const committed = readFileSync(BUNDLE, "utf8");

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
    expect(emit(applyItemMechanics(rows, {}))).toBe(committed);
  });

  it("lands a rider on the real row, and on no other row, in the emitted bundle", () => {
    // `Cloak of Protection` - "You gain a +1 bonus to Armor Class and saving throws while you wear
    // this cloak" - is C7c's item and is NOT authored here. It is the sample because it is a row
    // whose id and shape are pinned by `magic-items.test.ts`; the rider below lives in this test
    // only and never reaches `scripts/item-mechanics/`.
    const overlay: ItemMechanicsModule = {
      "cloak-of-protection": { modifiers: [{ type: "armor-class", amount: 1 }] }
    };
    const merged = applyItemMechanics(rows, overlay);

    const landed = merged.find((row) => row.id === "cloak-of-protection")!;
    expect(landed.modifiers).toEqual([{ type: "armor-class", amount: 1, whileArmored: false, when: [] }]);
    // The merge re-parses the touched row, so the authored input form comes back out in the bundle's
    // OUTPUT form - `whileArmored` and the rider gate materialised, exactly as every other row's
    // columns are. An overlay that skipped the parse would write a row shaped unlike its neighbours.
    expect(rows.find((row) => row.id === "cloak-of-protection")!.modifiers).toEqual([]);

    // The far end again: the emitted bundle differs from the committed one, and ONLY here.
    const emitted = emit(merged);
    expect(emitted).not.toBe(committed);
    expect(committed).not.toContain("armor-class");
    expect(emitted.split("armor-class")).toHaveLength(2);
    expect(merged.filter((row, index) => row !== rows[index]).map((row) => row.id)).toEqual(["cloak-of-protection"]);
  });

  it("fails closed on a key that matches no row, naming the key", () => {
    // The typo'd or renamed id: the exact failure four concurrent lanes are most likely to commit,
    // and the one that would otherwise ship as a rider that parses and does nothing.
    expect(() => applyItemMechanics(rows, { "cloak-of-protecton": { tags: ["typo"] } })).toThrow(
      "item-mechanics: 1 of 1 overlay entry refused; the bundle is NOT written.\n" +
      "  cloak-of-protecton - no row in magic-items.v1.json carries this id, so the riders keyed to it would author nothing at all\n" +
      "Fix it in scripts/item-mechanics/ - a rider that cannot land is a rider that silently authors nothing, which is the failure this overlay exists to make loud."
    );
    // Several bad keys are reported TOGETHER - a lane fixes its module once, not once per run.
    expect(() => applyItemMechanics(rows, { "not-an-item": { tags: ["a"] }, "also-not": { tags: ["b"] } }))
      .toThrow(/2 of 2 overlay entries refused[\s\S]*not-an-item[\s\S]*also-not/);
  });

  it("fails closed on an entry that names no rider at all", () => {
    // An empty entry is indistinguishable from a forgotten one. The plan's shape for "we read this
    // item and it stays prose" is a COMMENT beside the entry, not an entry with nothing in it.
    expect(() => applyItemMechanics(rows, { "cloak-of-protection": {} })).toThrow(
      "cloak-of-protection - the entry names no rider; record a named absence as a comment beside it, not as an empty entry"
    );
  });

  it("surfaces the schema's refusal of an item-carrier modifier instead of swallowing it", () => {
    // `ITEM_REFUSED_MODIFIER_TYPES` is `["hit-points-per-level", "ability-score"]`, enforced by
    // `EquipmentReferenceSchema`'s superRefine. The seam does not re-implement that refusal - it
    // re-parses the merged row so the refusal arrives WITH the item id attached, at the seam, rather
    // than out of the bundle's final `z.array(...).parse` with nothing to say which item caused it.
    // `Amulet of Health` is one of the plan's seven refused items; C7c ships it as prose.
    expect(() => applyItemMechanics(rows, {
      "amulet-of-health": { modifiers: [{ type: "ability-score", ability: "con", amount: 4 }] }
    })).toThrow(`amulet-of-health - the schema refuses the merged row. modifiers.0.type: ${ITEM_REFUSED_MODIFIER_MESSAGE}`);

    // The other refusal on this carrier: a curse the bearer could drop by taking the item off. The
    // ETL parses `attunement` off the printed type line, and `boots-of-elvenkind` requires none.
    expect(rows.find((row) => row.id === "boots-of-elvenkind")!.attunement?.required).toBe(false);
    expect(() => applyItemMechanics(rows, { "boots-of-elvenkind": { cursed: true } })).toThrow(
      "boots-of-elvenkind - the schema refuses the merged row. cursed: A cursed item must require attunement - attunement is both what springs the curse and what reveals it."
    );

    // A malformed rider of any other shape is refused by the same path - the overlay has exactly one
    // validator and it is the bundle's own.
    expect(() => applyItemMechanics(rows, {
      "cloak-of-protection": { modifiers: [{ type: "armor-class", amount: 99 }] }
    })).toThrow(/cloak-of-protection - the schema refuses the merged row\. modifiers\.0\.amount:/);
  });

  it("holds every SHIPPED lane module to a real item id", () => {
    // The module-level guard each of C7a-C7d inherits: a lane whose module names an id the ETL does
    // not emit turns THIS test red, without anyone running the build. It is vacuous while
    // `ITEM_MECHANICS` is empty and becomes the lanes' guard the moment one lands, which is why it
    // is written now rather than four times later.
    expect(() => applyItemMechanics(rows, ITEM_MECHANICS)).not.toThrow();
    for (const id of Object.keys(ITEM_MECHANICS)) {
      expect(rows.map((row) => row.id), id).toContain(id);
    }
  });
});
