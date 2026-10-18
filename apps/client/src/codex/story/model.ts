import {
  calendarYearOf,
  dateToInstant,
  formatWorldYear,
  instantToDate,
  weekdayOf,
  type CodexCalendar,
  type CodexChronicleKind,
  type CodexInWorldDate
} from "@vtt/domain";

/**
 * The Story's reading rules over the chronicle, shared by the GM's and the players' Story: which session a record
 * belongs to, the in-world days a session covered, and the lanes, ages, months and days the timeline draws. A
 * player's records are the player's own projection, so nothing here can show a player more than the server sent.
 */

export type StoryRecord = Readonly<{
  kind: CodexChronicleKind;
  id: string;
  title: string | null;
  text: string;
  sessionId: string | null;
  sessionNumber: number | null;
  calendarInstant: number | null;
  inWorldLabel: string | null;
  /** The GM's records say who sees them; a player's need not. */
  revealedToPlayers?: boolean;
  fired?: boolean;
}>;
export type StorySession = Readonly<{ id: string; sessionNumber: number | null }>;

/** The world's own history: events, and the clocks running down in it. Everything else is the party's. */
export type Lane = "world" | "party";
export function laneOf(kind: CodexChronicleKind): Lane {
  return kind === "event" || kind === "deadline" ? "world" : "party";
}

/** The kinds the session spine holds: what the party did. Events live on the timeline and deadlines in Clocks. */
export function onSpine(kind: CodexChronicleKind): boolean {
  return kind !== "event" && kind !== "deadline";
}

const byInstant = <R extends StoryRecord>(a: R, b: R) =>
  (a.calendarInstant ?? Number.MAX_SAFE_INTEGER) - (b.calendarInstant ?? Number.MAX_SAFE_INTEGER);

/**
 * A session's real date as people say it: "October 24", or "Saturday, October 24" with the weekday. Text that isn't
 * an ISO date is shown as it was typed.
 */
export function realDateLabel(value: string | null, withWeekday = false): string | null {
  if (!value?.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    ...(withWeekday ? { weekday: "long" } : {})
  });
}

/** A record's day, short: "Emberfall 13". The month or the session around it carries the year. */
export function recordDay(
  record: Readonly<{ calendarInstant: number | null; inWorldLabel: string | null }>,
  calendar: CodexCalendar | null
): string | null {
  if (record.calendarInstant === null) return record.inWorldLabel;
  return daySpanLabel(calendar, record.calendarInstant, record.calendarInstant) || record.inWorldLabel;
}

/** "Emberfall 12", or "Emberfall 12 to 13", or across months "Emberfall 30 to Harvest 2". */
export function daySpanLabel(calendar: CodexCalendar | null, from: number, to: number): string {
  if (!calendar || calendar.months.length === 0) return "";
  const start = instantToDate(calendar, Math.min(from, to));
  const end = instantToDate(calendar, Math.max(from, to));
  const name = (date: CodexInWorldDate) => calendar.months[date.month]?.name ?? "";
  if (start.year === end.year && start.month === end.month && start.day === end.day)
    return `${name(start)} ${start.day}`;
  if (start.year === end.year && start.month === end.month) return `${name(start)} ${start.day} to ${end.day}`;
  return `${name(start)} ${start.day} to ${name(end)} ${end.day}`;
}

/** The in-world days a session covered, from the dated records filed under it. Empty when none is dated. */
export function sessionDays(
  records: readonly StoryRecord[],
  sessionId: string,
  calendar: CodexCalendar | null
): string {
  const instants = records
    .filter((record) => record.sessionId === sessionId && record.calendarInstant !== null)
    .map((record) => record.calendarInstant!);
  if (instants.length === 0) return "";
  return daySpanLabel(calendar, Math.min(...instants), Math.max(...instants));
}

export type SpineGroup<S, R> = Readonly<{ key: string; session: S | null; records: readonly R[] }>;

/**
 * The session spine: every session newest first, each with the records filed under it by date, then whatever is
 * filed under none. Events and deadlines stay off it.
 */
export function spineGroups<S extends StorySession, R extends StoryRecord>(
  sessions: readonly S[],
  records: readonly R[]
): SpineGroup<S, R>[] {
  const ordered = [...sessions].sort(
    (a, b) => (b.sessionNumber ?? Number.MAX_SAFE_INTEGER) - (a.sessionNumber ?? Number.MAX_SAFE_INTEGER)
  );
  const party = records.filter((record) => onSpine(record.kind));
  const known = new Set(sessions.map((session) => session.id));
  const groups: SpineGroup<S, R>[] = ordered.map((session) => ({
    key: session.id,
    session,
    records: party.filter((record) => record.sessionId === session.id).sort(byInstant)
  }));
  const loose = party.filter((record) => !record.sessionId || !known.has(record.sessionId)).sort(byInstant);
  if (loose.length > 0) groups.push({ key: "none", session: null, records: loose });
  return groups;
}

/** "Sessions 1 to 5", "Session 3", or empty, for the session numbers among some records. */
export function sessionRangeLabel(numbers: readonly (number | null)[]): string {
  const known = [...new Set(numbers.filter((value): value is number => value !== null))].sort((a, b) => a - b);
  if (known.length === 0) return "";
  if (known.length === 1) return `Session ${known[0]}`;
  return `Sessions ${known[0]} to ${known[known.length - 1]}`;
}

// ----- The timeline's three zooms -----

export type AgeMark = Readonly<{
  key: string;
  year: number;
  yearLabel: string;
  title: string;
  line: string;
  /** The record behind the mark; null for the campaign's own mark. */
  record: StoryRecord | null;
  hidden: boolean;
  campaign: boolean;
  /** A run of quiet years before this mark, folded out of the line. */
  foldBefore: boolean;
}>;

/** Years quieter than this between two marks fold to a break in the line. */
const FOLD_YEARS = 25;

/** The first line of a record's text, as a summary under its title; the stylesheet clamps a long one. */
export function summaryOf(text: string): string {
  return (
    text
      .split("\n")
      .map((each) =>
        each
          .replace(/[#*_>`]/g, "")
          .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target, shown) => shown ?? target)
          .trim()
      )
      .find(Boolean) ?? ""
  );
}

/**
 * The world's history as marks, oldest first: every dated event, then the campaign itself at the reader's own year,
 * spanning the sessions played. A gap of quiet years folds.
 */
export function ageMarks(
  records: readonly StoryRecord[],
  calendar: CodexCalendar | null,
  now: CodexInWorldDate | null
): AgeMark[] {
  if (!calendar || calendar.months.length === 0) return [];
  const events = records
    .filter((record) => record.kind === "event" && record.calendarInstant !== null)
    .sort(byInstant)
    .map((record) => {
      const year = calendarYearOf(calendar, record.calendarInstant!);
      return {
        key: record.id,
        year,
        yearLabel: formatWorldYear(calendar, year),
        title: record.title ?? summaryOf(record.text),
        line: summaryOf(record.text),
        record,
        hidden: record.revealedToPlayers === false,
        campaign: false,
        foldBefore: false
      };
    });
  const marks: Omit<AgeMark, "foldBefore">[] = [...events];
  if (now) {
    const range = sessionRangeLabel(
      records.filter((record) => onSpine(record.kind)).map((record) => record.sessionNumber)
    );
    marks.push({
      key: "campaign",
      year: now.year,
      yearLabel: formatWorldYear(calendar, now.year),
      title: "The campaign",
      line: range || `${calendar.months[now.month]?.name ?? ""} ${formatWorldYear(calendar, now.year)}`,
      record: null,
      hidden: false,
      campaign: true
    });
  }
  marks.sort((a, b) => a.year - b.year || (a.campaign ? 1 : 0) - (b.campaign ? 1 : 0));
  return marks.map((mark, index) => ({
    ...mark,
    foldBefore: index > 0 && mark.year - marks[index - 1].year > FOLD_YEARS
  }));
}

export type YearMonth = Readonly<{
  month: number;
  name: string;
  records: readonly StoryRecord[];
  sessions: string;
}>;

/** One year month by month: what is dated in each month, and the sessions it saw. */
export function yearMonths(records: readonly StoryRecord[], calendar: CodexCalendar | null, year: number): YearMonth[] {
  if (!calendar || calendar.months.length === 0) return [];
  return calendar.months.map((month, index) => {
    const first = dateToInstant(calendar, { year, month: index, day: 1 });
    const last = first + month.days - 1;
    const inMonth = records
      .filter(
        (record) => record.calendarInstant !== null && record.calendarInstant >= first && record.calendarInstant <= last
      )
      .sort(byInstant);
    return {
      month: index,
      name: month.name,
      records: inMonth,
      sessions: sessionRangeLabel(
        inMonth.filter((record) => onSpine(record.kind)).map((record) => record.sessionNumber)
      )
    };
  });
}

export type MonthDay = Readonly<{
  instant: number;
  day: number;
  weekday: string | null;
  records: readonly StoryRecord[];
}>;

/** The days of one month that hold anything, in order. */
export function monthDays(
  records: readonly StoryRecord[],
  calendar: CodexCalendar | null,
  year: number,
  month: number
): MonthDay[] {
  if (!calendar || calendar.months.length === 0) return [];
  const def = calendar.months[Math.min(month, calendar.months.length - 1)];
  const first = dateToInstant(calendar, { year, month, day: 1 });
  const days = new Map<number, StoryRecord[]>();
  for (const record of records) {
    if (record.calendarInstant === null) continue;
    const offset = record.calendarInstant - first;
    if (offset < 0 || offset >= def.days) continue;
    const bucket = days.get(record.calendarInstant) ?? [];
    bucket.push(record);
    days.set(record.calendarInstant, bucket);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a - b)
    .map(([instant, list]) => {
      const date = instantToDate(calendar, instant);
      return { instant, day: date.day, weekday: weekdayOf(calendar, date), records: list };
    });
}

/** A date with its weekday: "Galeday, Emberfall 14". */
export function dayWithWeekday(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const weekday = weekdayOf(calendar, date);
  const name = calendar.months[date.month]?.name ?? "";
  return weekday ? `${weekday}, ${name} ${date.day}` : `${name} ${date.day}`;
}

/** The instant of a date, or null when there is no date or no calendar to place it on. */
export function instantOf(calendar: CodexCalendar | null, date: CodexInWorldDate | null | undefined): number | null {
  return calendar && date && calendar.months.length > 0 ? dateToInstant(calendar, date) : null;
}
