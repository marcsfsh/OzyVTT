import type { CodexDb } from "./db.js";
import { revisionHistoryUsage, type CodexRevisionHistoryUsage } from "./revisions.js";
import {
  CodexValidationError,
  MAX_AUTOSAVE_INTERVAL_SECONDS,
  MAX_REVISION_WINDOW_MINUTES,
  MIN_AUTOSAVE_INTERVAL_SECONDS,
  MIN_REVISION_WINDOW_MINUTES,
  autosaveIntervalSeconds,
  revisionWindowMinutes
} from "./validate.js";

/** Codex-wide settings: columns of the `codex_meta` row. */

/** `enabled: false` stops new revisions but deletes none. `windowMinutes` coalesces saves; `0` checkpoints every save. */
export type CodexRevisionSettings = Readonly<{ enabled: boolean; windowMinutes: number }>;
/** The revision-history section as a reader sees it: the settable knobs plus what the history costs. */
export type CodexRevisionHistory = CodexRevisionSettings & CodexRevisionHistoryUsage;
/** Editor autosave, in seconds; stored here only so it follows the GM across devices. */
export type CodexAutosaveSettings = Readonly<{ enabled: boolean; intervalSeconds: number }>;
export type CodexSettings = Readonly<{ revisionHistory: CodexRevisionHistory; autosave: CodexAutosaveSettings }>;
/** The writable half: usage figures are server facts and cannot be sent. */
export type CodexSettingsInput = Readonly<{ revisionHistory: CodexRevisionSettings; autosave: CodexAutosaveSettings }>;

export const DEFAULT_REVISION_SETTINGS: CodexRevisionSettings = { enabled: true, windowMinutes: 90 };
export const DEFAULT_AUTOSAVE_SETTINGS: CodexAutosaveSettings = { enabled: true, intervalSeconds: 1 };

/**
 * One pair of settings columns, re-validated on read: a stored integer past 2^53 makes `node:sqlite` throw for
 * the whole row, and any bad value falls back to its default. `enabled` fails open, so history and autosave
 * never silently stop. Each pair is read on its own so one bad column cannot reset the other setting.
 */
function readPair(
  db: CodexDb,
  columns: Readonly<{ enabled: string; amount: string }>,
  bounds: Readonly<{ min: number; max: number }>,
  fallback: Readonly<{ enabled: boolean; amount: number }>
): { enabled: boolean; amount: number } {
  let row: { enabled: number; amount: number };
  try {
    row = db.database
      .prepare(`SELECT ${columns.enabled} AS enabled, ${columns.amount} AS amount FROM codex_meta WHERE id = 1`)
      .get() as { enabled: number; amount: number };
  } catch {
    return { ...fallback };
  }
  return {
    enabled: row.enabled === 0 || row.enabled === 1 ? row.enabled === 1 : fallback.enabled,
    amount:
      Number.isSafeInteger(row.amount) && row.amount >= bounds.min && row.amount <= bounds.max
        ? row.amount
        : fallback.amount
  };
}

/** Read on every page save, so it skips the history scan `getSettings` does. */
export function revisionSettings(db: CodexDb): CodexRevisionSettings {
  const pair = readPair(
    db,
    { enabled: "revision_history_enabled", amount: "revision_window_minutes" },
    { min: MIN_REVISION_WINDOW_MINUTES, max: MAX_REVISION_WINDOW_MINUTES },
    { enabled: DEFAULT_REVISION_SETTINGS.enabled, amount: DEFAULT_REVISION_SETTINGS.windowMinutes }
  );
  return { enabled: pair.enabled, windowMinutes: pair.amount };
}

export function autosaveSettings(db: CodexDb): CodexAutosaveSettings {
  const pair = readPair(
    db,
    { enabled: "autosave_enabled", amount: "autosave_interval_seconds" },
    { min: MIN_AUTOSAVE_INTERVAL_SECONDS, max: MAX_AUTOSAVE_INTERVAL_SECONDS },
    { enabled: DEFAULT_AUTOSAVE_SETTINGS.enabled, amount: DEFAULT_AUTOSAVE_SETTINGS.intervalSeconds }
  );
  return { enabled: pair.enabled, intervalSeconds: pair.amount };
}

/** The settings plus what kept history costs. */
export function getSettings(db: CodexDb): CodexSettings {
  return { revisionHistory: { ...revisionSettings(db), ...revisionHistoryUsage(db) }, autosave: autosaveSettings(db) };
}

/**
 * Leaf write. Each switch must be a real boolean: coercing a missing one to `false` would silently turn undo
 * history or autosave off. Out-of-range numbers are clamped.
 */
export function writeSettings(db: CodexDb, input: CodexSettingsInput): void {
  const enabled = input?.revisionHistory?.enabled;
  if (typeof enabled !== "boolean")
    throw new CodexValidationError("Revision history must be switched on or off explicitly.");
  const windowMinutes = revisionWindowMinutes(input?.revisionHistory?.windowMinutes);
  const autosaveEnabled = input?.autosave?.enabled;
  if (typeof autosaveEnabled !== "boolean")
    throw new CodexValidationError("Autosave must be switched on or off explicitly.");
  const intervalSeconds = autosaveIntervalSeconds(input?.autosave?.intervalSeconds);
  db.database
    .prepare(
      "UPDATE codex_meta SET revision_history_enabled = ?, revision_window_minutes = ?, autosave_enabled = ?, autosave_interval_seconds = ? WHERE id = 1"
    )
    .run(enabled ? 1 : 0, windowMinutes, autosaveEnabled ? 1 : 0, intervalSeconds);
}
