// The in-world calendar's arithmetic, shared so the server's stored instants and labels and the client's
// display agree. A calendar the server stores has at least one month of at least one day; the guards here
// keep a half-edited calendar on the client from dividing by zero.

import { z } from "zod";

export type CodexCalendarMonth = Readonly<{ name: string; days: number }>;
/** An era runs from `startYear` until the next. A date's era is derived from its year, never stored. */
export type CodexCalendarEra = Readonly<{ name: string; startYear: number }>;
/** A structured in-world date; `month` is a 0-based index into the calendar's months. Requests and responses
 *  carry the same bounds, so both read this one schema. */
export const CodexInWorldDateSchema = z.object({
  year: z.number().int().min(-100_000).max(100_000),
  month: z.number().int().min(0).max(23),
  day: z.number().int().min(1).max(400)
});
export type CodexInWorldDate = Readonly<z.infer<typeof CodexInWorldDateSchema>>;
/** The world's calendar. Eras are sorted by `startYear`; `currentDate` is the GM's "now". */
export type CodexCalendar = Readonly<{
  yearName: string;
  eras?: readonly CodexCalendarEra[];
  months: readonly CodexCalendarMonth[];
  weekdays: readonly string[];
  currentDate?: CodexInWorldDate | null;
}>;

export function calendarDaysPerYear(calendar: CodexCalendar): number {
  return calendar.months.reduce((sum, month) => sum + month.days, 0);
}

/** Never 0, so instant arithmetic stays finite while a calendar is being edited. */
function daysPerYear(calendar: CodexCalendar): number {
  return calendarDaysPerYear(calendar) || 1;
}

/** The date with its month and day clamped into the calendar and its parts truncated. */
export function clampToCalendar(calendar: CodexCalendar, date: CodexInWorldDate): CodexInWorldDate {
  const month = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  const days = Math.max(1, calendar.months[month]?.days ?? 1);
  return { year: Math.trunc(date.year), month, day: Math.min(Math.max(1, Math.trunc(date.day)), days) };
}

/** A sortable day number: one integer per date, negative years included. The inverse of `instantToDate`. */
export function dateToInstant(calendar: CodexCalendar, date: CodexInWorldDate): number {
  const clamped = clampToCalendar(calendar, date);
  let dayOfYear = 0;
  for (let index = 0; index < clamped.month; index += 1) dayOfYear += calendar.months[index].days;
  return clamped.year * daysPerYear(calendar) + dayOfYear + (clamped.day - 1);
}

export function instantToDate(calendar: CodexCalendar, instant: number): CodexInWorldDate {
  const perYear = daysPerYear(calendar);
  const year = Math.floor(instant / perYear);
  let remainder = instant - year * perYear;
  let month = 0;
  while (month < calendar.months.length - 1 && remainder >= calendar.months[month].days) {
    remainder -= calendar.months[month].days;
    month += 1;
  }
  return { year, month, day: remainder + 1 };
}

export function calendarYearOf(calendar: CodexCalendar, instant: number): number {
  return Math.floor(instant / daysPerYear(calendar));
}

/** The last era whose start the year has reached; none before the first era. */
export function eraForYear(calendar: CodexCalendar, year: number): CodexCalendarEra | null {
  let found: CodexCalendarEra | null = null;
  for (const era of calendar.eras ?? []) {
    if (Math.trunc(year) >= era.startYear) found = era;
    else break;
  }
  return found;
}

/** "Third Age 1492 DR": the era leads and `yearName` trails. */
export function formatWorldYear(calendar: CodexCalendar, year: number): string {
  const era = eraForYear(calendar, year);
  return `${era ? `${era.name} ` : ""}${Math.trunc(year)}${calendar.yearName ? ` ${calendar.yearName}` : ""}`;
}

/** "Hammer 4, 1491 DR", read at the clamped date so it names the day the date sorts on. */
export function formatWorldDate(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const clamped = clampToCalendar(calendar, date);
  return `${calendar.months[clamped.month]?.name ?? ""} ${clamped.day}, ${formatWorldYear(calendar, clamped.year)}`;
}

/** The date's place in the week: the week runs on unbroken from instant 0, negative years included. */
export function weekdayIndex(calendar: CodexCalendar, date: CodexInWorldDate): number | null {
  const count = calendar.weekdays.length;
  if (count === 0) return null;
  return ((dateToInstant(calendar, date) % count) + count) % count;
}

/** The date's weekday name, or null for a calendar without weekdays. */
export function weekdayOf(calendar: CodexCalendar, date: CodexInWorldDate): string | null {
  const index = weekdayIndex(calendar, date);
  return index === null ? null : calendar.weekdays[index];
}
