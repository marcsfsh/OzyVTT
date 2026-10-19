import type { GameState } from "@vtt/domain";
import { CommandRejectedError, TimelineConfirmationRequired, type TimelineOps } from "./game-store.js";
import { nextInitiativeTurn, previousInitiativeTurn } from "./encounter.js";

/** Turn time travel over per-boundary snapshots. Previous restores the prior turn for the whole table;
 *  Next steps forward; changes made while rewound need GM confirmation to rewrite history. Runs inside
 *  the store's serialized queue (`GameStore.executeTimeline`). */

// Turn-boundary snapshots kept per live fight. Each is a full state JSON, so this is the memory/disk
// knob; the oldest evict once full (only while live).
const CAP = 250;

export type TimelineOutcome =
  | { kind: "advanced" }
  | { kind: "rewound"; label: string }
  | { kind: "stepped"; label: string }
  | { kind: "resumed" }
  | { kind: "discarded"; label: string }
  | { kind: "rewrote"; label: string }
  | { kind: "legacy" };

/** The slice a restore rolls back: combat (minus scene prep, timeline fields and timed annotations) plus each
 *  actor's hp, conditions, effects and spent resources. Changes outside it never dirty the timeline. */
function restorableSlice(state: GameState): string {
  // Fog, terrain and vision (walls, doors, lights, what the party has seen) are scene dressing: editing them
  // mid-review must neither dirty the timeline nor be undone by a rewind.
  const {
    scenes: _scenes,
    activeSceneId: _activeSceneId,
    historyCursor: _cursor,
    historyDirty: _dirty,
    fog: _fog,
    terrain: _terrain,
    vision: _vision,
    annotations,
    ...combat
  } = state.combat;
  return JSON.stringify({
    combat: { ...combat, annotations: annotations.filter((annotation) => annotation.expiresAt === null) },
    // Rules-engine state (effects, dying, spent uses) restores with hp/conditions, so a rewind undoes a Rage
    // or a death-save tick. legendaryUsed and the table-wide healthDisplay ride the combat spread; the
    // per-token healthDisplay override is cosmetic and stays out.
    actors: state.actors.map((actor) => ({
      id: actor.id,
      hp: actor.hp,
      conditions: actor.conditions,
      effects: actor.effects,
      deathSaves: actor.deathSaves,
      death: actor.death,
      actionUses: actor.actionUses,
      // A rewound Fireball gives its slot back; a rewound Short Rest its Hit Dice.
      spellSlots: actor.spellSlots,
      pactSlots: actor.pactSlots,
      hitDice: actor.hitDice
    }))
  });
}

export function timelineDirtied(before: GameState, after: GameState): boolean {
  return restorableSlice(before) !== restorableSlice(after);
}

/** "Round 3 · Borin" (the current actor at capture; labels are GM-only downstream). */
export function turnLabel(state: GameState): string {
  const name = state.actors.find((actor) => actor.id === state.combat.turnActorId)?.name ?? "Unknown";
  return `Round ${state.combat.round} · ${name}`;
}

/** Merge-restores a snapshot: rolls back combat and actor hp/conditions; keeps roll history, claims, roster
 *  additions, cosmetics, definitions and scene prep. */
export function applyTimelineRestore(state: GameState, snapshot: GameState, cursor: number | null) {
  const currentActorIds = new Set(state.actors.map((actor) => actor.id));
  const snapshotActors = new Map(snapshot.actors.map((actor) => [actor.id, actor]));
  // Defense in depth: roster removal is refused while rewound, but filter anyway so state can't be corrupted.
  const initiative = snapshot.combat.initiative.filter((entry) => currentActorIds.has(entry.actorId));
  if (initiative.length === 0) throw new CommandRejectedError("That turn references combatants that no longer exist.");
  const turnActorId =
    snapshot.combat.turnActorId !== null && currentActorIds.has(snapshot.combat.turnActorId)
      ? snapshot.combat.turnActorId
      : initiative[0].actorId;
  state.actors = state.actors.map((actor) => {
    const past = snapshotActors.get(actor.id);
    if (!past) return actor;
    const { death: _death, ...living } = actor;
    return {
      ...living,
      hp: structuredClone(past.hp),
      conditions: structuredClone(past.conditions),
      effects: structuredClone(past.effects),
      deathSaves: structuredClone(past.deathSaves),
      // A rewound death takes its time of death with it.
      ...(past.death ? { death: structuredClone(past.death) } : {}),
      actionUses: structuredClone(past.actionUses),
      spellSlots: structuredClone(past.spellSlots),
      pactSlots: structuredClone(past.pactSlots),
      hitDice: structuredClone(past.hitDice)
    };
  });
  state.combat = {
    ...structuredClone(snapshot.combat),
    initiative,
    turnActorId,
    tokens: snapshot.combat.tokens.filter((token) => currentActorIds.has(token.actorId)),
    scenes: state.combat.scenes,
    activeSceneId: state.combat.activeSceneId,
    // Live fog, terrain and vision survive the restore (excluded from the restorable slice for the same reason).
    fog: state.combat.fog,
    terrain: state.combat.terrain,
    vision: state.combat.vision,
    historyCursor: cursor,
    historyDirty: false
  };
}

/** A scene swap or replay launch invalidates the snapshots, which belonged to the fight that parked. The
 *  resumed fight gets a fresh baseline, so Previous restores it and does more than move the turn pointer,
 *  which made the next Next tick durations and roll Recharge a second time. */
export function restartTimeline(state: GameState, timeline: TimelineOps) {
  timeline.truncateAll();
  if (state.combat.active && state.combat.turnActorId !== null)
    timeline.capture("turn", `Resumed · ${turnLabel(state)}`, state);
}

/** Previous: from live, park the present as a return-point and restore the last boundary; while rewound,
 *  step back. A dirty rewound state needs confirmation, which discards the changes in place. */
export function planPreviousTurn(state: GameState, timeline: TimelineOps, confirmDiscard: boolean): TimelineOutcome {
  const entries = timeline.entries();
  if (entries.length === 0) {
    // Nothing recorded since a scene swap or replay launch cleared the timeline: just move the turn pointer.
    previousInitiativeTurn(state);
    return { kind: "legacy" };
  }
  const cursor = state.combat.historyCursor;
  if (cursor === null) {
    const last = entries[entries.length - 1];
    const snapshot = timeline.read(last.index);
    if (!snapshot) throw new CommandRejectedError("The timeline is out of sync. Try again.");
    timeline.capture("return", turnLabel(state), state);
    applyTimelineRestore(state, snapshot, last.index);
    return { kind: "rewound", label: last.label };
  }
  if (state.combat.historyDirty) {
    if (!confirmDiscard)
      throw new TimelineConfirmationRequired("discard-changes", "Discard the changes made at this point in history?");
    const snapshot = timeline.read(cursor);
    if (!snapshot) throw new CommandRejectedError("The timeline is out of sync. Try again.");
    const entry = entries.find((candidate) => candidate.index === cursor);
    applyTimelineRestore(state, snapshot, cursor);
    return { kind: "discarded", label: entry?.label ?? turnLabel(state) };
  }
  const prior = entries.filter((candidate) => candidate.index < cursor).at(-1);
  if (!prior) throw new CommandRejectedError("You're at the beginning of the recorded fight.");
  const snapshot = timeline.read(prior.index);
  if (!snapshot) throw new CommandRejectedError("The timeline is out of sync. Try again.");
  applyTimelineRestore(state, snapshot, prior.index);
  return { kind: "stepped", label: prior.label };
}

/** Next: live, capture and advance; rewound and clean, step forward (the return-point resumes live); rewound
 *  and dirty, require confirmRewrite, truncate the undone future, capture and advance. */
export function planNextTurn(
  state: GameState,
  timeline: TimelineOps,
  confirmRewrite: boolean,
  advance: (state: GameState) => void = nextInitiativeTurn
): TimelineOutcome {
  const cursor = state.combat.historyCursor;
  const entries = timeline.entries();
  if (cursor === null) {
    const label = turnLabel(state);
    timeline.capture("turn", label, state);
    // Evict the oldest boundaries beyond CAP. Only happens while live, so the cursor can't fall below the floor.
    const excess = entries.length + 1 - CAP;
    if (excess > 0 && entries.length >= excess) timeline.prune(entries[excess].index);
    advance(state);
    return { kind: "advanced" };
  }
  if (state.combat.historyDirty) {
    if (!confirmRewrite)
      throw new TimelineConfirmationRequired(
        "rewrite-history",
        "Rewrite history from this turn? Every later turn will be undone."
      );
    const rewriteLabel = turnLabel(state);
    timeline.truncateFrom(cursor);
    state.combat = { ...state.combat, historyCursor: null, historyDirty: false };
    timeline.capture("turn", rewriteLabel, state);
    advance(state);
    return { kind: "rewrote", label: rewriteLabel };
  }
  const ahead = entries.find((candidate) => candidate.index > cursor);
  if (!ahead) throw new CommandRejectedError("The timeline is out of sync. Try again.");
  const snapshot = timeline.read(ahead.index);
  if (!snapshot) throw new CommandRejectedError("The timeline is out of sync. Try again.");
  if (ahead.kind === "return") {
    applyTimelineRestore(state, snapshot, null);
    timeline.remove(ahead.index);
    return { kind: "resumed" };
  }
  applyTimelineRestore(state, snapshot, ahead.index);
  return { kind: "stepped", label: ahead.label };
}
