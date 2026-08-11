/**
 * ============================================================================================
 * THE ITEM MECHANICS OVERLAY - hand-authored riders merged over the ETL-generated magic items
 * ============================================================================================
 *
 * `bundles/magic-items.v1.json` is GENERATED from `sources/dnd-5e-srd-markdown/magic-items.md` by
 * `../build-magic-items.ts`. That script's own header states the split this file is the other half
 * of: *"THIS ETL EMITS CONTENT, NOT MECHANICS. Every row lands with `isMagic`, `slot`, `rarity`,
 * `attunement` and prose; none lands with `modifiers`, `effects`, `actions`, `casts`, `uses` or
 * `cursed`."*
 *
 * Those riders cannot be authored where they land. A rider hand-edited into the generated bundle is
 * destroyed by the next `npm run build-magic-item-bundle`, silently and without a diff to notice.
 * So mechanics need a home the ETL READS, and this directory is it - the same answer
 * `scripts/class-mechanics/` already gives for classes: prose is generated, mechanics are authored,
 * and the ETL merges the two at build time. Nothing here is a runtime layer; each item still keeps
 * exactly ONE row in the bundle, so `loadMagicItems`, `loadEquipment`, the homebrew merge and every
 * consumer are unchanged.
 *
 * THIS OVERLAY MAY OVERWRITE FREELY, AND THAT IS THE ONE PLACE IT DIFFERS FROM THE CLASS OVERLAY.
 * `class-mechanics/overlay.ts` is additive-only and had to grow a `clears` verb, because
 * `classes.v1.json` is its ETL's INPUT as well as its output for the three `HAND_AUTHORED` classes -
 * so an unannounced overwrite there is a one-way, unreviewable edit to committed JSON. A generated
 * magic-item bundle has no such property: it is an OUTPUT ONLY, regenerable from a byte-pinned
 * vendored source with nothing hand-edited into it, and every run rebuilds each row from scratch
 * before this overlay is applied. `docs/product/plan-content-program.md` §1.5 is the ruling, and it
 * is the reason C6 emitted a separate bundle rather than appending 268 rows to the hand-authored
 * `equipment.v1.json`. **Do not copy `clears` here. There is nothing to announce.**
 *
 * A KEY THAT MATCHES NO ITEM IS A BUILD ERROR, not a silent no-op - the one discipline this file
 * DOES take from the class overlay verbatim. Four lanes author riders keyed by item id against a
 * bundle none of them generates; a typo'd or renamed id would otherwise be a rider that parses,
 * ships and does nothing, which is precisely the failure mode this whole area exists to end.
 *
 * THE REFUSAL IS THE SCHEMA'S, AND THIS FILE ONLY SURFACES IT. `ITEM_REFUSED_MODIFIER_TYPES`
 * (`src/character-content.ts`) forbids `hit-points-per-level` and `ability-score` on an ITEM carrier
 * because neither can be un-granted when the item comes off, and `EquipmentReferenceSchema`'s
 * `superRefine` enforces it - as it enforces that a cursed item must require attunement. So the
 * merge re-parses every row it touches through that schema and FAILS on the issues rather than
 * writing a row the bundle's own validator would reject later with no item id attached to it. A
 * second copy of the refusal here is exactly how items and feats would drift apart.
 *
 * ONE FILE PER LANE (`./weapons-armour.ts`, `./wands-rods.ts`, ...), composed by `./index.ts`, for
 * the reason the class overlay's header gives in its own words: *"A single object literal holding
 * twelve classes is one file that every content author has to edit ... The split is the difference
 * between four agents working and four agents merging."* Here it is four lanes over 268 items.
 */
import type { z } from "zod";
import { EquipmentReferenceSchema, type EquipmentReference } from "../../src/schemas.js";

/**
 * Typed off the schema's INPUT rather than its output, deliberately - the same call the class
 * overlay makes. An overlay entry is authored the way a bundle row is authored, so a `.default()`ed
 * key (`whileArmored` on an `armor-class` modifier, the `riderGate` fields on every modifier) should
 * not have to be restated. `applyItemMechanics` re-parses each merged row, which is where those
 * defaults materialise and where an authoring mistake stops the build.
 */
type ItemInput = z.input<typeof EquipmentReferenceSchema>;

/**
 * The rider keys an overlay may author on one magic item - READ OFF `EquipmentReferenceSchema`
 * rather than invented, so a key this list names but the schema drops is a compile error at the
 * `Pick` below instead of an entry that authors nothing.
 *
 * The first six are `featureRiders` (`src/character-content.ts`), spread onto the item schema
 * unchanged - which is what makes *"a feat carries the same buffs and debuffs an item does"* true by
 * construction. The last three are the magic-item vocabulary's own mechanical columns.
 *
 * WHAT IS DELIBERATELY NOT HERE is everything the ETL PARSES: `id`, `name`, `source`, `category`,
 * `description`, `costGp`, `weightLb`, `weapon`, `armor`, and the four identity columns `slot`,
 * `rarity`, `isMagic` and `attunement`. Those are read out of the vendored SRD text, they are pinned
 * by `test/magic-items.test.ts`, and an overlay that could rewrite them would be authoring content
 * the source already states - a second, hand-maintained home for a parsed fact. `attunement` is the
 * one worth naming: it is printed on the item's own type line ("(Requires Attunement by a Bard)")
 * and the parse of that line is what `cursed`'s refinement is checked against, so a lane that wants
 * a curse must find an item the SRD already gates behind attunement rather than gating it here.
 */
export type ItemRiderKey =
  | "tags" | "actions" | "effects" | "uses" | "grants" | "modifiers"
  | "cursed" | "casts" | "grantsFeatIds";

/** The riders ONE magic item may carry. Every key optional: an entry authors only what it names. */
export type ItemMechanics = Partial<Pick<ItemInput, ItemRiderKey>>;

/**
 * What ONE lane file contributes: riders by magic-item id, exactly as `bundles/magic-items.v1.json`
 * spells the id (`cloak-of-protection`, `wand-of-fireballs`, `weapon-1`).
 *
 * Flat rather than nested, unlike `MechanicsOverlay`'s (recordId, featureId) pair, because an item
 * id is not ambiguous the way a bare feature id is: `unarmored-defense` is a Barbarian feature AND a
 * Monk feature, but the ETL's own duplicate-id guard already proves every one of the 268 ids is
 * unique inside this bundle and collides with nothing in the other three.
 */
export type ItemMechanicsModule = Readonly<Record<string, ItemMechanics>>;

/** Where a Zod issue landed inside the merged row, for the refusal message. "" at the root. */
const where = (path: ReadonlyArray<string | number>): string => (path.length === 0 ? "" : `${path.join(".")}: `);

/**
 * Merge the overlay onto the generated rows and RETURN the merged rows.
 *
 * Rows the overlay does not name are returned BY REFERENCE, untouched and unparsed, so an empty
 * overlay is a byte-for-byte no-op on the emitted bundle - which is what makes this seam provably
 * inert until a lane fills it (`test/item-mechanics.test.ts` asserts exactly that against the
 * committed file). Rows it does name are re-parsed through `EquipmentReferenceSchema`, so the merged
 * row carries the same materialised defaults the ETL's own `parse` gives every other row.
 *
 * FAILS CLOSED, naming the entry, on all three ways an entry can author nothing:
 *
 *   1. the id matches no row in the bundle - a typo, or an item the ETL no longer emits;
 *   2. the entry names no rider at all - an empty `{}` is indistinguishable from a forgotten one,
 *      and a named absence belongs in a COMMENT beside the entry (the shape
 *      `class-mechanics/wizard.ts` uses for its prose-only records), never as an empty object;
 *   3. the schema refuses the merged row - the item carrier's two refused modifier types, a curse on
 *      an item that requires no attunement, a malformed action.
 *
 * It THROWS rather than returning a miss list (the class overlay's shape) because the caller here is
 * a script whose only response is to die, and because a throw is what lets the test assert the
 * message without spawning a build. Nothing is written on any of the three paths.
 */
export function applyItemMechanics(
  rows: readonly EquipmentReference[],
  overlay: ItemMechanicsModule
): EquipmentReference[] {
  const entries = Object.entries(overlay);
  if (entries.length === 0) return [...rows];

  const byId = new Map(rows.map((row) => [row.id, row]));
  const merged = new Map<string, EquipmentReference>();
  const refused: string[] = [];

  for (const [itemId, mechanics] of entries) {
    const row = byId.get(itemId);
    if (!row) {
      refused.push(`${itemId} - no row in magic-items.v1.json carries this id, so the riders keyed to it would author nothing at all`);
      continue;
    }
    const riders = Object.entries(mechanics).filter(([, value]) => value !== undefined);
    if (riders.length === 0) {
      refused.push(`${itemId} - the entry names no rider; record a named absence as a comment beside it, not as an empty entry`);
      continue;
    }
    const parsed = EquipmentReferenceSchema.safeParse({ ...row, ...Object.fromEntries(riders) });
    if (!parsed.success) {
      refused.push(`${itemId} - the schema refuses the merged row. ${parsed.error.issues.map((issue) => `${where(issue.path)}${issue.message}`).join(" | ")}`);
      continue;
    }
    merged.set(itemId, parsed.data);
  }

  if (refused.length > 0) {
    throw new Error(
      `item-mechanics: ${refused.length} of ${entries.length} overlay ${entries.length === 1 ? "entry" : "entries"} refused; the bundle is NOT written.\n` +
      `${refused.map((line) => `  ${line}\n`).join("")}` +
      `Fix it in scripts/item-mechanics/ - a rider that cannot land is a rider that silently authors nothing, which is the failure this overlay exists to make loud.`
    );
  }

  return rows.map((row) => merged.get(row.id) ?? row);
}
