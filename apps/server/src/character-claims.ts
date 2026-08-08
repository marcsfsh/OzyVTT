import type { ClientRole, GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";

export function claimCharacter(state: GameState, actorId: string, sessionId: string) {
  const actor = state.actors.find((item) => item.id === actorId && item.kind === "player-character");
  if (!actor) throw new CommandRejectedError("Character is unavailable.");
  // Archived characters are hidden from the player projection, which was the ONLY thing stopping a
  // claim - a client replaying an actorId it had seen before the archive could still claim one. The
  // refusal reuses the not-found wording on purpose: an archived character is unavailable, and the
  // message must not tell a player which ids exist behind the projection (no existence oracle).
  if (actor.archived) throw new CommandRejectedError("Character is unavailable.");
  // A LAUNCHED REPLAY'S CLONE is never claimable, and this is the enforcement point (D3). "Claims do
  // not resurrect" - the clone is unowned by design so nobody acts twice, which is exactly what makes
  // it read as "available" to a client that has not filtered its roster. Same wording as archived: the
  // refusal must not tell a player which ids exist behind the projection.
  if (actor.replaySceneId !== undefined) throw new CommandRejectedError("Character is unavailable.");
  if (actor.ownerSessionId && actor.ownerSessionId !== sessionId) throw new CommandRejectedError("That character is already claimed.");
  if (state.actors.some((item) => item.ownerSessionId === sessionId && item.id !== actorId)) throw new CommandRejectedError("Release your current character before claiming another one.");
  actor.ownerSessionId = sessionId;
}

export function releaseCharactersForSession(state: GameState, sessionId: string) {
  state.actors.forEach((actor) => { if (actor.ownerSessionId === sessionId) actor.ownerSessionId = null; });
}

export function forceReleaseCharacter(state: GameState, actorId: string, role: ClientRole) {
  if (role !== "gm") throw new CommandRejectedError("Only the GM can force-release a character.");
  const actor = state.actors.find((item) => item.id === actorId && item.kind === "player-character");
  if (!actor) throw new CommandRejectedError("Character is unavailable.");
  if (!actor.ownerSessionId) throw new CommandRejectedError("That character is not currently claimed.");
  actor.ownerSessionId = null;
}
