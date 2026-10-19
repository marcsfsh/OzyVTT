import type { GameState } from "@vtt/domain";
import { endEffectIfPresent, type EffectNarration } from "./effects.js";

type Actor = GameState["actors"][number];

/**
 * An effect bound to one carried weapon (Magic Weapon, Shillelagh, Sacred Weapon) ends once that row is no longer
 * carried: "This effect also ends if you aren't carrying the weapon." Run after a row leaves the pack or changes hands.
 */
export function endBindingsOfGoneRows(state: GameState, actor: Actor): EffectNarration[] {
  const carried = new Set(actor.inventory.filter((row) => row.quantity > 0).map((row) => row.id));
  return actor.effects
    .filter((effect) => effect.itemId !== undefined && !carried.has(effect.itemId))
    .flatMap((effect) => endEffectIfPresent(state, actor.id, effect.id));
}
