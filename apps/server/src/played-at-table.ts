import type { Actor, GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";

/**
 * Characters played at the table (ADR-0042): the player keeps a printed sheet and tells the GM what they do. Such a
 * character can't be claimed, so it stays unclaimed and every prompt for it goes to the GM, as one for any unclaimed
 * character does.
 */

/** Whether a party character is played at the table now: the running encounter's choice for the characters it
 *  started with, otherwise the saved mark. */
export function playedAtTable(state: GameState, actor: Pick<Actor, "id" | "playedAtTable">): boolean {
  const chosen = state.combat.active ? state.combat.atTable?.[actor.id] : undefined;
  return chosen ?? actor.playedAtTable === true;
}

/**
 * The start's choice for each party character in it. A claimed character is on its player's device unless it is
 * released first; any other takes its saved mark where the start leaves it out.
 */
export function startingAtTable(
  state: GameState,
  actorIds: Iterable<string>,
  chosen: Readonly<Record<string, boolean>> = {}
): Record<string, boolean> {
  const atTable: Record<string, boolean> = {};
  for (const actorId of actorIds) {
    const actor = state.actors.find((candidate) => candidate.id === actorId);
    if (actor?.kind !== "player-character") continue;
    const claimed = actor.ownerSessionId !== null;
    if (chosen[actorId] === true && claimed)
      throw new CommandRejectedError(
        `${actor.name} is claimed on a player's device. Release the claim to play ${actor.name} at the table.`
      );
    atTable[actorId] = chosen[actorId] ?? (actor.playedAtTable === true && !claimed);
  }
  return atTable;
}

/** The GM marks a party character played at the table, or takes the mark off. Refused while it is claimed. */
export function setPlayedAtTable(state: GameState, actorId: string, atTable: boolean) {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  if (actor.kind !== "player-character")
    throw new CommandRejectedError("Only a party character is played at the table.");
  if (atTable && actor.ownerSessionId !== null)
    throw new CommandRejectedError(
      `${actor.name} is claimed on a player's device. Release the claim to play ${actor.name} at the table.`
    );
  if (atTable) actor.playedAtTable = true;
  else delete actor.playedAtTable;
}
