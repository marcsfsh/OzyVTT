import type { GameState, GmView, PlayerRollRecord, PlayerView, PresenceStatus, RollRecord } from "@vtt/domain";

type PresenceLookup = (sessionId: string) => PresenceStatus | null;

function visibleToPlayer(roll: RollRecord, playerSessionId?: string) {
  return roll.visibility === "public" || (roll.visibility === "self-only" && roll.initiatorSessionId === playerSessionId);
}

function safeRoll(roll: RollRecord): PlayerRollRecord {
  const { initiatorSessionId: _privateSession, ...visible } = roll;
  return visible;
}

export function projectPlayerView(state: GameState, playerSessionId: string | undefined, presenceFor: PresenceLookup): PlayerView {
  return {
    revision: state.revision,
    combat: state.combat,
    actors: state.actors.filter((actor) => actor.visibility === "public").map(({ notes: _notes, ownerSessionId, ...actor }) => ({
      ...actor,
      claimStatus: ownerSessionId === null ? "available" as const : ownerSessionId === playerSessionId ? "mine" as const : "claimed" as const,
      presence: ownerSessionId === null ? null : presenceFor(ownerSessionId)
    })),
    rolls: state.rolls.filter((roll) => visibleToPlayer(roll, playerSessionId)).map(safeRoll)
  };
}

export function projectGmView(state: GameState, presenceFor: PresenceLookup): GmView {
  return {
    ...state,
    actors: state.actors.map((actor) => ({ ...actor, presence: actor.ownerSessionId === null ? null : presenceFor(actor.ownerSessionId) }))
  };
}
