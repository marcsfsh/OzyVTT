import type { Actor } from "@vtt/domain";
import type { ActorAction, ActorDefinition, InventoryItem } from "@vtt/schemas";
import { holdsFeature } from "./class-features.js";
import { itemActionId, TWO_HANDED_SUFFIX } from "./item-actions.js";

/**
 * SRD 5.2.1 Pact of the Blade: the weapon a Warlock's bond holds (conjured, or a magic weapon bonded), which its
 * Bonus Action binds (`grants.bindsWeapon`, the effect tagged `pact-weapon`). Thirsting Blade: "You gain the Extra Attack
 * feature for your pact weapon only ... you can attack twice with the weapon instead of once when you take the Attack
 * action", and Devouring Blade: "The Extra Attack of your Thirsting Blade invocation confers two extra attacks rather
 * than one."
 */

/** The tag on the bond's effect. */
export const PACT_WEAPON_TAG = "pact-weapon";

/** The carried row the Warlock's bond holds, or null with no bond. */
export function pactWeaponRowId(actor: Pick<Actor, "effects">): string | null {
  return (
    actor.effects.find((effect) => effect.tags.includes(PACT_WEAPON_TAG) && effect.itemId !== undefined)?.itemId ?? null
  );
}

/** Whether an action is a swing of this row, in either grip. */
const swingsRow = (action: Pick<ActorAction, "id">, rowId: string) =>
  action.id === itemActionId(rowId) || action.id === itemActionId(rowId, TWO_HANDED_SUFFIX);

/** The pact weapon's swing with the attacks Thirsting Blade or Devouring Blade give it, made with it alone. */
export function withPactWeaponAttacks(
  action: ActorAction,
  actor: Pick<Actor, "effects">,
  definition: ActorDefinition | undefined
): ActorAction {
  if (!action.attack) return action;
  const rowId = pactWeaponRowId(actor);
  if (rowId === null || !swingsRow(action, rowId)) return action;
  const attacks = holdsFeature(definition, "devouring-blade", "Devouring Blade")
    ? 3
    : holdsFeature(definition, "thirsting-blade", "Thirsting Blade")
      ? 2
      : 1;
  if (attacks <= (action.attack.count ?? 1)) return action;
  return { ...action, attack: { ...action.attack, count: attacks, countWithItself: true } };
}

/** The rows a binding lets its wielder use as a Spellcasting Focus (a pact weapon). */
export function boundFocusRows(actor: Pick<Actor, "effects" | "inventory">): InventoryItem[] {
  const ids = new Set(
    actor.effects.flatMap((effect) => (effect.weapon?.focus && effect.itemId !== undefined ? [effect.itemId] : []))
  );
  return actor.inventory.filter((row) => ids.has(row.id) && row.quantity > 0);
}
