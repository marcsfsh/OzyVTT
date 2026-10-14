/**
 * A one-entry probe lane for `build-magic-items.ts --overlay=<this file>`. It is a file because the
 * ETL runs as a spawned process. Never composed into a real bundle; the riders are deliberately
 * implausible so the assertions hold whatever the real lanes author on this row.
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
