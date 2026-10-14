import type { ActorDefinition } from "@vtt/schemas";
import type { CombatLogEntry, GameState, RollRecord, TurnHistoryEntry } from "@vtt/domain";
import type { JournalEntry } from "./game-store.js";

/**
 * The permanent, machine-readable record of one ended encounter, built at encounter end from the
 * turn-boundary snapshots, the combat log and the command journal, and stored verbatim for external
 * tools. GM-only: turn states and `finalState` are full game state (hidden combatants), `log` includes
 * GM-only lines and `journal` payloads can name hidden combatants, so it is served only behind
 * GM-grade auth.
 *
 * Shape (archiveSchemaVersion 3, additive over 1 and 2):
 *   {
 *     archiveSchemaVersion: 3,
 *     startedAt, endedAt,               // ISO 8601
 *     turnCount,
 *     turns: [{ index, kind, label, revision, at, state }],    // one full GameState per turn boundary
 *     log:   [{ id, at, kind, text, gmOnly, revision }],       // the fight's commentary, chronological
 *     journal: [{ seq, commandId, type, actorId, principal, payload, revision, at }],  // every accepted command while the fight was live, incl. the ending encounter.end
 *     finalState,                       // the last live GameState, captured just before encounter.end cleared the fight
 *     postEncounterState,               // v3: the state after encounter.end ran (combat cleared, end-of-fight effect sweeps landed)
 *     rolls: [RollRecord...],           // every dice roll seen across the fight (survives the live state's rolling cap)
 *     definitions: [{ id, source: "imported"|"bundled", definition }],  // full stat blocks used by the fight, so the document is self-contained
 *     attribution                       // CC BY 4.0 line when bundled SRD content is included, else null
 *   }
 * `turns`, `log` and `journal` join on `revision` (and time).
 */
export const ENCOUNTER_ARCHIVE_SCHEMA_VERSION = 3;

export type EncounterArchiveTurn = Readonly<{ index: number; kind: "turn" | "return"; label: string; revision: number; at: string; state: GameState }>;
export type EncounterArchiveDefinition = Readonly<{ id: string; source: "imported" | "bundled"; definition: ActorDefinition }>;
export type EncounterArchiveDocument = Readonly<{
  archiveSchemaVersion: number;
  startedAt: string | null;
  endedAt: string;
  turnCount: number;
  turns: readonly EncounterArchiveTurn[];
  log: readonly CombatLogEntry[];
  journal: readonly JournalEntry[];
  finalState: GameState;
  /** v3: the aftermath, captured after encounter.end cleared combat and ran its effect sweeps. */
  postEncounterState: GameState;
  rolls: readonly RollRecord[];
  definitions: readonly EncounterArchiveDefinition[];
  attribution: string | null;
}>;

export type BuildEncounterArchiveInput = Readonly<{
  entries: readonly TurnHistoryEntry[];
  /** The timeline's snapshot reader (runs inside the command transaction); a snapshot that fails to read is dropped rather than aborting the archive. */
  readState: (index: number) => GameState | null;
  log: readonly CombatLogEntry[];
  journal: readonly JournalEntry[];
  /** The last live picture of the fight, cloned before `endEncounter` cleared the combat. */
  finalState: GameState;
  /** The state after `encounter.end`'s own work: combat cleared, end-of-fight effect sweeps (Frenzy's Exhaustion) landed. */
  postEncounterState: GameState;
  endedAt: string;
  /** Resolves a bundled (SRD) stat block by definition id; imported ones come from the states themselves. */
  resolveBundledDefinition: (definitionId: string) => ActorDefinition | undefined;
  /** The bundled content's attribution line; included in the document only when a bundled stat block is. */
  attribution: string;
}>;

export function buildEncounterArchive(input: BuildEncounterArchiveInput): EncounterArchiveDocument {
  const turns = input.entries.flatMap((entry): EncounterArchiveTurn[] => {
    const state = input.readState(entry.index);
    return state ? [{ index: entry.index, kind: entry.kind, label: entry.label, revision: entry.revision, at: entry.at, state }] : [];
  });
  const states = [...turns.map((turn) => turn.state), input.finalState];
  // The live state keeps a rolling window of rolls; the union across all boundaries keeps the full record.
  const rolls = new Map<string, RollRecord>();
  for (const state of states) for (const roll of state.rolls) if (!rolls.has(roll.id)) rolls.set(roll.id, roll);
  // Full stat blocks for every referenced definition, so the document is self-contained. Imported sheets
  // win over bundled ids, matching live resolution.
  const definitions = new Map<string, EncounterArchiveDefinition>();
  for (const state of states) {
    for (const actor of state.actors) {
      if (!actor.definitionId || definitions.has(actor.definitionId)) continue;
      const imported = state.definitions.find((entry) => entry.id === actor.definitionId)?.definition;
      if (imported) { definitions.set(actor.definitionId, { id: actor.definitionId, source: "imported", definition: imported }); continue; }
      const bundled = input.resolveBundledDefinition(actor.definitionId);
      if (bundled) definitions.set(actor.definitionId, { id: actor.definitionId, source: "bundled", definition: bundled });
    }
  }
  const includesBundled = [...definitions.values()].some((entry) => entry.source === "bundled");
  return {
    archiveSchemaVersion: ENCOUNTER_ARCHIVE_SCHEMA_VERSION,
    startedAt: turns[0]?.at ?? null,
    endedAt: input.endedAt,
    turnCount: turns.length,
    turns,
    log: input.log,
    journal: input.journal,
    finalState: input.finalState,
    postEncounterState: input.postEncounterState,
    rolls: [...rolls.values()],
    definitions: [...definitions.values()],
    attribution: includesBundled ? input.attribution : null
  };
}
