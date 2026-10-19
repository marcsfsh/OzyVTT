import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";
import { isItemActionId } from "./item-actions.js";
import { requireFastHands } from "./utilize.js";

/**
 * SRD Fast Hands (Thief 3): "Use an Object. Take the Utilize action, or take the Magic action to use a magic item that
 * requires that action" as a Bonus Action. A carried item's own action that takes the action is one of those (spreading
 * Caltrops, setting a Hunting Trap, a wand's Magic action); an attack with it is the Attack action, which Fast Hands
 * doesn't cover. Its Sleight of Hand check and the Utilize uses of tools and doors are `tool-uses.ts` and `doors.ts`.
 */

type Action = ActorDefinition["actions"][number];
type Actor = GameState["actors"][number];

/** Whether Fast Hands can take this action as a Bonus Action: an item's Utilize or Magic action. */
export function fastHandsAllows(action: Action): boolean {
  if (!isItemActionId(action.id) || action.activation !== "action") return false;
  return !(action.attack !== undefined && action.spellId === undefined) && action.replacesAttack !== true;
}

/** The action as Fast Hands takes it: a Bonus Action. Refused for a creature without the feature or an action it
 *  doesn't cover. */
export function withFastHands(action: Action, actor: Actor, definition: ActorDefinition | undefined): Action {
  requireFastHands(actor, definition);
  if (!fastHandsAllows(action))
    throw new CommandRejectedError(
      `Fast Hands takes an item's Utilize or Magic action as a Bonus Action, and ${action.name} isn't one.`
    );
  return { ...action, activation: "bonus-action" };
}
