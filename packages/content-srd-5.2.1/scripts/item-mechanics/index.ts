/**
 * The item mechanics overlay, composed from one file per lane. `./overlay.ts` holds the vocabulary
 * and the merge; each lane module holds riders keyed by magic-item id.
 *
 * The lanes stay a list rather than an object spread: a spread would collapse two lanes keyed to the
 * same item id before `applyItemMechanics` could refuse the duplicate.
 *
 * Known gap: `slots` separates the two `wondrous-item` lanes, but nothing separates the two
 * `consumable` lanes on `spell-scroll` (both pass the category and slot checks). Neither authors it.
 */
import type { ItemMechanicsLane } from "./overlay.js";
import { CARRIED_AND_POTIONS } from "./carried-and-potions.js";
import { WANDS_RODS_RINGS } from "./wands-rods-rings.js";
import { WEAPONS_ARMOUR } from "./weapons-armour.js";
import { WORN_WONDROUS } from "./worn-wondrous.js";

export const ITEM_MECHANICS_LANES: readonly ItemMechanicsLane[] = [
  { lane: "C7a", categories: ["weapon", "armor", "shield", "ammunition"], entries: WEAPONS_ARMOUR },
  { lane: "C7b", categories: ["wand", "staff", "rod", "ring", "consumable"], entries: WANDS_RODS_RINGS },
  {
    lane: "C7c",
    categories: ["wondrous-item"],
    slots: ["neck", "shoulders", "head", "feet", "hands", "belt"],
    entries: WORN_WONDROUS
  },
  {
    lane: "C7d",
    categories: ["wondrous-item", "consumable"],
    slots: ["wondrous", "consumable"],
    entries: CARRIED_AND_POTIONS
  }
  // Categories are the ETL's `category` column; `slots` optionally narrows a lane by the `slot` column.
  // An entry on a row outside either fails the build.
];
