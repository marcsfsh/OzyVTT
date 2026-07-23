import type { GameState } from "@vtt/domain";
import type { Currency, InventoryItem } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";

const MAX_ITEMS = 200;

/** Upsert one inventory item by id; quantity 0 removes it. Owner-scoped by the caller. */
export function setInventoryItem(state: GameState, actorId: string, item: InventoryItem): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (item.quantity <= 0) { actor.inventory = actor.inventory.filter((entry) => entry.id !== item.id); return; }
  const index = actor.inventory.findIndex((entry) => entry.id === item.id);
  if (index >= 0) actor.inventory = actor.inventory.map((entry, position) => position === index ? { ...item } : entry);
  else {
    if (actor.inventory.length >= MAX_ITEMS) throw new CommandRejectedError("This character's pack is full - remove something first.");
    actor.inventory = [...actor.inventory, { ...item }];
  }
}

/** Set the whole coin purse. Owner-scoped by the caller. */
export function setCurrency(state: GameState, actorId: string, currency: Currency): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  actor.currency = { ...currency };
}
