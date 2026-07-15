import type { ClientRole, GameState } from "@vtt/domain";
import { CommandRejectedError } from "./game-store.js";

export function claimCharacter(state: GameState, actorId: string, sessionId: string) {
  const actor = state.actors.find((item) => item.id === actorId && item.kind === "player-character");
  if (!actor) throw new CommandRejectedError("Character is unavailable.");
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
