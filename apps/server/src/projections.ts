import type { GameState, GmView, PlayerRollRecord, PlayerView, RollRecord } from "@vtt/domain";

function visibleToPlayer(roll: RollRecord, playerSessionId?: string) {
  return roll.visibility === "public" || (roll.visibility === "self-only" && roll.initiatorSessionId === playerSessionId);
}

function safeRoll(roll: RollRecord): PlayerRollRecord {
  const { initiatorSessionId: _privateSession, ...visible } = roll;
  return visible;
}

export function projectPlayerView(state: GameState, playerSessionId?: string): PlayerView {
  return {
    revision: state.revision,
    combat: state.combat,
    actors: state.actors.filter((actor) => actor.visibility === "public").map(({ notes: _notes, ownerSessionId: _owner, ...actor }) => actor),
    rolls: state.rolls.filter((roll) => visibleToPlayer(roll, playerSessionId)).map(safeRoll)
  };
}

export function projectGmView(state: GameState): GmView { return state; }
