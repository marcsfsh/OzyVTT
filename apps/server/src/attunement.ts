import type { Actor, GameState } from "@vtt/domain";
import type { EquipmentReference } from "@vtt/content-srd-5.2.1";
import { catalogIdOf, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { inShortRest } from "./rests.js";

/** "Requires Attunement by a Creature Attuned to a Belt of Dwarvenkind": the prerequisite names another item. */
const ATTUNED_TO = /^creature-attuned-to-an?-(.+)$/;

/** Whether the bearer meets one printed prerequisite: a class it has a level in, its species, being a spellcaster, or
 *  being attuned to another item. */
function meets(prerequisite: string, actor: Actor, definition: ActorDefinition | undefined, itemId: string): boolean {
  if (prerequisite === "spellcaster") return definition?.spellcasting !== undefined;
  const attunedTo = ATTUNED_TO.exec(prerequisite)?.[1];
  if (attunedTo !== undefined)
    return actor.inventory.some(
      (entry) => entry.id !== itemId && entry.attuned && entry.quantity > 0 && catalogIdOf(entry) === attunedTo
    );
  const character = definition?.character;
  if (!character) return false;
  return (
    character.classes.some((entry) => entry.id === prerequisite) ||
    character.race?.id === prerequisite ||
    character.race?.subrace?.id === prerequisite
  );
}

/** The prerequisite in plain words: "a Paladin", "a Spellcaster", "a creature attuned to a Belt of Dwarvenkind". */
export function prerequisiteName(prerequisite: string): string {
  const attunedTo = ATTUNED_TO.exec(prerequisite)?.[1];
  const words = (slug: string) =>
    slug
      .split("-")
      .map((word) => (word === "of" || word === "the" ? word : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(" ");
  if (attunedTo !== undefined) return `a creature attuned to a ${words(attunedTo)}`;
  return `a ${words(prerequisite)}`;
}

/**
 * Why a player can't attune to (or end attunement with) this copy now, or null. SRD Attunement: "a creature must
 * spend a Short Rest focused on only that item", and an item that requires attunement by a class, a species or a
 * spellcaster can be attuned only by one. Ending it on purpose takes "another Short Rest focused on the item". The
 * GM may attune anyone at any time, and a row removed or given away ends its attunement without a rest.
 */
export function attunementRefusal(
  state: GameState,
  actor: Actor,
  incoming: InventoryItem,
  stored: InventoryItem | undefined,
  definition: ActorDefinition | undefined,
  record: EquipmentReference | undefined
): string | null {
  if (record?.attunement?.required !== true || incoming.quantity <= 0) return null;
  const was = stored?.attuned === true;
  if (incoming.attuned === was) return null;
  const resting = inShortRest(state, actor.id) || actor.restStep !== null;
  if (incoming.attuned) {
    if (stored?.dormant === true) return `${incoming.name} has lost its magic, so there is nothing to attune to.`;
    const prerequisites = record.attunement.restrictedTo;
    if (prerequisites.length > 0 && !prerequisites.some((entry) => meets(entry, actor, definition, incoming.id)))
      return `${incoming.name} requires attunement by ${prerequisites.map(prerequisiteName).join(" or ")}.`;
    if (!resting)
      return `Attuning to ${incoming.name} takes a Short Rest focused on it. Start a Short Rest, then attune.`;
    return null;
  }
  // A Dragon Orb's charm: "you can't voluntarily end your Attunement to it".
  const holder = record.attunementHeldBy;
  if (holder !== undefined && actor.effects.some((effect) => effect.tags.includes(holder)))
    return `${incoming.name} holds ${actor.name} Charmed, so ${actor.name} can't end attunement to it.`;
  return resting
    ? null
    : `Ending attunement to ${incoming.name} takes a Short Rest focused on it. Start a Short Rest, then end it.`;
}
