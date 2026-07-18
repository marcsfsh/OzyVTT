import type { CombatLogEntry, GameState, TurnHistoryEntry } from "@vtt/domain";

/**
 * The permanent, machine-readable record of one ended encounter (#12 export). Built at encounter end
 * from the turn-boundary snapshots + the timestamped combat log, then stored verbatim so external
 * tools can consume it — the app never analyzes it. GM-only: `turns[].state` is the FULL game state
 * (hidden combatants included) and `log` includes GM-only lines, so it is served only behind GM auth.
 *
 * Shape (archiveSchemaVersion 1):
 *   {
 *     archiveSchemaVersion: 1,
 *     startedAt, endedAt,               // ISO 8601
 *     turnCount,
 *     turns: [{ index, kind, label, revision, at, state }],   // one full GameState per turn boundary
 *     log:   [{ id, at, kind, text, gmOnly, revision }]        // the fight's commentary, chronological
 *   }
 * `turns` and `log` join on `revision` (and time), which is how a consumer aligns "what the state was"
 * with "what was narrated as it happened".
 */
export const ENCOUNTER_ARCHIVE_SCHEMA_VERSION = 1;

export type EncounterArchiveTurn = Readonly<{ index: number; kind: "turn" | "return"; label: string; revision: number; at: string; state: GameState }>;
export type EncounterArchiveDocument = Readonly<{
  archiveSchemaVersion: number;
  startedAt: string | null;
  endedAt: string;
  turnCount: number;
  turns: readonly EncounterArchiveTurn[];
  log: readonly CombatLogEntry[];
}>;

/**
 * Assemble the archive document. `readState` is the timeline's snapshot reader (runs inside the
 * command transaction), so every turn carries the exact state captured at that boundary; a snapshot
 * that fails to read is dropped rather than aborting the whole archive.
 */
export function buildEncounterArchive(
  entries: readonly TurnHistoryEntry[],
  readState: (index: number) => GameState | null,
  log: readonly CombatLogEntry[],
  endedAt: string
): EncounterArchiveDocument {
  const turns = entries.flatMap((entry): EncounterArchiveTurn[] => {
    const state = readState(entry.index);
    return state ? [{ index: entry.index, kind: entry.kind, label: entry.label, revision: entry.revision, at: entry.at, state }] : [];
  });
  return {
    archiveSchemaVersion: ENCOUNTER_ARCHIVE_SCHEMA_VERSION,
    startedAt: turns[0]?.at ?? null,
    endedAt,
    turnCount: turns.length,
    turns,
    log
  };
}
