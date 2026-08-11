/**
 * THE ITEM MECHANICS OVERLAY, composed from one file per LANE.
 *
 * `./overlay.ts` holds the vocabulary and the merge; each `./<lane>.ts` holds one lane's riders,
 * keyed by magic-item id. This file is the only place that knows which lanes exist, and it is what
 * `../build-magic-items.ts` imports - so the ETL's input is one name whatever the lane count is.
 *
 * ADDING A LANE IS EXACTLY TWO LINES HERE, and they are deliberately in two different places so the
 * four lanes' worktrees can be merged by hand without reading around a conflict: ONE `import` in the
 * import block, ONE spread inside `ITEM_MECHANICS`, each in alphabetical position. Nothing else in
 * this file moves. A lane's own module-level guard is `applyItemMechanics` itself - every key it
 * contributes must name a real row in the generated bundle, or the build fails naming the key.
 *
 * IT SHIPS EMPTY, ON PURPOSE. `docs/product/plan-content-program.md` C7a-C7d author the four lanes;
 * this seam is C7's infrastructure and lands before any of them, so today it composes nothing and
 * `bundles/magic-items.v1.json` comes out byte-identical to what C6 committed
 * (`test/item-mechanics.test.ts` holds that). Authoring an item here would pre-empt a lane.
 */
import type { ItemMechanicsModule } from "./overlay.js";
// one import line per lane module, alphabetical

export const ITEM_MECHANICS: ItemMechanicsModule = {
  // one spread per lane, alphabetical: ...weaponsArmour,
};
