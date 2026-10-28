import { useEffect, useState } from "react";
import { countOf, type CombatLogEntry, type GameState, type PlayerCombatView, type PlayerHp } from "@vtt/domain";
import { apiRequest } from "../lib/api";
import { downloadJson } from "../lib/download";

/**
 * Replays: every finished fight is kept. The GM gets the list (with a per-replay reveal control,
 * hidden by default), the viewer, and "Launch from here". A player gets only the replays the GM
 * shared, rendered from the server's player replay projection (`apps/server/src/replay-projection.ts`):
 * the client never receives the GM archive, so hidden combatants and GM-only narration are absent,
 * not filtered here. One URL serves both; the server decides which document you get.
 */

export type ArchiveSummary = Readonly<{
  id: number;
  archivedAt: string;
  startedAt: string | null;
  endedAt: string;
  turnCount: number;
  playerVisible: boolean;
  /** The GM's own name for it, or null. */
  name: string | null;
  /** The scene the fight was on; only the GM's list carries it. */
  encounterName?: string | null;
}>;
type ArchiveTurn = Readonly<{
  index: number;
  kind: "turn" | "return";
  label: string;
  revision: number;
  at: string;
  state: GameState;
}>;
export type ArchiveDocument = Readonly<{
  archiveSchemaVersion: number;
  startedAt: string | null;
  endedAt: string;
  turnCount: number;
  turns: readonly ArchiveTurn[];
  log: readonly CombatLogEntry[];
  finalState?: GameState;
}>;
/** The player-projected document, mirrored from `PlayerReplayDocument` (server-owned shape). */
type PlayerReplayActor = Readonly<{ id: string; name: string; hp: PlayerHp; conditions: readonly string[] }>;
type PlayerReplayTurn = Readonly<{
  index: number;
  at: string;
  label: string;
  combat: PlayerCombatView;
  actors: readonly PlayerReplayActor[];
  log: readonly CombatLogEntry[];
}>;
export type PlayerReplayDocument = Readonly<{
  id: number;
  startedAt: string | null;
  endedAt: string;
  turnCount: number;
  turns: readonly PlayerReplayTurn[];
  attribution: string | null;
}>;

export type Step = Readonly<{ label: string; at: string; state: GameState; from: number; to: number }>;

export const failure = "That replay could not be loaded.";

/** One archive: the GM's full document, or the player projection, by the token's role. */
export function readArchive<T>(archiveId: number, token: string): Promise<T> {
  return apiRequest<{ document: T }>(`/api/v1/replays/${archiveId}`, { token, failure }).then((data) => data.document);
}

export const dateOnly = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: "medium" });

/** What a replay is called: the GM's name, else its scene and the day it was fought ("Fight" with no scene). */
export function replayTitle(archive: ArchiveSummary): string {
  return archive.name ?? `${archive.encounterName ?? "Encounter"} · ${dateOnly(archive.endedAt)}`;
}

/** The line under a replay's name: its scene and day when the GM named it, then how long the fight was. */
export function replayMeta(archive: ArchiveSummary): string {
  const where = archive.name ? [archive.encounterName, dateOnly(archive.endedAt)].filter(Boolean).join(" · ") : null;
  const duration = durationOf(archive.startedAt, archive.endedAt);
  return [where, countOf(archive.turnCount, "turn"), duration].filter(Boolean).join(" · ");
}

/** How long the fight ran, said the way a person would say it. Null when the archive has no start. */
export function durationOf(startedAt: string | null, endedAt: string): string | null {
  if (!startedAt) return null;
  const minutes = Math.max(0, Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60000));
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Saves an archive document as JSON, the same record the API serves. */
export function exportDocument(id: number, endedAt: string, document: unknown) {
  const stamp = endedAt.slice(0, 16).replace("T", "-").replaceAll(":", "");
  downloadJson(`encounter-replay-${id}-${stamp}.json`, document);
}

/**
 * A replay step is one recorded boundary: its state is the table at that moment, and its log slice
 * is what happened before the next. Version-1 archives (no finalState) end on the last boundary;
 * later ones add an "aftermath" step with the fight's last live picture.
 */
export function stepsOf(document: ArchiveDocument): readonly Step[] {
  const steps: Step[] = document.turns.map((turn, index) => ({
    label: turn.kind === "return" ? `${turn.label} (return point)` : turn.label,
    at: turn.at,
    state: turn.state,
    from: turn.revision,
    to: document.turns[index + 1]?.revision ?? Number.MAX_SAFE_INTEGER
  }));
  if (document.finalState && steps.length > 0) {
    const last = steps[steps.length - 1];
    steps[steps.length - 1] = { ...last, to: document.finalState.revision };
    steps.push({
      label: "Aftermath · how the encounter ended",
      at: document.endedAt,
      state: document.finalState,
      from: document.finalState.revision,
      to: Number.MAX_SAFE_INTEGER
    });
  }
  return steps;
}

/**
 * A hook because the same fetch feeds the full list and the player's shelf. A player's listing is
 * server-filtered to shared replays, so an empty answer is the truth.
 */
export function useReplays(
  token: string | null
): Readonly<{ archives: readonly ArchiveSummary[] | null; error: string | null; refresh: () => void }> {
  const [archives, setArchives] = useState<readonly ArchiveSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!token) {
      setArchives([]);
      return;
    }
    let cancelled = false;
    apiRequest<{ replays: readonly ArchiveSummary[] }>("/api/v1/replays", { token, failure })
      .then((data) => {
        if (!cancelled) {
          setArchives(data.replays);
          setError(null);
        }
      })
      .catch((cause: Error) => {
        if (!cancelled) {
          setArchives([]);
          setError(cause.message);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, tick]);
  return { archives, error, refresh: () => setTick((value) => value + 1) };
}
