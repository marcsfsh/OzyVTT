import type { CombatLogEntry, PlayerCombatView, PlayerHp, PlayerRollRecord, RollRecord } from "@vtt/domain";
import { playerFeedId } from "./combat-log.js";
import type { EncounterArchiveDocument, EncounterArchiveTurn } from "./encounter-archive.js";
import { conditionLabels, playerHp, playerRoll, projectPlayerCombat } from "./projections.js";
import { partySight, type AudienceSight } from "./vision/audience.js";
import type { SightContent } from "./vision/senses.js";

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
 *
 * With dynamic vision on, each turn is seen through the whole party, as the table screen sees it: a creature no
 * character perceived then is hidden in that turn, and so are its rolls made during it.
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
  // The live feed's opaque id, so the gaps between rows don't count the GM-only ones.
  const id = playerFeedId(entry.id);
  if (entry.roll) {
    if (entry.roll.visibility !== "public") return null;
    return { ...entry, id, roll: playerRoll(entry.roll) };
  }
  return { ...entry, id };
}

/** The public creatures at this boundary as cards: no notes, owner or definition. */
function turnActors(turn: EncounterArchiveTurn, sight: AudienceSight): readonly PlayerReplayTurnActor[] {
  return turn.state.actors
    .filter((actor) => actor.visibility === "public" && !sight.hidden.has(actor.id))
    .map((actor) => ({ id: actor.id, name: actor.name, hp: playerHp(actor), conditions: conditionLabels(actor) }));
}

/** The turn's label, computed from what was public then. */
function turnLabel(turn: EncounterArchiveTurn, sight: AudienceSight): string {
  const actorId = turn.state.combat.turnActorId;
  const actor = actorId === null ? undefined : turn.state.actors.find((candidate) => candidate.id === actorId);
  if (!actor || actor.visibility !== "public" || sight.hidden.has(actor.id)) return "A hidden combatant's turn";
  return `${actor.name}'s turn`;
}

/** Whether a public roll may be replayed: not one made, during its turn, by a creature the party couldn't perceive. */
function rollShown(
  roll: RollRecord,
  turns: readonly EncounterArchiveTurn[],
  sights: readonly AudienceSight[]
): boolean {
  if (roll.visibility !== "public") return false;
  if (roll.actorId === null) return true;
  let index = -1;
  for (let at = 0; at < turns.length; at++) if (turns[at]!.at <= roll.createdAt) index = at;
  // Before the first boundary the first turn's sight applies.
  const sight = sights[Math.max(0, index)];
  return sight === undefined || !sight.hidden.has(roll.actorId);
}

/** Builds the player's replay. `now` is injected so annotation expiry is deterministic. There is no
 *  `playerSessionId`: the combat projection runs with `undefined`, so owner-only extras stay off and
 *  every reader gets the same spectator document. */
export function projectPlayerReplay(
  id: number,
  document: EncounterArchiveDocument,
  now = Date.now(),
  content: SightContent = {}
): PlayerReplayDocument {
  const sights = document.turns.map((turn) => partySight(turn.state, content));
  const turns = document.turns.map((turn, index): PlayerReplayTurn => ({
    index: turn.index,
    at: turn.at,
    label: turnLabel(turn, sights[index]!),
    combat: projectPlayerCombat(turn.state, undefined, now, content, sights[index]!),
    actors: turnActors(turn, sights[index]!),
    log: logSliceFor(document, index).flatMap((entry) => {
      const row = playerLogRow(entry);
      return row ? [row] : [];
    })
  }));
  return {
    id,
    startedAt: document.startedAt ?? null,
    endedAt: document.endedAt,
    turnCount: turns.length,
    turns,
    // Self-only and gm-only rolls are dropped: the reader is any player, not the roller.
    rolls: (document.rolls ?? []).filter((roll) => rollShown(roll, document.turns, sights)).map(playerRoll),
    attribution: document.attribution ?? null
    // Not projected: journal (payloads naming hidden combatants), finalState/postEncounterState (full
    // GameStates), definitions (monster stat blocks), and every turn's raw state.
  };
}

/** The battle-map images a shared archive's player replay renders, so the map router can serve them.
 *  Derived from the projected player document, not the stored one, which also references prepared
 *  scenes' maps players must not see. Does not check the shared flag: never call it on an unshared archive. */
export function playerReplayMapAssetIds(
  id: number,
  document: EncounterArchiveDocument,
  now = Date.now()
): ReadonlySet<string> {
  return new Set(
    projectPlayerReplay(id, document, now).turns.flatMap((turn) =>
      turn.combat.mapAssetId === null ? [] : [turn.combat.mapAssetId]
    )
  );
}
