import type { Actor, GameState } from "@vtt/domain";
import type { ActorDefinition, InventoryItem } from "@vtt/schemas";
import { GameAccessDeniedError, type Initiator } from "./authorization.js";
import { containerOf } from "./containers.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { fighting, spendUtilize, type UtilizeSpent } from "./utilize.js";

/**
 * SRD 5.2.1 Interacting with Things: "You can interact with one object or feature of the environment for free, during
 * either your move or action ... If you want to interact with a second object, you need to take the Utilize action."
 * And the Attack action: "you can either equip or unequip one weapon when you make an attack as part of this action".
 * Opening a door, drawing or stowing a weapon and taking a thing out of a backpack each take one; outside a fight they
 * cost nothing. A player may interact only on its creature's own turn; the GM's housekeeping off the turn is free.
 */

/** What an interaction took: the free one, a draw that rode an attack, the Utilize action, or nothing. */
export type InteractionSpent = "free" | "attack" | UtilizeSpent;

/** Spends one object interaction: the turn's free one, then the Utilize action. `what` names it for a refusal. */
export function spendObjectInteraction(
  state: GameState,
  actor: Actor,
  initiator: Pick<Initiator, "role">,
  what: string,
  definition?: ActorDefinition
): InteractionSpent {
  if (!fighting(state, actor)) return null;
  if (state.combat.turnActorId !== actor.id) {
    if (initiator.role === "player") throw new GameAccessDeniedError(`${what} on ${actor.name}'s turn.`);
    return null;
  }
  if (state.combat.turn.objectInteractionUsed !== true) {
    state.combat = { ...state.combat, turn: { ...state.combat.turn, objectInteractionUsed: true } };
    return "free";
  }
  return spendUtilize(state, actor, initiator, what, { definition });
}

/** Draws or stows a weapon: with an attack of the Attack action not yet paired with one, free; else an object
 *  interaction. */
export function spendWeaponDraw(
  state: GameState,
  actor: Actor,
  initiator: Pick<Initiator, "role">,
  what: string,
  definition?: ActorDefinition
): InteractionSpent {
  if (!fighting(state, actor)) return null;
  const turn = state.combat.turn;
  if (state.combat.turnActorId === actor.id && (turn.attacksMade ?? 0) > (turn.attackDraws ?? 0)) {
    state.combat = { ...state.combat, turn: { ...turn, attackDraws: (turn.attackDraws ?? 0) + 1 } };
    return "attack";
  }
  return spendObjectInteraction(state, actor, initiator, what, definition);
}

/** Counts an attack the turn's actor makes in its Attack action, which may carry a weapon draw. */
export function countAttackForDraws(state: GameState, actorId: string): void {
  if (!state.combat.active || state.combat.turnActorId !== actorId) return;
  const turn = state.combat.turn;
  state.combat = { ...state.combat, turn: { ...turn, attacksMade: Math.min(50, (turn.attacksMade ?? 0) + 1) } };
}

/**
 * What a player's write to a carried row costs in a fight: drawing or stowing a weapon is a draw (free with an attack,
 * else the object interaction); taking a thing out of a container is the object interaction, or what the container
 * asks (a Bag of Holding's Utilize action; a Handy Haversack's Bonus Action, else its Utilize action); putting one in
 * is the object interaction. Armor and Shields have their own costs (`held-items.ts`).
 */
export function chargeHandling(
  state: GameState,
  actor: Actor,
  stored: InventoryItem | undefined,
  incoming: InventoryItem,
  role: "gm" | "player" | undefined,
  catalog: EquipmentCatalog | undefined,
  definition?: ActorDefinition
): void {
  if (role !== "player" || !stored || !fighting(state, actor)) return;
  const initiator = { role } as const;
  if (stored.containerId !== incoming.containerId) {
    const from = stored.containerId ? actor.inventory.find((row) => row.id === stored.containerId) : undefined;
    const retrieval = containerOf(from, catalog)?.retrieval;
    const what = from ? `Take ${incoming.name} out of ${from.name}` : `Put ${incoming.name} away`;
    if (retrieval === "utilize") spendUtilize(state, actor, initiator, what, { definition });
    else if (retrieval === "utilize-or-bonus-action")
      spendUtilize(state, actor, initiator, what, {
        definition,
        ...(state.combat.turn.bonusActionUsed ? {} : { bonusAction: true, anyone: true })
      });
    else spendObjectInteraction(state, actor, initiator, what, definition);
    return;
  }
  const drawn = (stored.equipped && stored.quantity > 0) !== (incoming.equipped && incoming.quantity > 0);
  const weapon = incoming.weapon !== undefined && incoming.armor === undefined;
  if (drawn && weapon)
    spendWeaponDraw(state, actor, initiator, `${incoming.equipped ? "Draw" : "Stow"} ${incoming.name}`, definition);
}
