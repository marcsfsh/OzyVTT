/**
 * The chronicle's shared reading rules (CT-11 / CT-12, and M11's CT-5 / CT-10) — what a row SAYS and how
 * the two lenses group.
 *
 * Pure functions, no JSX, on purpose. The GM Journal and the player Journal are deliberately separate
 * implementations (D-2), and the accepted consequence is drift; what must not drift is the *meaning* of
 * a row — when it happened and what kind of record it is. So the meaning lives here once and both
 * readers import it, while each keeps its own markup.
 */

import type { BadgeTone } from "@vtt/ui";
import { calendarDaysPerYear, calendarYearOf, dateToInstant, formatWorldYear, instantToDate, type CodexCalendar, type CodexChronicleKind, type CodexChronicleRecord, type CodexDowntimeSummary, type CodexInWorldDate } from "./api";

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
 *
 * M11's two: `danger` for a deadline — the warning triangle the atlas already uses for a threat, which is
 * exactly what a deadline is (a thing that will happen whether or not the party acts) — and `campfire`
 * for downtime, the between-adventures image, deliberately NOT the `camp` tent, because a tent triangle
 * beside the deadline's warning triangle would be two triangles telling two different stories.
 *
 * Every `iconId` here must exist in `CODEX_ICONS` (`icons.tsx`). `iconChildren` falls back to `pin` for
 * an unknown id, so a typo would not throw — it would silently render the wrong glyph on every row of
 * that kind. `chronicle-kinds.test.tsx` asserts each one resolves.
 */
export const CHRONICLE_KIND_META: Readonly<Record<CodexChronicleKind, Readonly<{ iconId: string; label: string; tone: "neutral" | "caution" | "info" }>>> = {
  entry: { iconId: "scroll", label: "Entry", tone: "neutral" },
  combat: { iconId: "battle", label: "Battle", tone: "caution" },
  event: { iconId: "hourglass", label: "Event", tone: "info" },
  // `caution`, as the contract fixes it: a deadline is the one row on the chronicle that is a warning.
  deadline: { iconId: "danger", label: "Deadline", tone: "caution" },
  // `info`, not `neutral`. `neutral` is the ordinary entry's tone, so a neutral downtime badge would be
  // indistinguishable from a note's at a glance and the tone would buy nothing; `info` groups it with the
  // other "a dated thing happened" row (`event`), which is what downtime is. R2 is satisfied either way —
  // the WORD carries the meaning and the tone is only a scanning aid.
  downtime: { iconId: "campfire", label: "Downtime", tone: "info" }
};

// ----- M11 / CT-5: what a deadline SAYS -----

/** The minimum needed to say whether a deadline has fired. Satisfied by BOTH chronicle projections. */
export type DeadlineRef = Readonly<{ kind: CodexChronicleKind; fired?: boolean | null }>;

/**
 * Has this deadline passed? **One reader, on purpose** — two copies of this question is how a dashboard
 * card ends up disagreeing with the timeline it links into.
 *
 * `fired` is derived by the SERVER against the campaign clock and is never stored (a stored flag would be
 * a second cache the calendar's reflow had to maintain). This client never recomputes it: a client-side
 * comparison would be a second authority on "has the campaign passed this", and it would be the one that
 * was wrong. All this adds is the kind gate — `fired` means nothing on a note — and a falsy-safe read, so
 * a row that arrives without the key reads as "not fired" rather than as `undefined`.
 */
export function deadlineFired(record: DeadlineRef): boolean {
  return record.kind === "deadline" && record.fired === true;
}

/** R2: the state reads as a WORD. The badge tone below is a scanning aid only. */
export const DEADLINE_STATE_LABEL: Readonly<Record<"fired" | "pending", string>> = { fired: "Passed", pending: "Approaching" };
export function deadlineStateLabel(fired: boolean): string { return fired ? DEADLINE_STATE_LABEL.fired : DEADLINE_STATE_LABEL.pending; }
/** Decorative only; `deadlineStateLabel` is what carries the meaning (design-language R2). */
export function deadlineStateTone(fired: boolean): BadgeTone { return fired ? "danger" : "caution"; }

/**
 * The deadlines for the Campaign dashboard's card, in the order it should read them.
 *
 * **Passed first, then approaching**, each half keeping the order it arrived in — which is the server's
 * one canonical chronology, never re-sorted here (`groupChronicle` below holds the same line).
 *
 * The passed ones are NOT dropped, and that is where this deliberately parts company with `openQuests`.
 * A completed quest is one the GM marked done, so a card headed "Open quests" must stop offering it. A
 * deadline is finished by the *clock*, with nobody deciding anything — this card is the only notice the
 * GM gets that something happened whether or not the party acted, so dropping it the moment it mattered
 * most would be exactly backwards.
 */
export function campaignDeadlines<T extends DeadlineRef>(records: readonly T[]): readonly T[] {
  const deadlines = records.filter((record) => record.kind === "deadline");
  return [...deadlines.filter((record) => deadlineFired(record)), ...deadlines.filter((record) => !deadlineFired(record))];
}

// ----- M11 / CT-10 + O-1: dates the GM is about to move to -----

/**
 * A raw date snapped the way the SERVER snaps it before turning it into an instant
 * (`calendarInstantOf`): the month index clamped into the calendar, then the day clamped into that
 * month. The client's own `dateToInstant` clamps the day only at the bottom (`>= 1`), so a stored
 * "day 31 of a 30-day month" — the one lossy date the calendar admits — would otherwise place a day
 * later here than it does on the server, and the confirm below would promise a date the clock will not
 * actually land on.
 */
function clampToCalendar(calendar: CodexCalendar, date: CodexInWorldDate): CodexInWorldDate {
  const month = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  const days = calendar.months[month]?.days ?? 1;
  return { year: Math.trunc(date.year), month, day: Math.min(Math.max(1, Math.trunc(date.day)), days) };
}

/**
 * O-3: the date applying this downtime would move the campaign clock to — "now, plus its days".
 *
 * No new date maths: this is `instantToDate(dateToInstant(now) + days)`, the same pair of helpers the
 * timeline's Today marker and its year grouping already run on, which are themselves the mirror of the
 * server's `calendarInstantOf` / `dateForInstant`. Walking months is their job, so a downtime that runs
 * off the end of a month rolls into the next one and off the end of a year rolls the year.
 *
 * `null` when there is nothing to advance FROM (no campaign date set) or nothing to advance BY.
 */
export function downtimeProposedDate(calendar: CodexCalendar | null, days: number): CodexInWorldDate | null {
  const now = calendar?.currentDate;
  if (!calendar || !now || calendar.months.length === 0 || calendarDaysPerYear(calendar) === 0) return null;
  const advance = Math.max(0, Math.trunc(days));
  return instantToDate(calendar, dateToInstant(calendar, clampToCalendar(calendar, now)) + advance);
}

/**
 * What a downtime record SAYS it was, in one line — who, what, and how long.
 *
 * Structurally typed on the payload alone so BOTH projections satisfy it: the GM's carries `applied` as
 * well, and this deliberately does not read it. Whether the GM has confirmed the clock move is workflow
 * state, not part of what happened, so it is said separately on the GM's row and never here — which is
 * also what lets the player's chronicle render this exact line from a payload that has no such field.
 *
 * Blank halves are dropped rather than rendered as stray punctuation: `who` and `activity` are free text
 * and the composer requires only one of them, so "— forging a blade · 7 days" must not be a thing a row
 * can say.
 */
export function downtimeSummaryLabel(payload: CodexDowntimeSummary): string {
  const span = `${payload.days} ${payload.days === 1 ? "day" : "days"}`;
  const said = [payload.who.trim(), payload.activity.trim()].filter(Boolean).join(" — ");
  return said ? `${said} · ${span}` : span;
}

/** Do the GM's clock and the players' clock agree? Nothing to publish, and nothing to say, when they do. */
export function sameInWorldDate(a: CodexInWorldDate | null | undefined, b: CodexInWorldDate | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

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
