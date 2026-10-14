import {
  dateToInstant,
  formatWorldDate,
  instantToDate,
  weekdayOf,
  type CodexCalendar,
  type CodexInWorldDate
} from "@vtt/domain";
import type { CodexDb } from "./db.js";
import { CODEX_AUTHORED_TABLES } from "./schema.js";
import { CodexValidationError, shortLabel } from "./validate.js";

/**
 * The world's calendar and its two clocks. `calendar_json.currentDate` is the GM's prep clock; the published
 * date (its own columns, since a calendar PUT replaces the blob wholesale) is the only clock a player sees.
 * A dated record keeps the raw date it was given; its sortable instant and label derive from the calendar.
 */

export const DEFAULT_CALENDAR: CodexCalendar = {
  yearName: "",
  months: [
    { name: "Deepwinter", days: 30 },
    { name: "The Claw", days: 30 },
    { name: "Melting", days: 30 },
    { name: "Greengrass", days: 30 },
    { name: "Mirtul", days: 30 },
    { name: "Flamerule", days: 30 },
    { name: "Highsun", days: 30 },
    { name: "Harvest", days: 30 },
    { name: "Fading", days: 30 },
    { name: "Leaffall", days: 30 },
    { name: "The Rotting", days: 30 },
    { name: "Deadwinter", days: 30 }
  ],
  weekdays: ["First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh"]
};

export function normalizeCalendar(input: CodexCalendar): CodexCalendar {
  const months = (input.months ?? []).map((month) => ({
    name: shortLabel(month.name, 40, "month name") ?? "Month",
    days: Number.isFinite(month.days) ? Math.max(1, Math.min(Math.trunc(month.days), 400)) : 30
  }));
  if (months.length < 1 || months.length > 24) throw new CodexValidationError("A calendar needs 1 to 24 months.");
  const weekdays = (input.weekdays ?? []).slice(0, 20).map((day) => shortLabel(day, 40, "weekday") ?? "Day");
  const current = input.currentDate;
  const currentDate =
    current && Number.isFinite(current.year) && Number.isFinite(current.month) && Number.isFinite(current.day)
      ? {
          year: Math.trunc(current.year),
          month: Math.max(0, Math.min(Math.trunc(current.month), months.length - 1)),
          day: Math.max(1, Math.trunc(current.day))
        }
      : null;
  // Sorted because `eraForYear` takes the last era reached; capped since this is client input.
  const eras = (input.eras ?? [])
    .slice(0, 20)
    .map((era) => ({
      name: shortLabel(era.name, 40, "era name") ?? "Era",
      startYear: Number.isFinite(era.startYear) ? Math.trunc(era.startYear) : 0
    }))
    .sort((a, b) => a.startYear - b.startYear);
  return { yearName: shortLabel(input.yearName, 20, "era") ?? "", eras, months, weekdays, currentDate };
}

/** The label a dated record stores: "Sul, Hammer 4, 1491 DR". */
export function inWorldLabel(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const weekday = weekdayOf(calendar, date);
  const base = formatWorldDate(calendar, date);
  return weekday === null ? base : `${weekday}, ${base}`;
}

export function getCalendar(db: CodexDb): CodexCalendar {
  const row = db.database.prepare("SELECT calendar_json FROM codex_meta WHERE id = 1").get() as {
    calendar_json: string | null;
  };
  if (!row.calendar_json) return DEFAULT_CALENDAR;
  try {
    return normalizeCalendar(JSON.parse(row.calendar_json) as CodexCalendar);
  } catch {
    return DEFAULT_CALENDAR;
  }
}

/**
 * Leaf write: replaces the calendar and recomputes every dated record's instant and label from its raw date.
 * Pages are selected by having a date, not by type, so a later type change finds them current.
 */
export function writeCalendar(db: CodexDb, calendar: CodexCalendar): void {
  const { database } = db;
  database.prepare("UPDATE codex_meta SET calendar_json = ? WHERE id = 1").run(JSON.stringify(calendar));
  for (const table of ["codex_journal", "codex_pages"] as const) {
    const dated = database
      .prepare(
        `SELECT id, in_world_year AS year, in_world_month AS month, in_world_day AS day FROM ${table} WHERE in_world_year IS NOT NULL`
      )
      .all() as Array<{ id: string; year: number; month: number; day: number }>;
    const update = database.prepare(`UPDATE ${table} SET calendar_instant = ?, in_world_label = ? WHERE id = ?`);
    for (const row of dated) {
      const date = { year: row.year, month: row.month, day: row.day };
      update.run(dateToInstant(calendar, date), inWorldLabel(calendar, date), row.id);
    }
  }
  // The first date on an empty Codex publishes itself; in a running campaign, setting the GM date never publishes.
  if (calendar.currentDate && getPublishedDate(db) === null && isUnusedCodex(db))
    writePublishedDate(db, calendar.currentDate);
}

/** No authored records yet; derived tables do not count. */
function isUnusedCodex(db: CodexDb): boolean {
  const clauses = CODEX_AUTHORED_TABLES.map((table) => `EXISTS(SELECT 1 FROM ${table})`).join(" OR ");
  const row = db.database.prepare(`SELECT (${clauses}) AS used`).get() as { used: number };
  return !row.used;
}

/** The players' clock; it moves only on publish. All three parts or none. */
export function getPublishedDate(db: CodexDb): CodexInWorldDate | null {
  type Row = { published_year: number | null; published_month: number | null; published_day: number | null };
  // A stored value beyond 2^53-1 makes `node:sqlite` throw; treat it as "nothing published" so export still works.
  let row: Row;
  try {
    row = db.database
      .prepare("SELECT published_year, published_month, published_day FROM codex_meta WHERE id = 1")
      .get() as Row;
  } catch {
    return null;
  }
  if (row.published_year === null || row.published_month === null || row.published_day === null) return null;
  if (![row.published_year, row.published_month, row.published_day].every((part) => Number.isSafeInteger(part)))
    return null;
  return { year: row.published_year, month: row.published_month, day: row.published_day };
}

/** Leaf write; `null` clears. */
export function writePublishedDate(db: CodexDb, date: CodexInWorldDate | null): void {
  db.database
    .prepare("UPDATE codex_meta SET published_year = ?, published_month = ?, published_day = ? WHERE id = 1")
    .run(date ? date.year : null, date ? date.month : null, date ? date.day : null);
}

/** The GM's clock as an instant. Never pass this to a player projection; use `publishedInstant`. */
export function campaignInstant(db: CodexDb): number | null {
  const calendar = getCalendar(db);
  return calendar.currentDate ? dateToInstant(calendar, calendar.currentDate) : null;
}

/** The published date as an instant: the only clock a player-facing reader may use. */
export function publishedInstant(db: CodexDb): number | null {
  const date = getPublishedDate(db);
  return date ? dateToInstant(getCalendar(db), date) : null;
}

export function dateForInstant(db: CodexDb, instant: number): CodexInWorldDate {
  return instantToDate(getCalendar(db), instant);
}

/** A record's dating columns: the raw date, its sortable instant, and its label. */
export type ResolvedDate = Readonly<{ instant: number | null; label: string | null; date: CodexInWorldDate | null }>;

/** A structured date wins (instant, label, raw date); else a free-text label with no instant. Pages pass no label. */
export function resolveDate(
  db: CodexDb,
  date: CodexInWorldDate | null | undefined,
  label: string | null | undefined
): ResolvedDate {
  if (date && Number.isFinite(date.year) && Number.isFinite(date.month) && Number.isFinite(date.day)) {
    const calendar = getCalendar(db);
    const normalized = { year: Math.trunc(date.year), month: Math.trunc(date.month), day: Math.trunc(date.day) };
    return {
      instant: dateToInstant(calendar, normalized),
      label: inWorldLabel(calendar, normalized),
      date: normalized
    };
  }
  return { instant: null, label: shortLabel(label, 120, "in-world date"), date: null };
}

/** The GM's clock as a resolved date, for records written "now" (fights, quest and standing history). */
export function resolveNow(db: CodexDb): ResolvedDate {
  return resolveDate(db, getCalendar(db).currentDate ?? null, null);
}
