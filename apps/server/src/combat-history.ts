import type { GameState } from "@vtt/domain";
import { CommandRejectedError, TimelineConfirmationRequired, type TimelineOps } from "./game-store.js";
import { nextInitiativeTurn, previousInitiativeTurn } from "./encounter.js";

/**
 * Turn time-travel (#12): the store keeps a snapshot of the game at every turn boundary; Previous
 * restores the end state of the prior turn for the WHOLE table, Next steps forward through recorded
 * history (undoing nothing while unchanged), and any change made while rewound requires the GM to
 * confirm rewriting history - truncating the undone future - before play moves on. All decisions run
 * inside the store's serialized queue (GameStore.executeTimeline), so navigation can never race
 * another command.
 */

// Rolling window of turn-boundary snapshots retained per live fight. Generous enough that a whole
// session's fight is usually reviewable end-to-end; each snapshot is one full state JSON, so this is
// the memory/disk knob. The oldest boundaries evict once the window is full (only ever while live).
const CAP = 250;

export type TimelineOutcome =
  | { kind: "advanced" }
  | { kind: "rewound"; label: string }
  | { kind: "stepped"; label: string }
  | { kind: "resumed" }
  | { kind: "discarded"; label: string }
  | { kind: "rewrote"; label: string }
  | { kind: "legacy" };

/**
 * The slice of GameState a timeline restore rolls back: combat (minus scene prep and the timeline's
 * own bookkeeping, minus ephemeral timed annotations) plus each actor's hp/conditions. A mutation
 * that leaves this slice untouched - a dice roll, a claim, a ping, scene prep, a token image - never
 * dirties the timeline, so "nothing changed" resumes stay free of confirmation prompts.
 */
function restorableSlice(state: GameState): string {
  // fog is scene dressing, not combat state: revealing a corridor mid-review must neither dirty the
  // timeline ("discard changes?") nor re-black the players' map on a rewind.
  const { scenes: _scenes, activeSceneId: _activeSceneId, historyCursor: _cursor, historyDirty: _dirty, fog: _fog, annotations, ...combat } = state.combat;
  return JSON.stringify({
    combat: { ...combat, annotations: annotations.filter((annotation) => annotation.expiresAt === null) },
    // Rules-engine state (effects, dying, spent uses) restores with hp/conditions - a rewind must
    // undo a Rage grant or a death-save tick, or the strict engine reasons from corrupt state.
    // legendaryUsed rides the combat spread above for the same reason (spent legendary actions rewind).
    // The table-wide healthDisplay preference also rides that spread (like rulesMode/rollMode); the
    // per-token actor.healthDisplay override is cosmetic and deliberately stays out of the actor slice below.
    actors: state.actors.map((actor) => ({ id: actor.id, hp: actor.hp, conditions: actor.conditions, effects: actor.effects, deathSaves: actor.deathSaves, actionUses: actor.actionUses }))
  });
}

export function timelineDirtied(before: GameState, after: GameState): boolean {
  return restorableSlice(before) !== restorableSlice(after);
}

/** "Round 3 - Borin" (the current actor at the moment of capture; labels are GM-only downstream). */
export function turnLabel(state: GameState): string {
  const name = state.actors.find((actor) => actor.id === state.combat.turnActorId)?.name ?? "Unknown";
  return `Round ${state.combat.round} - ${name}`;
}

/**
 * Merge-restore a snapshot into the live state. Rolls back combat and each actor's hp/conditions;
 * deliberately KEEPS current: dice-roll history (append-only audit), character claims, roster
 * additions, actor cosmetics (name/size/token image), imported definitions, and scene prep. Timeline
 * lifecycle guarantees the snapshot's map matches the live fight (scene switches truncate history).
 */
export function applyTimelineRestore(state: GameState, snapshot: GameState, cursor: number | null) {
  const currentActorIds = new Set(state.actors.map((actor) => actor.id));
  const snapshotActors = new Map(snapshot.actors.map((actor) => [actor.id, actor]));
  // Defense in depth: guards reject roster removal while rewound, so snapshot combat should never
  // reference a missing actor - but a filtered restore beats a corrupted one if that ever regresses.
  const initiative = snapshot.combat.initiative.filter((entry) => currentActorIds.has(entry.actorId));
  if (initiative.length === 0) throw new CommandRejectedError("That turn references combatants that no longer exist.");
  const turnActorId = snapshot.combat.turnActorId !== null && currentActorIds.has(snapshot.combat.turnActorId) ? snapshot.combat.turnActorId : initiative[0].actorId;
  state.actors = state.actors.map((actor) => {
    const past = snapshotActors.get(actor.id);
    return past ? { ...actor, hp: structuredClone(past.hp), conditions: structuredClone(past.conditions), effects: structuredClone(past.effects), deathSaves: structuredClone(past.deathSaves), actionUses: structuredClone(past.actionUses) } : actor;
  });
  state.combat = {
    ...structuredClone(snapshot.combat),
    initiative,
    turnActorId,
    tokens: snapshot.combat.tokens.filter((token) => currentActorIds.has(token.actorId)),
    scenes: state.combat.scenes,
    activeSceneId: state.combat.activeSceneId,
    // Live fog survives the restore (it's excluded from the restorable slice for the same reason).
    fog: state.combat.fog,
    historyCursor: cursor,
    historyDirty: false
  };
}

/**
 * Previous: from live, park the present as a return-point and restore the last recorded boundary;
 * while rewound, step one boundary further back. If the GM changed things at this point in history,
 * moving demands confirmation - and confirming DISCARDS the changes in place (re-restores the viewed
 * snapshot) rather than moving, so an accidental edit is always recoverable without a rewrite.
 */
export function planPreviousTurn(state: GameState, timeline: TimelineOps, confirmDiscard: boolean): TimelineOutcome {
  const entries = timeline.entries();
  if (entries.length === 0) {
    // Fight predates the timeline (upgraded mid-encounter): keep the legacy pointer-move behavior.
    previousInitiativeTurn(state);
    return { kind: "legacy" };
  }
  const cursor = state.combat.historyCursor;
  if (cursor === null) {
    const last = entries[entries.length - 1];
    const snapshot = timeline.read(last.index);
    if (!snapshot) throw new CommandRejectedError("The timeline is out of sync - try again.");
    timeline.capture("return", turnLabel(state), state);
    applyTimelineRestore(state, snapshot, last.index);
    return { kind: "rewound", label: last.label };
  }
  if (state.combat.historyDirty) {
    if (!confirmDiscard) throw new TimelineConfirmationRequired("discard-changes", "Discard the changes made at this point in history?");
    const snapshot = timeline.read(cursor);
    if (!snapshot) throw new CommandRejectedError("The timeline is out of sync - try again.");
    const entry = entries.find((candidate) => candidate.index === cursor);
    applyTimelineRestore(state, snapshot, cursor);
    return { kind: "discarded", label: entry?.label ?? turnLabel(state) };
  }
  const prior = entries.filter((candidate) => candidate.index < cursor).at(-1);
  if (!prior) throw new CommandRejectedError("You're at the beginning of the recorded fight.");
  const snapshot = timeline.read(prior.index);
  if (!snapshot) throw new CommandRejectedError("The timeline is out of sync - try again.");
  applyTimelineRestore(state, snapshot, prior.index);
  return { kind: "stepped", label: prior.label };
}

/**
 * Next: live, capture this turn's end state and advance; rewound and unchanged, step forward through
 * the recorded boundaries (reaching the return-point resumes live play exactly - nothing undone);
 * rewound and CHANGED, require confirmRewrite, then truncate the undone future, capture the modified
 * state as the new boundary, and advance - the owner-specified history rewrite.
 */
export function planNextTurn(state: GameState, timeline: TimelineOps, confirmRewrite: boolean, advance: (state: GameState) => void = nextInitiativeTurn): TimelineOutcome {
  const cursor = state.combat.historyCursor;
  const entries = timeline.entries();
  if (cursor === null) {
    const label = turnLabel(state);
    timeline.capture("turn", label, state);
    // Cap the timeline: evict the oldest boundaries beyond CAP. Only ever happens while live, so the
    // cursor can never be left pointing below the pruned floor.
    const excess = entries.length + 1 - CAP;
    if (excess > 0 && entries.length >= excess) timeline.prune(entries[excess].index);
    advance(state);
    return { kind: "advanced" };
  }
  if (state.combat.historyDirty) {
    if (!confirmRewrite) throw new TimelineConfirmationRequired("rewrite-history", "Rewrite history from this turn? Every later turn will be undone.");
    const rewriteLabel = turnLabel(state);
    timeline.truncateFrom(cursor);
    state.combat = { ...state.combat, historyCursor: null, historyDirty: false };
    timeline.capture("turn", rewriteLabel, state);
    advance(state);
    return { kind: "rewrote", label: rewriteLabel };
  }
  const ahead = entries.find((candidate) => candidate.index > cursor);
  if (!ahead) throw new CommandRejectedError("The timeline is out of sync - try again.");
  const snapshot = timeline.read(ahead.index);
  if (!snapshot) throw new CommandRejectedError("The timeline is out of sync - try again.");
  if (ahead.kind === "return") {
    applyTimelineRestore(state, snapshot, null);
    timeline.remove(ahead.index);
    return { kind: "resumed" };
  }
  applyTimelineRestore(state, snapshot, ahead.index);
  return { kind: "stepped", label: ahead.label };
}
