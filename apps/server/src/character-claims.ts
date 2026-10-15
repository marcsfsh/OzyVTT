import type { GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";

export function claimCharacter(state: GameState, actorId: string, sessionId: string) {
  const actor = state.actors.find((item) => item.id === actorId && item.kind === "player-character");
  if (!actor) throw new CommandRejectedError("Character is unavailable.");
  // Archived characters can't be claimed by replaying a known actorId. Same wording as not-found so the
  // message doesn't reveal which ids exist behind the projection.
  if (actor.archived) throw new CommandRejectedError("Character is unavailable.");
  // A launched replay's clone is never claimable (it is unowned by design). Same wording, same reason.
  if (actor.replaySceneId !== undefined) throw new CommandRejectedError("Character is unavailable.");
  if (actor.ownerSessionId && actor.ownerSessionId !== sessionId)
    throw new CommandRejectedError("That character is already claimed.");
  if (state.actors.some((item) => item.ownerSessionId === sessionId && item.id !== actorId))
    throw new CommandRejectedError("Release your current character before claiming another one.");
  actor.ownerSessionId = sessionId;
}

export function releaseCharactersForSession(state: GameState, sessionId: string) {
  state.actors.forEach((actor) => {
    if (actor.ownerSessionId === sessionId) actor.ownerSessionId = null;
  });
}

/** GM-only, gated by the command: a reducer that trusts its caller. */
export function forceReleaseCharacter(state: GameState, actorId: string) {
  const actor = state.actors.find((item) => item.id === actorId && item.kind === "player-character");
  if (!actor) throw new CommandRejectedError("Character is unavailable.");
  if (!actor.ownerSessionId) throw new CommandRejectedError("That character is not currently claimed.");
  actor.ownerSessionId = null;
}
