/**
 * A ONE-ENTRY PROBE LANE, and the only reason it is a FILE rather than an object inside a test: the
 * ETL is a top-level script, so the only way to hold it to APPLYING the overlay is to run it, and a
 * spawned process cannot be handed a value. `build-magic-items.ts --overlay=<this file>` reads
 * `ITEM_MECHANICS_LANES` from here instead of from `scripts/item-mechanics/index.ts`.
 *
 * IT AUTHORS NO CONTENT. It never reaches `scripts/item-mechanics/`, so it is in no bundle and
 * pre-empts no lane; `test/item-mechanics.test.ts` writes its output to a scratch directory. The
 * riders are chosen to be unmistakable rather than plausible - `armor-class -3` on a cloak whose SRD
 * text says +1, and a tag no reading of the SRD produces - so the assertions stay true whatever
 * C7a-C7d eventually author on this row.
 */
import type { ItemMechanicsLane } from "../../scripts/item-mechanics/overlay.js";

export const PROBE_TAG = "item-mechanics-etl-probe";

export const ITEM_MECHANICS_LANES: readonly ItemMechanicsLane[] = [
  {
    lane: "C7-probe",
    categories: ["wondrous-item"],
    entries: {
      "cloak-of-protection": { tags: [PROBE_TAG], modifiers: [{ type: "armor-class", amount: -3 }] }
    }
  }
];
