import { useMemo, useState, type ReactNode } from "react";
import { Button, IconChevron } from "@vtt/ui";
import {
  calendarDaysPerYear,
  dateToInstant,
  formatWorldYear,
  weekdayIndex,
  type CodexCalendar,
  type CodexChronicleKind,
  type CodexInWorldDate
} from "@vtt/domain";
import { laneOf } from "./model";

/** The chronicle's month: the visible month, its grid of days, and the records on each day. */

type DatedRecord = Readonly<{
  kind: CodexChronicleKind;
  calendarInstant: number | null;
  /** The GM's records say who sees them; a hidden one marks its day violet. */
  revealedToPlayers?: boolean;
}>;

/**
 * The month on show: the address's `?y=`/`?m=`, else the month holding `fallback` (the reader's own date).
 * Records are placed by the server's `calendarInstant`, never re-derived here.
 */
export function useMonthView<R extends DatedRecord>(
  calendar: CodexCalendar | null,
  records: readonly R[],
  view: Readonly<{ year: string | null; month: string | null }>,
  fallback: CodexInWorldDate | null,
  onMonthChange: (year: number, month: number) => void
) {
  const [selectedInstant, setSelectedInstant] = useState<number | null>(null);
  const monthCount = calendar?.months.length ?? 0;
  const viewYear =
    view.year !== null && Number.isFinite(Number(view.year)) ? Math.trunc(Number(view.year)) : (fallback?.year ?? 0);
  const viewMonth =
    view.month !== null && Number.isFinite(Number(view.month))
      ? Math.max(0, Math.min(Math.trunc(Number(view.month)), Math.max(0, monthCount - 1)))
      : (fallback?.month ?? 0);

  const grid = useMemo(() => {
    if (!calendar || calendar.months.length === 0 || calendarDaysPerYear(calendar) === 0) return null;
    const monthDef = calendar.months[Math.min(viewMonth, calendar.months.length - 1)];
    const first = { year: viewYear, month: viewMonth, day: 1 };
    const firstInstant = dateToInstant(calendar, first);
    return {
      monthDef,
      title: `${monthDef.name} ${formatWorldYear(calendar, viewYear)}`,
      // A calendar with no weekdays still lays its days out in one column.
      weekdays: calendar.weekdays.length > 0 ? calendar.weekdays : ["Day"],
      lead: weekdayIndex(calendar, first) ?? 0,
      days: Array.from({ length: monthDef.days }, (_, index) => ({ day: index + 1, instant: firstInstant + index }))
    };
  }, [calendar, viewYear, viewMonth]);

  const byInstant = useMemo(() => {
    const map = new Map<number, R[]>();
    for (const record of records) {
      if (record.calendarInstant === null) continue;
      const bucket = map.get(record.calendarInstant) ?? [];
      bucket.push(record);
      map.set(record.calendarInstant, bucket);
    }
    return map;
  }, [records]);

  const step = (delta: number) => {
    if (!calendar || calendar.months.length === 0) return;
    const count = calendar.months.length;
    const total = viewYear * count + viewMonth + delta;
    setSelectedInstant(null);
    onMonthChange(Math.floor(total / count), ((total % count) + count) % count);
  };
  const selectedRecords = selectedInstant === null ? [] : (byInstant.get(selectedInstant) ?? []);
  return { viewYear, viewMonth, grid, byInstant, step, selectedInstant, setSelectedInstant, selectedRecords };
}

export type MonthGridModel = NonNullable<ReturnType<typeof useMonthView>["grid"]>;

/** Previous, the month's name, next, and whatever else the caller adds (the GM's year jump). */
export function MonthBar({
  title,
  onStep,
  children
}: Readonly<{ title: string; onStep: (delta: number) => void; children?: ReactNode }>) {
  return (
    <div className="story-cal-monthbar">
      <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => onStep(-1)}>
        <IconChevron className="story-chevron-left" />
      </Button>
      <h3 className="story-cal-monthname">{title}</h3>
      <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => onStep(1)}>
        <IconChevron className="story-chevron-right" />
      </Button>
      {children}
    </div>
  );
}

/** A day's dots: one per record up to three, violet when hidden, amber for the world's own, else blue. */
const MAX_DOTS = 3;
const dotTone = (record: DatedRecord) =>
  record.revealedToPlayers === false ? "is-hidden" : laneOf(record.kind) === "world" ? "is-world" : "is-party";

/**
 * The days as a grid under their weekday names, two letters each so a narrow side column still fits them; the
 * full name is the header's spoken name. Each day is one button with a dot per record on it, and `marks` adds the
 * reader's dates to a day's class and spoken name.
 */
export function MonthGrid({
  grid,
  byInstant,
  selectedInstant,
  onSelect,
  marks
}: Readonly<{
  grid: MonthGridModel;
  byInstant: ReadonlyMap<number, readonly DatedRecord[]>;
  selectedInstant: number | null;
  onSelect: (instant: number | null) => void;
  marks: (instant: number) => Readonly<{ className: string; label: string }>;
}>) {
  return (
    <div
      className="story-cal-grid"
      role="grid"
      aria-label={grid.title}
      style={{ "--story-week": String(grid.weekdays.length) } as React.CSSProperties}
    >
      {grid.weekdays.map((weekday) => (
        <div key={weekday} className="story-cal-weekday" role="columnheader" aria-label={weekday} title={weekday}>
          <span aria-hidden="true">{weekday.slice(0, 2)}</span>
        </div>
      ))}
      {Array.from({ length: grid.lead }, (_, index) => (
        <div key={`lead-${index}`} className="story-cal-cell is-blank" aria-hidden="true" />
      ))}
      {grid.days.map(({ day, instant }) => {
        const dayRecords = byInstant.get(instant) ?? [];
        const mark = marks(instant);
        return (
          /* The cell is the tap target; ::after boxes would overlap across the grid. */
          <button
            key={instant}
            type="button"
            className={`story-cal-cell${mark.className}${selectedInstant === instant ? " is-selected" : ""}`}
            aria-pressed={selectedInstant === instant}
            aria-label={`${grid.monthDef.name} ${day}${dayRecords.length ? `, ${dayRecords.length} record${dayRecords.length === 1 ? "" : "s"}` : ""}${mark.label}`}
            onClick={() => onSelect(selectedInstant === instant ? null : instant)}
          >
            <span className="story-cal-daynum">{day}</span>
            {dayRecords.length > 0 && (
              <span className="story-cal-dots" aria-hidden="true">
                {dayRecords.slice(0, MAX_DOTS).map((record, index) => (
                  <span key={index} className={`story-cal-dot ${dotTone(record)}`} />
                ))}
                {dayRecords.length > MAX_DOTS && (
                  <span className="story-cal-more">+{dayRecords.length - MAX_DOTS}</span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
