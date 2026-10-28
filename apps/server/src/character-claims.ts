import type { GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";
import { playedAtTable } from "./played-at-table.js";

export function claimCharacter(state: GameState, actorId: string, sessionId: string, now = Date.now()) {
  const actor = state.actors.find((item) => item.id === actorId && item.kind === "player-character");
  if (!actor) throw new CommandRejectedError("Character is unavailable.");
  // Archived characters can't be claimed by replaying a known actorId. Same wording as not-found so the
  // message doesn't reveal which ids exist behind the projection.
  if (actor.archived) throw new CommandRejectedError("Character is unavailable.");
  // A launched replay's clone is never claimable (it is unowned by design). Same wording, same reason.
  if (actor.replayEncounterId !== undefined) throw new CommandRejectedError("Character is unavailable.");
  if (actor.ownerSessionId && actor.ownerSessionId !== sessionId)
    throw new CommandRejectedError("That character is already claimed.");
  if (playedAtTable(state, actor)) throw new CommandRejectedError(`${actor.name} is played at the table.`);
  if (state.actors.some((item) => item.ownerSessionId === sessionId && item.id !== actorId))
    throw new CommandRejectedError("Release your current character before claiming another one.");
  actor.ownerSessionId = sessionId;
  actor.firstClaimedAt ??= now;
}

export function releaseCharactersForSession(state: GameState, sessionId: string) {
  state.actors.forEach((actor) => {
    if (actor.ownerSessionId === sessionId) actor.ownerSessionId = null;
  });
}

/**
 * GM-only, gated by the command: a reducer that trusts its caller. A character in the running fight is released only
 * on the GM's second yes (`inFight`), because the player loses their turn controls mid-fight. Returns the session
 * that held it, so that player can be told.
 */
export function forceReleaseCharacter(
  state: GameState,
  actorId: string,
  options: Readonly<{ inFight?: boolean }> = {}
) {
  const actor = state.actors.find((item) => item.id === actorId && item.kind === "player-character");
  if (!actor) throw new CommandRejectedError("Character is unavailable.");
  if (!actor.ownerSessionId) throw new CommandRejectedError("That character is not currently claimed.");
  const fighting = state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId);
  if (fighting && !options.inFight)
    throw new CommandRejectedError(
      `${actor.name} is in the encounter. Releasing ${actor.name} takes the player's turn controls away until someone claims ${actor.name} again.`,
      "in_encounter"
    );
  const sessionId = actor.ownerSessionId;
  actor.ownerSessionId = null;
  return { sessionId, name: actor.name };
}
