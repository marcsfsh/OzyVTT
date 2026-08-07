import type { CombatLogEntry, PlayerCombatView, PlayerHp, PlayerRollRecord, RollRecord } from "@vtt/domain";
import type { EncounterArchiveDocument, EncounterArchiveTurn } from "./encounter-archive.js";
import { conditionLabels, playerHp, projectPlayerCombat } from "./projections.js";

/**
 * ============================================================================================
 * THE PLAYER'S REPLAY - A PROJECTION, NEVER A FILTERED ARCHIVE (D26)
 * ============================================================================================
 *
 * The stored archive document is GM material end to end: `turns[].state` is the FULL GameState of
 * every boundary (hidden combatants, notes, owner session ids, the whole roll history),
 * `finalState`/`postEncounterState` the same, `journal` carries raw command payloads, and
 * `definitions` carries monster stat blocks. Handing a player that document minus a few keys would
 * be a filter, and a filter is one forgotten key away from a leak.
 *
 * So this builds a NEW document out of an explicit allow-list, exactly the way `projections.ts`
 * builds `PlayerView`. Everything a player receives is written down below; everything else is
 * absent because it was never copied.
 *
 * WHY THE PER-TURN SNAPSHOTS MAKE "HIDDEN UNTIL ITS REVEAL MOMENT" FALL OUT FOR FREE. Visibility was
 * snapshotted with every other fact at each turn boundary, so a monster the GM revealed on turn 7 is
 * `gm-only` in states 0-6 and `public` from 7 on. Running the LIVE player projection over each
 * boundary state therefore reproduces exactly what a player could see at that moment in the fight -
 * no reveal ledger to replay, no second implementation of the visibility rule.
 *
 * THE TWO THINGS A `gmOnly`-ONLY FILTER WOULD LEAK, and why the log slice below is stricter:
 *   - a `self-only` roll (one player's private roll) is stored with `gm_only = 0`, because it IS
 *     visible - to its roller. The replay reader is ANY player, never necessarily the roller, so
 *     self-only rows are dropped entirely rather than matched against a session id.
 *   - the roll payloads in `GameState.rolls` (the document's `rolls` array) carry
 *     `initiatorSessionId`. A session id is a credential-shaped identifier and never crosses to a
 *     player; `safePublicRoll` strips it, and `replay-projection.test.ts` asserts at the STRING level
 *     that no session id survives anywhere in the serialized document.
 *
 * The turn LABELS from the archive are GM labels ("Grick's turn") and can name a hidden combatant, so
 * they are recomputed here from the turn's own state rather than copied.
 */

export type PlayerReplayTurnActor = Readonly<{ id: string; name: string; hp: PlayerHp; conditions: readonly string[] }>;
export type PlayerReplayTurn = Readonly<{
  index: number;
  at: string;
  /** Recomputed player-safe label; never the archive's GM label. */
  label: string;
  combat: PlayerCombatView;
  actors: readonly PlayerReplayTurnActor[];
  log: readonly CombatLogEntry[];
}>;
export type PlayerReplayDocument = Readonly<{
  id: number;
  startedAt: string | null;
  endedAt: string;
  turnCount: number;
  turns: readonly PlayerReplayTurn[];
  rolls: readonly PlayerRollRecord[];
  attribution: string | null;
}>;

/** A public roll, with the roller's session id removed. The only roll shape a player ever receives. */
function safePublicRoll(roll: RollRecord | PlayerRollRecord): PlayerRollRecord {
  const { initiatorSessionId: _private, ...visible } = roll as RollRecord;
  return visible;
}

/**
 * Which log rows belong to this turn: everything from this boundary's revision up to (but not
 * including) the next boundary's. The last turn takes everything after it - the fight's closing
 * lines are part of the last turn a player watched.
 */
function logSliceFor(document: EncounterArchiveDocument, turnIndex: number): readonly CombatLogEntry[] {
  const turns = document.turns;
  const from = turns[turnIndex]?.revision ?? 0;
  const next = turns[turnIndex + 1]?.revision;
  return document.log.filter((entry) => entry.revision >= from && (next === undefined || entry.revision < next));
}

/**
 * One log row as a player may read it. Non-roll rows follow `gmOnly` (the same rule the live feed
 * uses); a roll row must ALSO be a public roll - `projectFeedRow`'s rule for a reader who is not the
 * roller, applied here where the reader is "any player, later".
 */
function playerLogRow(entry: CombatLogEntry): CombatLogEntry | null {
  if (entry.gmOnly) return null;
  if (entry.roll) {
    if (entry.roll.visibility !== "public") return null;
    return { ...entry, roll: safePublicRoll(entry.roll) };
  }
  return entry;
}

/** The public creatures a player could see at this boundary, as cards - no notes, no owner, no definition. */
function turnActors(turn: EncounterArchiveTurn): readonly PlayerReplayTurnActor[] {
  return turn.state.actors
    .filter((actor) => actor.visibility === "public")
    .map((actor) => ({ id: actor.id, name: actor.name, hp: playerHp(actor), conditions: conditionLabels(actor) }));
}

/** The turn's own label, computed from what was public THEN. */
function turnLabel(turn: EncounterArchiveTurn): string {
  const actorId = turn.state.combat.turnActorId;
  const actor = actorId === null ? undefined : turn.state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || actor.visibility !== "public") return "A hidden combatant's turn";
  return `${actor.name}'s turn`;
}

/**
 * Build the player's replay. `now` is injected so annotation expiry is evaluated deterministically
 * (the live projection prunes expired annotations by wall clock; an archive is all past).
 *
 * `playerSessionId` is deliberately NOT a parameter: the combat projection is run with `undefined`,
 * so the owner-only re-adds (a player's own pending saves, their own private annotations) stay off
 * and every reader gets the same spectator document. Simpler, strictly safer, and a "my old sheet in
 * replays" feature would be a new decision rather than a quiet widening of this one.
 */
export function projectPlayerReplay(id: number, document: EncounterArchiveDocument, now = Date.now()): PlayerReplayDocument {
  const turns = document.turns.map((turn, index): PlayerReplayTurn => ({
    index: turn.index,
    at: turn.at,
    label: turnLabel(turn),
    combat: projectPlayerCombat(turn.state, undefined, now),
    actors: turnActors(turn),
    log: logSliceFor(document, index).flatMap((entry) => { const row = playerLogRow(entry); return row ? [row] : []; })
  }));
  return {
    id,
    startedAt: document.startedAt ?? null,
    endedAt: document.endedAt,
    turnCount: turns.length,
    turns,
    // Self-only and gm-only rolls are dropped entirely - the reader is any player, not the roller.
    rolls: (document.rolls ?? []).filter((roll) => roll.visibility === "public").map(safePublicRoll),
    attribution: document.attribution ?? null
    // NOT PROJECTED, deliberately: journal (raw command payloads naming hidden combatants),
    // finalState / postEncounterState (full GameStates), definitions (monster stat blocks - the same
    // boundary as live play, where a player never receives one), and every turn's raw state.
  };
}
