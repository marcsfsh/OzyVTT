import type { ActorDefinition } from "@vtt/schemas";
import type { CombatLogEntry, GameState, RollRecord, TurnHistoryEntry } from "@vtt/domain";
import type { JournalEntry } from "./game-store.js";

/**
 * The permanent, machine-readable record of one ended encounter (#12 export, Time Machine v2). Built
 * at encounter end from the turn-boundary snapshots + the timestamped combat log + the per-command
 * journal, then stored verbatim so external tools can consume it — the app never analyzes it.
 * GM-only: `turns[].state`/`finalState` are the FULL game state (hidden combatants included), `log`
 * includes GM-only lines, and `journal` payloads can reference hidden combatants, so it is served
 * only behind GM-grade auth (GM session or a GM-minted integration credential).
 *
 * Shape (archiveSchemaVersion 3 — strictly additive over versions 1 and 2):
 *   {
 *     archiveSchemaVersion: 3,
 *     startedAt, endedAt,               // ISO 8601
 *     turnCount,
 *     turns: [{ index, kind, label, revision, at, state }],    // one full GameState per turn boundary
 *     log:   [{ id, at, kind, text, gmOnly, revision }],       // the fight's commentary, chronological
 *     journal: [{ seq, commandId, type, actorId, principal, payload, revision, at }],  // EVERY accepted command while the fight was live, incl. the ending encounter.end
 *     finalState,                       // the last live GameState, captured just before encounter.end cleared the fight
 *     postEncounterState,               // v3: the state AFTER encounter.end ran — combat cleared, end-of-fight effect sweeps (and their on-end grants) landed
 *     rolls: [RollRecord...],           // every dice roll seen across the fight (survives the live state's rolling cap)
 *     definitions: [{ id, source: "imported"|"bundled", definition }],  // full stat blocks used by the fight, so the document is self-contained
 *     attribution                       // CC BY 4.0 line when bundled SRD content is included, else null
 *   }
 * `turns`, `log`, and `journal` join on `revision` (and time), which is how a consumer aligns "what
 * the state was" with "what was commanded" and "what was narrated as it happened".
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
  /** v3: the true aftermath — captured after encounter.end cleared combat and ran its effect sweeps. */
  postEncounterState: GameState;
  rolls: readonly RollRecord[];
  definitions: readonly EncounterArchiveDefinition[];
  attribution: string | null;
}>;

export type BuildEncounterArchiveInput = Readonly<{
  entries: readonly TurnHistoryEntry[];
  /** The timeline's snapshot reader (runs inside the command transaction), so every turn carries the exact state captured at that boundary; a snapshot that fails to read is dropped rather than aborting the whole archive. */
  readState: (index: number) => GameState | null;
  log: readonly CombatLogEntry[];
  journal: readonly JournalEntry[];
  /** The last live picture of the fight — cloned before `endEncounter` cleared the combat. */
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
  // The live state keeps only a rolling window of rolls; the union across every boundary + the final
  // state preserves the fight's full dice record even when the window slid during play.
  const rolls = new Map<string, RollRecord>();
  for (const state of states) for (const roll of state.rolls) if (!rolls.has(roll.id)) rolls.set(roll.id, roll);
  // Full stat blocks for every definition any combatant referenced, so consumers never need the app
  // or the content bundle to interpret the fight. Imported sheets win over bundled ids on collision,
  // matching how the live server resolves them.
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
