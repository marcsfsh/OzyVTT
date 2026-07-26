import type { Annotation, GameState, GmView, PlayerAnnotation, PlayerCombatView, PlayerEffect, PlayerHp, PlayerInitiativeEntry, PlayerRollRecord, PlayerView, PresenceStatus, RollRecord } from "@vtt/domain";
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

/** Display labels for condition badges ("Prone", "Exhaustion 3") - public info, safe for players and the shared screen (which has no rules-reference lookup of its own). */
export function conditionLabels(actor: GameState["actors"][number]): readonly string[] {
  return actor.conditions.map((condition) => `${condition.id.split("-").map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join(" ")}${condition.level !== undefined ? ` ${condition.level}` : ""}`);
}

export function projectPublicInitiative(state: GameState): readonly PlayerInitiativeEntry[] {
  const publicActors = new Map(state.actors.filter((actor) => actor.visibility === "public").map((actor) => [actor.id, actor]));
  return state.combat.initiative.flatMap((entry) => {
    const actor = publicActors.get(entry.actorId);
    // Conditions travel as parallel ids + labels (like the viewer token) so players and the shared
    // screen render the same dots from one source; public actors only, so nothing hidden leaks.
    return actor ? [{ actorId: actor.id, name: actor.name, score: entry.score, active: state.combat.active && state.combat.turnActorId === actor.id, health: healthBandOf(actor.hp), conditionIds: actor.conditions.map((condition) => condition.id), conditions: conditionLabels(actor) }] : [];
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
    // A hidden combatant's turn stays opaque: economy flags (and the compound-action instance /
    // per-turn uses, which name stat-block action ids) reset to idle rather than narrating its activity.
    turn: currentIsPublic
      ? { actionUsed: state.combat.turn.actionUsed, bonusActionUsed: state.combat.turn.bonusActionUsed, actionInstance: state.combat.turn.actionInstance ? { actorId: state.combat.turn.actionInstance.actorId, components: { ...state.combat.turn.actionInstance.components } } : null, turnUses: { ...state.combat.turn.turnUses }, movementUsedFeet: state.combat.turn.movementUsedFeet }
      // Hidden turn: movement spent would narrate a hidden combatant's activity - reset with the rest.
      : { actionUsed: false, bonusActionUsed: false, actionInstance: null, turnUses: {}, movementUsedFeet: 0 },
    rulesMode: state.combat.rulesMode,
    rollMode: state.combat.rollMode,
    // The policy (not the GM-only pendingDamage proposals) rides to players so the runner can say
    // whether a hit is handed to the GM or applied directly.
    playerDamageMode: state.combat.playerDamageMode,
    // Public claimed-PC ids still owing an initiative roll (all public by construction), plus the mode -
    // a player checks whether their own id is here to show the "Roll initiative" prompt.
    pendingInitiative: state.combat.pendingInitiative.filter((actorId) => publicActorIds.has(actorId)),
    playerInitiativeMode: state.combat.playerInitiativeMode,
    underwater: state.combat.underwater,
    reactionsUsed: state.combat.reactionsUsed.filter((actorId) => publicActorIds.has(actorId)),
    // The fog mask travels verbatim - it IS what players render, and it carries geometry only.
    // Fog is never the security boundary: hidden actors/annotations are stripped above regardless.
    fog: { enabled: state.combat.fog.enabled, shapes: state.combat.fog.shapes.map((shape) => ({ ...shape })) },
    // legendaryUsed is deliberately absent: a monster's remaining legendary actions are GM knowledge
    // (same rationale as the stripped actionUses), and the pool never drives player-side UI.
    // The whole table is rewound when the GM is reviewing an earlier turn; players see only the flag
    // (a banner), never the turn labels - those can name hidden combatants.
    rewound: state.combat.historyCursor !== null,
    // A player sees only the saves their own claimed character owes. The source actor id never
    // crosses the wire, and a hidden source's name is masked so gm-only attackers stay unnarrated.
    pendingSaves: state.combat.pendingSaves
      .filter((entry) => { const target = state.actors.find((actor) => actor.id === entry.targetActorId); return target !== undefined && target.ownerSessionId !== null && target.ownerSessionId === playerSessionId; })
      .map(({ sourceActorId, endsEffects: _endsEffects, ...entry }) => ({
        ...entry,
        sourceName: sourceActorId !== null && !publicActorIds.has(sourceActorId) ? "A hidden threat" : entry.sourceName,
        // The on-fail effect's source ids never cross the wire either (same masking as effects);
        // concentration effect references (endsEffects) are server bookkeeping and are stripped.
        ...(entry.onFailEffect ? { onFailEffect: { ...entry.onFailEffect, sourceActorId: null, sourceName: entry.onFailEffect.sourceActorId !== null && !publicActorIds.has(entry.onFailEffect.sourceActorId) ? "A hidden threat" : entry.onFailEffect.sourceName } } : {})
      })),
    // Same boundary as saves: a player sees only their own claimed character's reaction prompts,
    // with the source actor id stripped and a hidden source's name masked.
    pendingReactions: state.combat.pendingReactions
      .filter((entry) => { const reactor = state.actors.find((actor) => actor.id === entry.actorId); return reactor !== undefined && reactor.ownerSessionId !== null && reactor.ownerSessionId === playerSessionId; })
      .map(({ sourceActorId, ...entry }) => ({ ...entry, sourceName: sourceActorId !== null && !publicActorIds.has(sourceActorId) ? "A hidden threat" : entry.sourceName }))
  };
}

/**
 * An effect as players see it (viewer safety): source ids never cross the wire, and a hidden
 * source's name is masked - a player learns "Grappled by A hidden threat", never who.
 */
function playerEffect(effect: GameState["actors"][number]["effects"][number], publicActorIds: ReadonlySet<string>): PlayerEffect {
  const { sourceActorId, sourceActionId: _sourceActionId, ...visible } = effect;
  return { ...visible, sourceName: sourceActorId !== null && !publicActorIds.has(sourceActorId) ? "A hidden threat" : effect.sourceName };
}

export function projectPlayerView(state: GameState, playerSessionId: string | undefined, presenceFor: PresenceLookup, now = Date.now()): PlayerView {
  // Archived characters (GM management, v4 #10) are hidden from players entirely, like gm-only actors.
  const publicActorIds = new Set(state.actors.filter((actor) => actor.visibility === "public" && !actor.archived).map((actor) => actor.id));
  return {
    revision: state.revision,
    combat: projectPlayerCombat(state, playerSessionId, now),
    actors: state.actors.filter((actor) => actor.visibility === "public" && !actor.archived).map((source) => {
      // Explicit strips: notes/ownerSessionId/hp (existing) plus effects (rebuilt masked below),
      // actionUses (limited-use spending names stat-block action ids - own claimed character only),
      // conditionImmunities and legendary resources (monster defenses are GM knowledge),
      // hitDice (a healing resource that tracks with exact HP - own claimed character only), and
      // archived (GM-only management flag).
      const { notes: _notes, ownerSessionId, hp: _exactHp, effects: _effects, actionUses, conditionImmunities: _conditionImmunities, legendary: _legendary, hitDice, spellSlots, pactSlots, preparedSpellIds, inventory, currency, healthDisplay: _healthDisplay, lastUsedAt: _lastUsedAt, archived: _archived, ...actor } = source;
      const mine = ownerSessionId !== null && ownerSessionId === playerSessionId;
      // Effective token-health display = the per-token override or the table default. The richer
      // bar/ring reaches players only when the GM aimed it at everyone (audience "all"); band stays
      // the coarse badge. Only the style crosses - the client derives the fill from `hp` (exact for
      // the owner, coarse band otherwise), so exact HP never leaks for someone else's token.
      const effectiveDisplay = source.healthDisplay ?? state.combat.healthDisplay;
      const sharedDisplayStyle = effectiveDisplay.audience === "all" && effectiveDisplay.style !== "band" ? effectiveDisplay.style : null;
      // Only your own claimed character's imported sheet travels to you; nobody else's does.
      const ownDefinition = mine && source.definitionId ? state.definitions.find((entry) => entry.id === source.definitionId)?.definition : undefined;
      return {
        ...actor,
        hp: playerHp(source),
        effects: source.effects.map((effect) => playerEffect(effect, publicActorIds)),
        claimStatus: ownerSessionId === null ? "available" as const : mine ? "mine" as const : "claimed" as const,
        presence: ownerSessionId === null ? null : presenceFor(ownerSessionId),
        ...(ownDefinition ? { definition: ownDefinition } : {}),
        ...(mine ? { actionUses: { ...actionUses } } : {}),
        // The pool's `entries` array is copied too - a player projection must never hand out a live
        // reference into GameState (same deep-copy rule as spellSlots/inventory below).
        ...(mine && hitDice ? { hitDice: { ...hitDice, entries: hitDice.entries.map((entry) => ({ ...entry })) } } : {}),
        // Sheet resources reach ONLY the owning player - never another player, never the viewer (which
        // projects separately). Same owner-gate as actionUses/hitDice above; viewer safety by construction.
        ...(mine ? { spellSlots: spellSlots === null ? null : spellSlots.map((slot) => ({ ...slot })), pactSlots: pactSlots === null ? null : { ...pactSlots }, preparedSpellIds: [...preparedSpellIds], inventory: inventory.map((item) => ({ ...item })), currency: { ...currency } } : {}),
        ...(sharedDisplayStyle ? { healthDisplay: { style: sharedDisplayStyle } } : {})
      };
    }),
    rolls: state.rolls.filter((roll) => visibleToPlayer(roll, playerSessionId)).map(safeRoll)
  };
}

export function projectGmView(state: GameState, presenceFor: PresenceLookup, now = Date.now()): GmView {
  return {
    ...state,
    // Ephemeral annotations (measurements ~5s, pings ~4s) must drop off the GM's own screen when
    // they expire, not only when the next add prunes state - the scheduled expiry re-broadcast
    // relies on this filter (the player/viewer projections already do the same).
    combat: { ...state.combat, annotations: state.combat.annotations.filter((annotation) => annotation.expiresAt === null || annotation.expiresAt > now) },
    actors: state.actors.map((actor) => ({ ...actor, presence: actor.ownerSessionId === null ? null : presenceFor(actor.ownerSessionId) }))
  };
}
