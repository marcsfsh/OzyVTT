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
 * lanes; the seam landed at `6a0766f` composing nothing, then **C7a (weapons and armour)**,
 * **C7b (wands, staffs, rods, rings and the scroll)** and **C7c (wondrous items you wear)**. C7d is
 * still absent - authoring one of its items here would pre-empt a lane, and the `slots` declaration
 * on C7c is now what refuses it by name rather than leaving the boundary to a later collision.
 * `test/item-mechanics.test.ts` still holds the seam's own guarantees: the EMPTY overlay is a
 * byte-for-byte no-op, and the committed bundle is exactly what the real ETL re-emits with whatever
 * lanes are composed here.
 */
import type { ItemMechanicsLane } from "./overlay.js";
// one import line per lane module, alphabetical:
import { WANDS_RODS_RINGS } from "./wands-rods-rings.js";
import { WEAPONS_ARMOUR } from "./weapons-armour.js";
import { WORN_WONDROUS } from "./worn-wondrous.js";

export const ITEM_MECHANICS_LANES: readonly ItemMechanicsLane[] = [
  { lane: "C7a", categories: ["weapon", "armor", "shield", "ammunition"], entries: WEAPONS_ARMOUR },
  { lane: "C7b", categories: ["wand", "staff", "rod", "ring", "consumable"], entries: WANDS_RODS_RINGS },
  { lane: "C7c", categories: ["wondrous-item"], slots: ["neck", "shoulders", "head", "feet", "hands", "belt"], entries: WORN_WONDROUS },
  // One block per lane, alphabetical by `lane`. Copy this shape exactly - the categories are the
  // `category` column the ETL emits, and an entry on a row outside them fails the build:
  //
  //   { lane: "C7a", categories: ["weapon", "armor", "shield", "ammunition"], entries: WEAPONS_ARMOUR },
  //   { lane: "C7b", categories: ["wand", "staff", "rod", "ring", "consumable"], entries: WANDS_RODS },
  //   { lane: "C7c", categories: ["wondrous-item"], slots: [...the six worn...], entries: WORN_WONDROUS },
  //   { lane: "C7d", categories: ["consumable", "wondrous-item"], slots: ["consumable", "wondrous"], entries: POTIONS_CARRIED },
  //
  // C7c and C7d both own `wondrous-item` because the worn/carried line is the `slot` column, not the
  // category (plan §3 says so itself) - which is why the lane shape grew an OPTIONAL `slots`, checked
  // and refused exactly as `categories` is. It NARROWS: C7a and C7b declare none and are checked
  // precisely as they were. Before it existed the only thing separating those two lanes was the
  // merge's duplicate-id refusal, which fires only once ONE of them has already authored the other's
  // item - so a C7c entry on a carried `Bag of Holding` landed and shipped.
];
