import type { Annotation, GameState, GmView, PlayerAnnotation, PlayerCombatView, PlayerInitiativeEntry, PlayerRollRecord, PlayerView, PresenceStatus, RollRecord } from "@vtt/domain";

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

function visibleToPlayerAnnotation(state: GameState, annotation: Annotation, playerSessionId: string | undefined) {
  switch (annotation.visibility) {
    case "public": return true;
    case "gm-only": return false;
    case "owner-only":
    case "owner-gm": return annotation.ownerSessionId === playerSessionId;
    case "gm-actor": return playerSessionId !== undefined && state.actors.some((actor) => actor.id === annotation.visibleToActorId && actor.ownerSessionId === playerSessionId);
  }
}

function safeAnnotation(annotation: Annotation, playerSessionId: string | undefined): PlayerAnnotation {
  const { ownerSessionId, ...visible } = annotation;
  return { ...visible, mine: ownerSessionId === playerSessionId };
}

export function projectPlayerAnnotations(state: GameState, playerSessionId: string | undefined, now: number): readonly PlayerAnnotation[] {
  return state.combat.annotations
    .filter((annotation) => (annotation.expiresAt === null || annotation.expiresAt > now) && visibleToPlayerAnnotation(state, annotation, playerSessionId))
    .map((annotation) => safeAnnotation(annotation, playerSessionId));
}

export function projectPlayerCombat(state: GameState, playerSessionId?: string, now = Date.now()): PlayerCombatView {
  const initiative = projectPublicInitiative(state);
  const publicActorIds = new Set(state.actors.filter((actor) => actor.visibility === "public").map((actor) => actor.id));
  const currentIsPublic = initiative.some((entry) => entry.active);
  return {
    active: state.combat.active,
    round: state.combat.round,
    turnActorId: currentIsPublic ? state.combat.turnActorId : null,
    mapAssetId: state.combat.active ? state.combat.mapAssetId : null,
    hiddenTurn: state.combat.active && state.combat.turnActorId !== null && !currentIsPublic,
    initiative,
    tokens: state.combat.active ? state.combat.tokens.filter((token) => publicActorIds.has(token.actorId)) : [],
    annotations: state.combat.active ? projectPlayerAnnotations(state, playerSessionId, now) : []
  };
}

export function projectPlayerView(state: GameState, playerSessionId: string | undefined, presenceFor: PresenceLookup, now = Date.now()): PlayerView {
  return {
    revision: state.revision,
    combat: projectPlayerCombat(state, playerSessionId, now),
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
