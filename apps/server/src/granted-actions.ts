import type { Actor } from "@vtt/domain";
import type { ActorAction, ActorDefinition, InventoryItem } from "@vtt/schemas";
import { laterSpellAction, upcastAction } from "./item-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { outcomeAction } from "./item-outcomes.js";

/**
 * The actions a creature has from another creature's spell while its effect lasts (SRD Dragon's Breath: "the target
 * can take a Magic action to exhale"), at the numbers the spell was cast with: its save DC, its level and the damage
 * type picked then. The action keeps the spell's later-action id, so it is no new cast.
 */
export function grantedSpellActions(actor: Actor, catalog: EquipmentCatalog | undefined): ActorAction[] {
  return actor.effects.flatMap((effect) => {
    const granted = effect.grantedSpellAction;
    const spell = granted ? catalog?.spellRecord?.(granted.spellId) : undefined;
    const later = spell?.effect?.laterActions?.find((row) => row.name === granted!.name);
    if (!granted || !spell || !later) return [];
    const built = laterSpellAction(spell, later, {
      attackBonus: granted.attackBonus,
      saveDc: granted.saveDc,
      bearersDc: false,
      modifier: granted.modifier
    });
    const leveled = granted.level > spell.level ? upcastAction(built, spell, granted.level) : built;
    const { damageTypes: _types, ...action } = leveled;
    return [
      {
        ...action,
        description: `From ${spell.name}, while it lasts. ${action.description}`.slice(0, 12000),
        // The type was picked when the spell was cast, and every use deals it.
        damage: granted.damageType
          ? action.damage.map((part) => ({ ...part, type: granted.damageType! }))
          : action.damage
      }
    ];
  });
}

/** The item actions a creature's effects hand it while they last (a Feather Token's whip, after the token is gone), built
 *  from the item's record as its row would build them. */
export function grantedItemActions(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): ActorAction[] {
  return actor.effects.flatMap((effect) => {
    const granted = effect.grantedItemAction;
    const base = granted ? catalog?.equipmentRecord(granted.recordId) : undefined;
    if (!granted || !base) return [];
    const row: InventoryItem = {
      id: granted.rowId,
      name: base.name,
      quantity: 1,
      equipped: true,
      attuned: false,
      ...(granted.rowId !== granted.recordId ? { recordId: granted.recordId } : {}),
      ...(granted.variantId !== undefined ? { variantId: granted.variantId } : {})
    };
    const built = outcomeAction(row, granted.actionId, { catalog, definition });
    return built ? [built] : [];
  });
}
