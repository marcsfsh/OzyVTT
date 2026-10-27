import type { Actor, GameState } from "@vtt/domain";
import type { ActorDefinition, InventoryItem } from "@vtt/schemas";
import { effectiveSlot } from "@vtt/rules-5e";
import { CommandRejectedError } from "./game-store.js";
import { fighting as inFight, spendUtilize } from "./utilize.js";
import { storedArmorClass } from "./actor-roster.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";

/**
 * What putting armor on and taking it off costs in a fight, and what a dropped item takes from its holder's Armor Class
 * (SRD 5.2.1 Armor, Utilize, Unconscious).
 */

/** What a dropped staff or weapon gave its holder's Armor Class (a Staff of Power's +2) leaves with it, when its sheet
 *  and the catalog are at hand. */
export function refreshArmorClass(
  actor: Actor,
  source?: Readonly<{
    resolveDefinition?: (definitionId: string) => ActorDefinition | undefined;
    catalog?: EquipmentCatalog;
  }>
): void {
  const definition = actor.definitionId ? source?.resolveDefinition?.(actor.definitionId) : undefined;
  if (definition && source?.catalog) actor.armorClass = storedArmorClass(actor, definition, source.catalog);
}

/** The minutes donning and doffing take by armor weight (SRD Armor table: Light 1 and 1, Medium 5 and 1, Heavy 10
 *  and 5). */
const DONNING: Readonly<Record<"light" | "medium" | "heavy", readonly [donMinutes: number, doffMinutes: number]>> = {
  light: [1, 1],
  medium: [5, 1],
  heavy: [10, 5]
};

/** The weight band of a body armor row, read from how it adds Dexterity. */
function weightOf(armor: NonNullable<InventoryItem["armor"]>): "light" | "medium" | "heavy" {
  if (!armor.addDexModifier) return "heavy";
  return armor.dexModifierCap === null ? "light" : "medium";
}

/**
 * What putting armor on or taking it off costs in a fight, for a player's write: body armor takes minutes, so it
 * can't be donned or doffed then; a Shield takes the Utilize action on its holder's turn. The GM may change it at any
 * time. Throws when the write is refused.
 */
export function donInFight(
  state: GameState,
  actor: Actor,
  stored: InventoryItem | undefined,
  incoming: InventoryItem,
  slot: string | undefined,
  role: "gm" | "player" | undefined
): void {
  if (role !== "player" || !inFight(state, actor)) return;
  const was = (stored?.equipped ?? false) && (stored?.quantity ?? 0) > 0;
  const now = incoming.equipped && incoming.quantity > 0;
  if (was === now || incoming.armor === undefined) return;
  const kind = effectiveSlot({ slot, category: incoming.category });
  if (kind === "armor") {
    const [don, doff] = DONNING[weightOf(incoming.armor)];
    const minutes = now ? don : doff;
    throw new CommandRejectedError(
      `${now ? "Donning" : "Doffing"} ${incoming.name} takes ${minutes} ${minutes === 1 ? "minute" : "minutes"}, so it can't be done in a fight.`
    );
  }
  if (kind === "shield") spendUtilize(state, actor, { role: "player" }, `${now ? "Don" : "Doff"} ${incoming.name}`);
}
