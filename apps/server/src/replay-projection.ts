import type { CombatLogEntry, PlayerCombatView, PlayerHp, PlayerRollRecord, RollRecord } from "@vtt/domain";
import type { EncounterArchiveDocument, EncounterArchiveTurn } from "./encounter-archive.js";
import { conditionLabels, playerHp, projectPlayerCombat } from "./projections.js";

/**
 * The player's replay: a projection built from an explicit allow-list, never a filtered archive. The
 * stored document is GM material (full GameStates, raw command payloads, monster stat blocks), and a
 * filter is one forgotten key away from a leak.
 *
 * Each turn's state is run through the live player projection. Visibility was snapshotted per turn,
 * so a creature revealed on turn 7 stays hidden in turns 0-6 with no separate reveal logic.
 *
 * Stricter than the live feed: `self-only` rolls are dropped (the reader is any player, not the
 * roller), and roll payloads lose `initiatorSessionId`. Archive turn labels can name hidden
 * combatants, so labels are recomputed from each turn's public state.
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

/** A public roll with the roller's session id removed; the only roll shape a player receives. */
function safePublicRoll(roll: RollRecord | PlayerRollRecord): PlayerRollRecord {
  const { initiatorSessionId: _private, ...visible } = roll as RollRecord;
  return visible;
}

/** Log rows from this boundary's revision up to the next boundary's; the last turn takes the rest. */
function logSliceFor(document: EncounterArchiveDocument, turnIndex: number): readonly CombatLogEntry[] {
  const turns = document.turns;
  const from = turns[turnIndex]?.revision ?? 0;
  const next = turns[turnIndex + 1]?.revision;
  return document.log.filter((entry) => entry.revision >= from && (next === undefined || entry.revision < next));
}

/** One log row as a player may read it: non-roll rows follow `gmOnly` like the live feed; a roll row
 *  must also be a public roll, since the reader is never assumed to be the roller. */
function playerLogRow(entry: CombatLogEntry): CombatLogEntry | null {
  if (entry.gmOnly) return null;
  if (entry.roll) {
    if (entry.roll.visibility !== "public") return null;
    return { ...entry, roll: safePublicRoll(entry.roll) };
  }
  return entry;
}

/** The public creatures at this boundary as cards: no notes, owner or definition. */
function turnActors(turn: EncounterArchiveTurn): readonly PlayerReplayTurnActor[] {
  return turn.state.actors
    .filter((actor) => actor.visibility === "public")
    .map((actor) => ({ id: actor.id, name: actor.name, hp: playerHp(actor), conditions: conditionLabels(actor) }));
}

/** The turn's label, computed from what was public then. */
function turnLabel(turn: EncounterArchiveTurn): string {
  const actorId = turn.state.combat.turnActorId;
  const actor = actorId === null ? undefined : turn.state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || actor.visibility !== "public") return "A hidden combatant's turn";
  return `${actor.name}'s turn`;
}

/** Builds the player's replay. `now` is injected so annotation expiry is deterministic. There is no
 *  `playerSessionId`: the combat projection runs with `undefined`, so owner-only extras stay off and
 *  every reader gets the same spectator document. */
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
    // Self-only and gm-only rolls are dropped: the reader is any player, not the roller.
    rolls: (document.rolls ?? []).filter((roll) => roll.visibility === "public").map(safePublicRoll),
    attribution: document.attribution ?? null
    // Not projected: journal (payloads naming hidden combatants), finalState/postEncounterState (full
    // GameStates), definitions (monster stat blocks), and every turn's raw state.
  };
}

/** The battle-map images a shared archive's player replay renders, so the map router can serve them.
 *  Derived from the projected player document, not the stored one, which also references prepared
 *  scenes' maps players must not see. Does not check the shared flag: never call it on an unshared archive. */
export function playerReplayMapAssetIds(id: number, document: EncounterArchiveDocument, now = Date.now()): ReadonlySet<string> {
  return new Set(projectPlayerReplay(id, document, now).turns.flatMap((turn) => turn.combat.mapAssetId === null ? [] : [turn.combat.mapAssetId]));
}
