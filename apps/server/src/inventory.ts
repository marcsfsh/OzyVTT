import type { Actor, GameState } from "@vtt/domain";
import type { ActorDefinition, Currency, InventoryItem } from "@vtt/schemas";
import { abilityModifier, armorClassFromEquipment } from "@vtt/rules-5e";
import { CommandRejectedError } from "./game-store.js";

const MAX_ITEMS = 200;

/**
 * Re-derive Armor Class from the actor's equipped armor/shields (v6 #5). When the loadout has any equipped
 * armor or shield, AC becomes the derived value; otherwise it reverts to the definition's stored AC (so a
 * character with no tracked armor keeps their stat-block AC). Needs the definition for Dex + the base AC;
 * without it, leaves AC untouched.
 */
function reconcileArmorClass(actor: Actor, definition: ActorDefinition | undefined): void {
  if (!definition) return;
  const derived = armorClassFromEquipment(abilityModifier(definition.abilityScores.dex), actor.inventory);
  actor.armorClass = derived ?? definition.armorClass;
}

/** Upsert one inventory item by id; quantity 0 removes it. Owner-scoped by the caller. Re-derives AC from
 *  the resulting equipped armor/shields. */
export function setInventoryItem(state: GameState, actorId: string, item: InventoryItem, resolveDefinition: (definitionId: string) => ActorDefinition | undefined): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (item.quantity <= 0) actor.inventory = actor.inventory.filter((entry) => entry.id !== item.id);
  else {
    const index = actor.inventory.findIndex((entry) => entry.id === item.id);
    if (index >= 0) actor.inventory = actor.inventory.map((entry, position) => position === index ? { ...item } : entry);
    else {
      if (actor.inventory.length >= MAX_ITEMS) throw new CommandRejectedError("This character's pack is full - remove something first.");
      actor.inventory = [...actor.inventory, { ...item }];
    }
  }
  reconcileArmorClass(actor, actor.definitionId ? resolveDefinition(actor.definitionId) : undefined);
}

/** Set the whole coin purse. Owner-scoped by the caller. */
export function setCurrency(state: GameState, actorId: string, currency: Currency): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  actor.currency = { ...currency };
}
