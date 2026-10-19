import type { Actor } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { laterSpellAction, upcastAction } from "./item-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";

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
