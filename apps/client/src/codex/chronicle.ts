/**
 * The chronicle's shared reading rules (CT-11 / CT-12) — what a row SAYS and how the two lenses group.
 *
 * Pure functions, no JSX, on purpose. The GM Journal and the player Journal are deliberately separate
 * implementations (D-2), and the accepted consequence is drift; what must not drift is the *meaning* of
 * a row — when it happened and what kind of record it is. So the meaning lives here once and both
 * readers import it, while each keeps its own markup.
 */

import { calendarYearOf, formatWorldYear, type CodexCalendar, type CodexChronicleKind, type CodexChronicleRecord } from "./api";

/**
 * How a record says *when* it happened, in the chronicle's own order of preference.
 *
 * Structurally typed rather than tied to one record type: a GM chronicle row, a player chronicle row and
 * a raw journal entry all answer this question the same way, and the Campaign dashboard asks it too. Two
 * implementations is exactly how a dashboard ends up disagreeing with the timeline it links into.
 */
export type ChronicleWhen = Readonly<{ inWorldLabel: string | null; sessionNumber: number | null; realDate: string | null; createdAt: string }>;
export function chronicleWhenLabel(record: ChronicleWhen): string {
  if (record.inWorldLabel) return record.inWorldLabel;
  if (record.sessionNumber !== null) return `Session ${record.sessionNumber}`;
  if (record.realDate) return record.realDate;
  return new Date(record.createdAt).toLocaleDateString();
}

/**
 * R2: a record's kind reads by **icon plus label**, never by colour alone. The glyphs are the ones the
 * entity vocabulary already uses — `scroll` is a note, `hourglass` is an `event` page (`ENTITY_DEFS`), so
 * an event row on the chronicle looks like the same record it is in the tree, the graph and search.
 */
export const CHRONICLE_KIND_META: Readonly<Record<CodexChronicleKind, Readonly<{ iconId: string; label: string; tone: "neutral" | "caution" | "info" }>>> = {
  entry: { iconId: "scroll", label: "Entry", tone: "neutral" },
  combat: { iconId: "battle", label: "Battle", tone: "caution" },
  event: { iconId: "hourglass", label: "Event", tone: "info" }
};

/**
 * CT-12's two lenses. **Same records, two orderings** — the toggle regroups what is already loaded and
 * never refetches, so the lenses cannot disagree about what exists, and switching cannot mutate anything.
 */
export type ChronicleLens = "date" | "session";
export const CHRONICLE_LENSES: ReadonlyArray<Readonly<{ id: ChronicleLens; label: string }>> = [
  { id: "date", label: "By in-world date" },
  { id: "session", label: "By session" }
];

export type ChronicleGroup = Readonly<{ key: string; label: string; records: readonly CodexChronicleRecord[] }>;

/**
 * Group the chronicle for one lens.
 *
 * Both lenses read ascending — earliest first — because that is how the timeline has always read and two
 * lenses running in opposite directions would make the toggle feel like a different screen rather than a
 * different question. Records with no key sort last in both ("Undated" / "No session yet").
 *
 * `records` is expected in the server's chronological order and is never re-sorted here beyond the group
 * key: within a group, order is the order the server sent, which is the one canonical chronology.
 *
 * By session, an `event` page always lands in "No session yet": sessions become real records in M9, and
 * inventing a session for a dated wiki page would be guessing.
 */
export function groupChronicle(records: readonly CodexChronicleRecord[], lens: ChronicleLens, calendar: CodexCalendar | null): ChronicleGroup[] {
  const buckets = new Map<number | null, CodexChronicleRecord[]>();
  for (const record of records) {
    const key = lens === "session"
      ? record.sessionNumber
      : (record.calendarInstant !== null && calendar ? calendarYearOf(calendar, record.calendarInstant) : null);
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  return [...buckets.keys()]
    .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
    .map((key) => ({
      key: key === null ? "none" : String(key),
      label: key === null
        ? (lens === "session" ? "No session yet" : "Undated")
        : (lens === "session" ? `Session ${key}` : (calendar ? formatWorldYear(calendar, key) : String(key))),
      records: buckets.get(key)!
    }));
}
