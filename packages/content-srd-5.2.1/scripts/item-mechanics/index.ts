/**
 * THE ITEM MECHANICS OVERLAY, composed from one file per LANE.
 *
 * `./overlay.ts` holds the vocabulary and the merge; each `./<lane>.ts` holds one lane's riders,
 * keyed by magic-item id. This file is the only place that knows which lanes exist, and it is what
 * `../build-magic-items.ts` imports - so the ETL's input is one name whatever the lane count is.
 *
 * ADDING A LANE IS EXACTLY TWO BLOCKS HERE, and they are deliberately in two different places so the
 * four lanes' worktrees can be merged by hand without reading around a conflict: ONE `import` in the
 * import block, ONE `{ lane, categories, entries }` object in `ITEM_MECHANICS_LANES`, each in
 * alphabetical position by `lane`. Nothing else in this file moves.
 *
 * IT IS A LIST, NOT A SPREAD, AND THAT IS LOAD-BEARING. Composing the lanes with `{...a, ...b}` -
 * the shape this file shipped with at `6a0766f` - collapses two lanes keyed to the same item id by
 * JS last-wins before `applyItemMechanics` can see either. Measured through the real ETL: two lanes
 * both keyed to `cloak-of-protection` gave exit 0, "rows carrying overlay mechanics: 1", and one
 * lane's rider nowhere in the bundle. Kept as a LIST, both survive to the merge, which refuses them
 * by name. Every other guard a lane inherits is in `./overlay.ts`'s header.
 *
 * IT SHIPPED EMPTY AND NO LONGER IS. `docs/product/plan-content-program.md` C7a-C7d author the four
 * lanes; the seam landed at `6a0766f` composing nothing, then **C7a (weapons and armour)** and
 * **C7b (wands, staffs, rods, rings and the scroll)**. C7c and C7d are still absent - authoring one
 * of their items here would pre-empt a lane. `test/item-mechanics.test.ts` still holds the seam's own
 * guarantees: the EMPTY overlay is a byte-for-byte no-op, and the committed bundle is exactly what
 * the real ETL re-emits with whatever lanes are composed here.
 */
import type { ItemMechanicsLane } from "./overlay.js";
// one import line per lane module, alphabetical:
import { WANDS_RODS_RINGS } from "./wands-rods-rings.js";
import { WEAPONS_ARMOUR } from "./weapons-armour.js";

export const ITEM_MECHANICS_LANES: readonly ItemMechanicsLane[] = [
  { lane: "C7a", categories: ["weapon", "armor", "shield", "ammunition"], entries: WEAPONS_ARMOUR },
  { lane: "C7b", categories: ["wand", "staff", "rod", "ring", "consumable"], entries: WANDS_RODS_RINGS },
  // One block per lane, alphabetical by `lane`. Copy this shape exactly - the categories are the
  // `category` column the ETL emits, and an entry on a row outside them fails the build:
  //
  //   { lane: "C7a", categories: ["weapon", "armor", "shield", "ammunition"], entries: WEAPONS_ARMOUR },
  //   { lane: "C7b", categories: ["wand", "staff", "rod", "ring", "consumable"], entries: WANDS_RODS },
  //   { lane: "C7c", categories: ["wondrous-item"], entries: WONDROUS_WORN },
  //   { lane: "C7d", categories: ["consumable", "wondrous-item"], entries: POTIONS_CARRIED },
  //
  // C7c and C7d both own `wondrous-item` because the worn/carried line is the `slot` column, not the
  // category (plan §3 says so itself); what keeps those two off each other's items is the merge's
  // duplicate-id refusal, which names both lanes.
];
