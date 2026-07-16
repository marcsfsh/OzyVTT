import type { GameState, GmView, PlayerCombatView, PlayerInitiativeEntry, PlayerRollRecord, PlayerView, PresenceStatus, RollRecord } from "@vtt/domain";

type PresenceLookup = (sessionId: string) => PresenceStatus | null;

function visibleToPlayer(roll: RollRecord, playerSessionId?: string) {
  return roll.visibility === "public" || (roll.visibility === "self-only" && roll.initiatorSessionId === playerSessionId);
}

function safeRoll(roll: RollRecord): PlayerRollRecord {
  const { initiatorSessionId: _privateSession, ...visible } = roll;
  return visible;
}

export function projectPublicInitiative(state: GameState): readonly PlayerInitiativeEntry[] {
  const publicActors = new Map(state.actors.filter((actor) => actor.visibility === "public").map((actor) => [actor.id, actor]));
  return state.combat.initiative.flatMap((entry) => {
    const actor = publicActors.get(entry.actorId);
    return actor ? [{ actorId: actor.id, name: actor.name, score: entry.score, active: state.combat.active && state.combat.turnActorId === actor.id }] : [];
  });
}

export function projectPlayerCombat(state: GameState): PlayerCombatView {
  const initiative = projectPublicInitiative(state);
  const currentIsPublic = initiative.some((entry) => entry.active);
  return {
    active: state.combat.active,
    round: state.combat.round,
    turnActorId: currentIsPublic ? state.combat.turnActorId : null,
    mapAssetId: state.combat.active ? state.combat.mapAssetId : null,
    hiddenTurn: state.combat.active && state.combat.turnActorId !== null && !currentIsPublic,
    initiative
  };
}

export function projectPlayerView(state: GameState, playerSessionId: string | undefined, presenceFor: PresenceLookup): PlayerView {
  return {
    revision: state.revision,
    combat: projectPlayerCombat(state),
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
