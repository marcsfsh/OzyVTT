import type { GameState } from "@vtt/domain";
import { MAX_COUNTED_OPTIONS, MAX_OPTION_USE_COUNT, type Actor, type ActorDefinition } from "@vtt/schemas";
import { passiveOf } from "./availability-reasons.js";
import { builtinActionsFor } from "./builtin-actions.js";
import { effectiveActions } from "./effective-actions.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * The sheet's turn card: the options a player pins to it, and how often each option resolved for the character,
 * which fills the card before anything is pinned. Both live on the actor and reach only its owner and the GM.
 */

/** The options on a character's turn list, by id, with their names: what `actor:available-actions` lists, less what
 *  stays off the turn list. */
export function turnListOptions(
  actor: Actor,
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog
): ReadonlyMap<string, string> {
  const own = effectiveActions(definition, actor, catalog);
  const builtins = builtinActionsFor(definition).filter(
    (candidate) => !own.some((action) => action.id === candidate.id)
  );
  return new Map([
    ...own
      .filter((action) => passiveOf(action, false) === undefined)
      .map((action) => [action.id, action.name] as const),
    ...builtins.map((action) => [action.id, action.name] as const)
  ]);
}

/** Pins options to the character's turn card, each one of its current options; an empty list clears the pins. */
export function setFavourites(
  state: GameState,
  actorId: string,
  optionIds: readonly string[],
  deps: Readonly<{ definition: ActorDefinition | undefined; catalog: EquipmentCatalog }>
): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  const options = turnListOptions(actor, deps.definition, deps.catalog);
  const stranger = optionIds.find((id) => !options.has(id));
  if (stranger !== undefined)
    throw new CommandRejectedError(`That option can't be pinned: it isn't one of ${actor.name}'s options now.`);
  if (optionIds.length === 0) delete actor.favouriteOptionIds;
  else actor.favouriteOptionIds = [...optionIds];
}

/** Counts one use of an option for the character. Once the counts are full, the least used option gives way. */
export function countOptionUse(state: GameState, actorId: string, optionId: string): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) return;
  const counts = { ...actor.optionUseCounts };
  if (counts[optionId] === undefined && Object.keys(counts).length >= MAX_COUNTED_OPTIONS) {
    const [leastUsed] = Object.entries(counts).sort((left, right) => left[1] - right[1])[0]!;
    delete counts[leastUsed];
  }
  counts[optionId] = Math.min(MAX_OPTION_USE_COUNT, (counts[optionId] ?? 0) + 1);
  actor.optionUseCounts = counts;
}
