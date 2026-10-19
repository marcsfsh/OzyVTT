import type { InventoryItem } from "@vtt/schemas";
import { isItemActionId, itemActionRest } from "./item-actions.js";

/** The tag an item's own action leaves on its user while the item hovers beside it (SRD Animated Shield: "it leaps into
 *  the air and hovers in your space to protect you as if you were wielding it, leaving your hands free"). */
export const ANIMATED_ITEM_TAG = "animated-shield";

/** The rows their user animated, which protect it as if held and fill no hand while their effect lasts. The row is the
 *  longest inventory id the effect's action id starts with (`item-<rowId>-animate`). */
export function animatedRowIds(
  actor: Readonly<{
    inventory: readonly InventoryItem[];
    effects: readonly Readonly<{ tags: readonly string[]; sourceActionId?: string | null }>[];
  }>
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const effect of actor.effects) {
    const actionId = effect.sourceActionId;
    if (!effect.tags.includes(ANIMATED_ITEM_TAG) || !actionId || !isItemActionId(actionId)) continue;
    const rest = itemActionRest(actionId);
    const row = actor.inventory
      .filter((item) => rest === item.id || rest.startsWith(`${item.id}-`))
      .sort((a, b) => b.id.length - a.id.length)[0];
    if (row) ids.add(row.id);
  }
  return ids;
}
