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
 * IT SHIPPED EMPTY AND IS NOW FULL. `docs/product/plan-content-program.md` C7a-C7d author the four
 * lanes; the seam landed at `6a0766f` composing nothing, then **C7a (weapons and armour)**,
 * **C7b (wands, staffs, rods, rings and the scroll)**, **C7c (wondrous items you wear)** and
 * **C7d (wondrous items you carry, and the potions)** - all four, over all 268 rows.
 * `test/item-mechanics.test.ts` still holds the seam's own guarantees: the EMPTY overlay is a
 * byte-for-byte no-op, and the committed bundle is exactly what the real ETL re-emits with whatever
 * lanes are composed here.
 *
 * WHICH LANE-LEVEL CHECK ACTUALLY HOLDS EACH BOUNDARY, now that all four are here and two PAIRS
 * overlap. `slots` divides C7c from C7d cleanly: both declare `wondrous-item`, neither declares the
 * other's slots, so an entry on the wrong side fails the build by name.
 *
 * **IT DOES NOT DIVIDE C7b FROM C7d, AND ON ONE ROW NOTHING DOES.** They share the `consumable`
 * category; C7b declares no `slots` at all and is therefore checked by category alone; and the one
 * consumable C7b claims - `spell-scroll` - carries `slot: "consumable"`, which C7d also declares.
 * So BOTH lanes pass every lane-level check for that row. What would normally catch it is check 1,
 * the duplicate-id refusal - but that fires only once one lane has ALREADY authored the item, and
 * **C7b records `spell-scroll` as a named ABSENCE rather than authoring it** (its per-copy spell
 * cannot be said). So today an entry on `spell-scroll` in either lane would land quietly, which is
 * exactly the hole `slots` was added to close, still open for this single row. Neither lane authors
 * it and `apps/server/test/item-mechanics-c7d.test.ts` pins that; closing it properly means giving
 * C7b a `slots` declaration, which belongs to C7b rather than to a lane passing through.
 */
import type { ItemMechanicsLane } from "./overlay.js";
// one import line per lane module, alphabetical:
import { CARRIED_AND_POTIONS } from "./carried-and-potions.js";
import { WANDS_RODS_RINGS } from "./wands-rods-rings.js";
import { WEAPONS_ARMOUR } from "./weapons-armour.js";
import { WORN_WONDROUS } from "./worn-wondrous.js";

export const ITEM_MECHANICS_LANES: readonly ItemMechanicsLane[] = [
  { lane: "C7a", categories: ["weapon", "armor", "shield", "ammunition"], entries: WEAPONS_ARMOUR },
  { lane: "C7b", categories: ["wand", "staff", "rod", "ring", "consumable"], entries: WANDS_RODS_RINGS },
  { lane: "C7c", categories: ["wondrous-item"], slots: ["neck", "shoulders", "head", "feet", "hands", "belt"], entries: WORN_WONDROUS },
  { lane: "C7d", categories: ["wondrous-item", "consumable"], slots: ["wondrous", "consumable"], entries: CARRIED_AND_POTIONS },
  // One block per lane, alphabetical by `lane`. The four above ARE the shape to copy - a fifth lane
  // (homebrew, a later printing) adds one import and one line here and nothing else moves. The
  // categories are the `category` column the ETL emits, and an entry on a row outside them fails the
  // build.
  //
  // C7c and C7d both own `wondrous-item` because the worn/carried line is the `slot` column, not the
  // category (plan §3 says so itself) - which is why the lane shape grew an OPTIONAL `slots`, checked
  // and refused exactly as `categories` is. It NARROWS: C7a and C7b declare none and are checked
  // precisely as they were. Before it existed the only thing separating those two lanes was the
  // merge's duplicate-id refusal, which fires only once ONE of them has already authored the other's
  // item - so a C7c entry on a carried `Bag of Holding` landed and shipped.
];
