import type { Annotation, GameState, GmView, PlayerAnnotation, PlayerCombatView, PlayerHp, PlayerInitiativeEntry, PlayerRollRecord, PlayerView, PresenceStatus, RollRecord } from "@vtt/domain";
import { healthBandOf } from "./hit-points.js";

type PresenceLookup = (sessionId: string) => PresenceStatus | null;

/** Party members stay exact for each other; monster/NPC hit points reach players only as a coarse band. */
function playerHp(actor: GameState["actors"][number]): PlayerHp {
  return actor.kind === "player-character"
    ? { kind: "exact", current: actor.hp.current, maximum: actor.hp.maximum, temporary: actor.hp.temporary }
    : { kind: "band", band: healthBandOf(actor.hp) };
}

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
    return actor ? [{ actorId: actor.id, name: actor.name, score: entry.score, active: state.combat.active && state.combat.turnActorId === actor.id, health: healthBandOf(actor.hp) }] : [];
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
    annotations: state.combat.active ? projectPlayerAnnotations(state, playerSessionId, now) : [],
    // A hidden combatant's turn stays opaque: economy flags reset to idle rather than narrating its activity.
    turn: currentIsPublic ? { ...state.combat.turn } : { actionUsed: false, bonusActionUsed: false },
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => publicActorIds.has(actorId)),
    // A player sees only the saves their own claimed character owes. The source actor id never
    // crosses the wire, and a hidden source's name is masked so gm-only attackers stay unnarrated.
    pendingSaves: state.combat.pendingSaves
      .filter((entry) => { const target = state.actors.find((actor) => actor.id === entry.targetActorId); return target !== undefined && target.ownerSessionId !== null && target.ownerSessionId === playerSessionId; })
      .map(({ sourceActorId, ...entry }) => ({ ...entry, sourceName: sourceActorId !== null && !publicActorIds.has(sourceActorId) ? "A hidden threat" : entry.sourceName }))
  };
}

export function projectPlayerView(state: GameState, playerSessionId: string | undefined, presenceFor: PresenceLookup, now = Date.now()): PlayerView {
  return {
    revision: state.revision,
    combat: projectPlayerCombat(state, playerSessionId, now),
    actors: state.actors.filter((actor) => actor.visibility === "public").map((source) => {
      const { notes: _notes, ownerSessionId, hp: _exactHp, ...actor } = source;
      const mine = ownerSessionId !== null && ownerSessionId === playerSessionId;
      // Only your own claimed character's imported sheet travels to you; nobody else's does.
      const ownDefinition = mine && source.definitionId ? state.definitions.find((entry) => entry.id === source.definitionId)?.definition : undefined;
      return {
        ...actor,
        hp: playerHp(source),
        claimStatus: ownerSessionId === null ? "available" as const : mine ? "mine" as const : "claimed" as const,
        presence: ownerSessionId === null ? null : presenceFor(ownerSessionId),
        ...(ownDefinition ? { definition: ownDefinition } : {})
      };
    }),
    rolls: state.rolls.filter((roll) => visibleToPlayer(roll, playerSessionId)).map(safeRoll)
  };
}

export function projectGmView(state: GameState, presenceFor: PresenceLookup, now = Date.now()): GmView {
  return {
    ...state,
    // Ephemeral annotations (measurements ~5s, pings ~4s) must drop off the GM's own screen when
    // they expire, not only when the next add prunes state — the scheduled expiry re-broadcast
    // relies on this filter (the player/viewer projections already do the same).
    combat: { ...state.combat, annotations: state.combat.annotations.filter((annotation) => annotation.expiresAt === null || annotation.expiresAt > now) },
    actors: state.actors.map((actor) => ({ ...actor, presence: actor.ownerSessionId === null ? null : presenceFor(actor.ownerSessionId) }))
  };
}
