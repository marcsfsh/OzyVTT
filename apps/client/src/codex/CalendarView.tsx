import { useMemo, useState } from "react";
import { Alert, Badge, Button, Input, Skeleton } from "@vtt/ui";
import {
  calendarApi, calendarDaysPerYear, dateToInstant, formatWorldDate, formatWorldYear,
  type CodexChronicleRecord, type CodexInWorldDate, type GmCodexCalendar
} from "./api";
import { CHRONICLE_KIND_META, chronicleRowSummary, sameInWorldDate } from "./chronicle";
import { CalendarEditor } from "./CalendarEditor";
import { CodexIcon } from "./icons";
import { GmOnlyTag } from "./SecretMarkers";

/**
 * D17 — the Calendar as a real section, not a button that opens a structure editor.
 *
 * **A lens, never a second chronology** (invariant 7). Every record it places comes from the chronicle
 * the rest of the Codex already reads, positioned by the **server's own `calendarInstant`** — which is
 * exactly why this view could not ship before: the client's `dateToInstant` clamped the day only at the
 * bottom, so a "day 31 of a 30-day month" date landed one day later here than on the server. That was
 * invisible while nothing drew a grid. It is fixed at the source (`api.ts`), and this view uses server
 * instants for every record and the clamped helper only for the calendar's own two clock markers, which
 * arrive as raw dates and carry no instant.
 *
 * The two clocks are the header, in the glossary's words: **Your date** (the GM's prep clock, violet
 * because it is GM-only information) and **Players' date** (what the table has been shown). Publishing
 * is offered only while they differ — there is nothing to publish when they agree.
 */
export type CalendarViewProps = Readonly<{
  gmToken: string;
  calendar: GmCodexCalendar | null;
  records: readonly CodexChronicleRecord[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
  /** `?y=` / `?m=` — the visible month, so a month is a bookmarkable address. */
  year: string | null;
  month: string | null;
  onMonthChange: (year: number, month: number) => void;
  onOpenEntry: (entryId: string) => void;
  onOpenPage: (pageId: string) => void;
}>;

export function CalendarView({ gmToken, calendar, records, loading, error, onChanged, year, month, onMonthChange, onOpenEntry, onOpenPage }: CalendarViewProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [selectedInstant, setSelectedInstant] = useState<number | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const now = calendar?.currentDate ?? null;
  const published = calendar?.publishedDate ?? null;
  const monthCount = calendar?.months.length ?? 0;
  // The visible month: the URL wins, else the GM's own clock, else the first month of year 0.
  const viewYear = year !== null && Number.isFinite(Number(year)) ? Math.trunc(Number(year)) : now?.year ?? 0;
  const viewMonth = month !== null && Number.isFinite(Number(month))
    ? Math.max(0, Math.min(Math.trunc(Number(month)), Math.max(0, monthCount - 1)))
    : now?.month ?? 0;

  const grid = useMemo(() => {
    if (!calendar || calendar.months.length === 0) return null;
    const monthDef = calendar.months[Math.min(viewMonth, calendar.months.length - 1)];
    const weekdays = calendar.weekdays.length > 0 ? calendar.weekdays : ["Day"];
    const firstInstant = dateToInstant(calendar, { year: viewYear, month: viewMonth, day: 1 });
    // A custom calendar's week is whatever the GM defined, and it runs continuously from instant 0 —
    // there is no real-world epoch to align to, so the first weekday of a month is arithmetic, not a
    // lookup. Modulo of a possibly-negative instant is normalized so year −1 does not skew the grid.
    const lead = ((firstInstant % weekdays.length) + weekdays.length) % weekdays.length;
    const days = Array.from({ length: monthDef.days }, (_, index) => ({
      day: index + 1,
      instant: firstInstant + index
    }));
    return { monthDef, weekdays, lead, days };
  }, [calendar, viewYear, viewMonth]);

  /** Every dated record, bucketed by the SERVER's instant. No client date arithmetic touches a record. */
  const byInstant = useMemo(() => {
    const map = new Map<number, CodexChronicleRecord[]>();
    for (const record of records) {
      if (record.calendarInstant === null) continue;
      const bucket = map.get(record.calendarInstant) ?? [];
      bucket.push(record);
      map.set(record.calendarInstant, bucket);
    }
    return map;
  }, [records]);

  const nowInstant = calendar && now ? dateToInstant(calendar, now) : null;
  const publishedInstant = calendar && published ? dateToInstant(calendar, published) : null;
  const diverged = !sameInWorldDate(now, published);

  const step = (delta: number) => {
    if (!calendar || calendar.months.length === 0) return;
    const total = viewYear * calendar.months.length + viewMonth + delta;
    const nextYear = Math.floor(total / calendar.months.length);
    const nextMonth = ((total % calendar.months.length) + calendar.months.length) % calendar.months.length;
    setSelectedInstant(null);
    onMonthChange(nextYear, nextMonth);
  };
  const publish = async () => {
    setPublishing(true); setPublishError(null);
    try { await calendarApi.publish(gmToken); onChanged(); }
    catch (failure) { setPublishError(failure instanceof Error ? failure.message : "Couldn't publish the date."); }
    finally { setPublishing(false); }
  };

  if (loading && !calendar) return <div className="codex-main-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>;
  if (error) return <Alert tone="danger" title="Couldn't load the calendar">{error}</Alert>;
  if (!calendar || !grid) {
    return (
      <div className="codex-main-empty">
        <h3>No calendar yet</h3>
        <p>Give your world its own months and weekdays, and everything dated lands on them.</p>
        <Button variant="primary" onClick={() => setEditorOpen(true)}>Edit calendar</Button>
        {editorOpen && <CalendarEditor gmToken={gmToken} calendar={calendar} onSaved={() => { setEditorOpen(false); onChanged(); }} onClose={() => setEditorOpen(false)} />}
      </div>
    );
  }

  const selectedRecords = selectedInstant === null ? [] : byInstant.get(selectedInstant) ?? [];

  return (
    <div className="codex-calendar">
      <header className="codex-calendar-clocks">
        <div className="codex-calendar-clock">
          <span className="codex-calendar-clocklabel">Your date</span>
          <strong>{now ? formatWorldDate(calendar, now) : "Not set"}</strong>
          <GmOnlyTag />
        </div>
        <div className="codex-calendar-clock">
          <span className="codex-calendar-clocklabel">Players' date</span>
          <strong>{published ? formatWorldDate(calendar, published) : "Not shared yet"}</strong>
        </div>
        {/* One primary action per view, and on THIS view publishing is it — the Journal's copy of this
            row is secondary there for exactly that reason (D25 / §5). */}
        {diverged && <Button variant="primary" disabled={publishing} onClick={() => void publish()}>Publish the date</Button>}
        <Button variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>Edit calendar</Button>
      </header>
      {publishError && <Alert tone="danger">{publishError}</Alert>}

      <div className="codex-calendar-monthbar">
        <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => step(-1)}>‹</Button>
        <h3 className="codex-calendar-monthname">{grid.monthDef.name} {formatWorldYear(calendar, viewYear)}</h3>
        <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => step(1)}>›</Button>
        <label className="codex-calendar-yearjump">
          <span className="nh-sr-only">Jump to year</span>
          <Input type="number" inputMode="numeric" aria-label="Jump to year" value={String(viewYear)}
            onChange={(event) => { const next = Number(event.target.value); if (Number.isFinite(next)) onMonthChange(Math.trunc(next), viewMonth); }} />
        </label>
      </div>

      <div className="codex-calendar-grid" role="grid" aria-label={`${grid.monthDef.name} ${formatWorldYear(calendar, viewYear)}`}
        style={{ "--codex-week": String(grid.weekdays.length) } as React.CSSProperties}>
        {grid.weekdays.map((weekday) => (
          <div key={weekday} className="codex-calendar-weekday" role="columnheader">
            <span className="codex-calendar-weekdayfull">{weekday}</span>
            <span className="codex-calendar-weekdayshort" aria-hidden="true">{weekday.slice(0, 2)}</span>
          </div>
        ))}
        {Array.from({ length: grid.lead }, (_, index) => <div key={`lead-${index}`} className="codex-calendar-cell is-blank" aria-hidden="true" />)}
        {grid.days.map(({ day, instant }) => {
          const dayRecords = byInstant.get(instant) ?? [];
          const isNow = nowInstant === instant;
          const isPublished = publishedInstant === instant;
          const kinds = [...new Set(dayRecords.map((record) => record.kind))].slice(0, 3);
          return (
            /* §4 route 1: the CELL is the tap target, `min-height: var(--tap-min)` — a grid of route-2
               ::after boxes would overlap its neighbours in both axes. */
            <button key={instant} type="button"
              className={`codex-calendar-cell${isNow ? " is-now" : ""}${isPublished ? " is-published" : ""}${selectedInstant === instant ? " is-selected" : ""}`}
              aria-pressed={selectedInstant === instant}
              aria-label={`${grid.monthDef.name} ${day}${dayRecords.length ? `, ${dayRecords.length} record${dayRecords.length === 1 ? "" : "s"}` : ""}${isNow ? ", your date" : ""}${isPublished ? ", players' date" : ""}`}
              onClick={() => setSelectedInstant(selectedInstant === instant ? null : instant)}>
              <span className="codex-calendar-daynum">{day}</span>
              {kinds.length > 0 && (
                <span className="codex-calendar-marks" aria-hidden="true">
                  {kinds.map((kind) => <CodexIcon key={kind} iconId={CHRONICLE_KIND_META[kind].iconId} className="codex-calendar-mark" />)}
                  {dayRecords.length > kinds.length && <span className="codex-calendar-more">+{dayRecords.length - kinds.length}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedInstant !== null && (
        <section className="codex-calendar-day" aria-label="Records on this day">
          <h4 className="codex-campaign-h">
            {grid.monthDef.name} {selectedInstant - dateToInstant(calendar, { year: viewYear, month: viewMonth, day: 1 }) + 1}, {formatWorldYear(calendar, viewYear)}
          </h4>
          {selectedRecords.length === 0
            ? <p className="codex-list-empty">Nothing happened on this day.</p>
            : <nav className="codex-campaign-recent" aria-label="Records on this day">
                {selectedRecords.map((record) => {
                  const meta = CHRONICLE_KIND_META[record.kind];
                  return (
                    <button key={`${record.kind}-${record.id}`} type="button" className="codex-campaign-recentitem"
                      onClick={() => (record.kind === "event" ? onOpenPage(record.id) : onOpenEntry(record.id))}>
                      <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-campaign-recentglyph" />
                      <span className="codex-list-title">{record.title ?? chronicleRowSummary(record) ?? meta.label}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </button>
                  );
                })}
              </nav>}
        </section>
      )}

      {editorOpen && <CalendarEditor gmToken={gmToken} calendar={calendar} onSaved={() => { setEditorOpen(false); onChanged(); }} onClose={() => setEditorOpen(false)} />}
    </div>
  );
}

/** The player's Calendar — one clock, revealed records only, and no structure editing. */
export function PlayerCalendarView({ calendar, records, year, month, onMonthChange, onOpenEntry }: Readonly<{
  calendar: Readonly<{ yearName: string; months: readonly Readonly<{ name: string; days: number }>[]; weekdays: readonly string[]; currentDate?: CodexInWorldDate | null }> | null;
  records: ReadonlyArray<Readonly<{ id: string; kind: CodexChronicleRecord["kind"]; title: string | null; text: string; calendarInstant: number | null }>>;
  year: string | null;
  month: string | null;
  onMonthChange: (year: number, month: number) => void;
  onOpenEntry: (entryId: string) => void;
}>) {
  const [selectedInstant, setSelectedInstant] = useState<number | null>(null);
  const today = calendar?.currentDate ?? null;
  const monthCount = calendar?.months.length ?? 0;
  const viewYear = year !== null && Number.isFinite(Number(year)) ? Math.trunc(Number(year)) : today?.year ?? 0;
  const viewMonth = month !== null && Number.isFinite(Number(month))
    ? Math.max(0, Math.min(Math.trunc(Number(month)), Math.max(0, monthCount - 1)))
    : today?.month ?? 0;

  const grid = useMemo(() => {
    if (!calendar || calendar.months.length === 0 || calendarDaysPerYear(calendar) === 0) return null;
    const monthDef = calendar.months[Math.min(viewMonth, calendar.months.length - 1)];
    const weekdays = calendar.weekdays.length > 0 ? calendar.weekdays : ["Day"];
    const firstInstant = dateToInstant(calendar, { year: viewYear, month: viewMonth, day: 1 });
    const lead = ((firstInstant % weekdays.length) + weekdays.length) % weekdays.length;
    return { monthDef, weekdays, lead, days: Array.from({ length: monthDef.days }, (_, index) => ({ day: index + 1, instant: firstInstant + index })) };
  }, [calendar, viewYear, viewMonth]);

  const byInstant = useMemo(() => {
    const map = new Map<number, typeof records[number][]>();
    for (const record of records) {
      if (record.calendarInstant === null) continue;
      const bucket = map.get(record.calendarInstant) ?? [];
      bucket.push(record); map.set(record.calendarInstant, bucket);
    }
    return map;
  }, [records]);

  if (!calendar || !grid) return <div className="codex-main-empty"><h3>No calendar yet</h3><p>When your GM sets up the world's calendar, it appears here.</p></div>;
  const todayInstant = today ? dateToInstant(calendar, today) : null;
  const step = (delta: number) => {
    const total = viewYear * calendar.months.length + viewMonth + delta;
    setSelectedInstant(null);
    onMonthChange(Math.floor(total / calendar.months.length), ((total % calendar.months.length) + calendar.months.length) % calendar.months.length);
  };
  const selectedRecords = selectedInstant === null ? [] : byInstant.get(selectedInstant) ?? [];

  return (
    <div className="codex-calendar">
      <header className="codex-calendar-clocks">
        <div className="codex-calendar-clock">
          <span className="codex-calendar-clocklabel">Today</span>
          <strong>{today ? formatWorldDate(calendar, today) : "Not shared yet"}</strong>
        </div>
      </header>
      <div className="codex-calendar-monthbar">
        <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => step(-1)}>‹</Button>
        <h3 className="codex-calendar-monthname">{grid.monthDef.name} {formatWorldYear(calendar, viewYear)}</h3>
        <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => step(1)}>›</Button>
      </div>
      <div className="codex-calendar-grid" role="grid" aria-label={`${grid.monthDef.name} ${formatWorldYear(calendar, viewYear)}`}
        style={{ "--codex-week": String(grid.weekdays.length) } as React.CSSProperties}>
        {grid.weekdays.map((weekday) => (
          <div key={weekday} className="codex-calendar-weekday" role="columnheader">
            <span className="codex-calendar-weekdayfull">{weekday}</span>
            <span className="codex-calendar-weekdayshort" aria-hidden="true">{weekday.slice(0, 2)}</span>
          </div>
        ))}
        {Array.from({ length: grid.lead }, (_, index) => <div key={`lead-${index}`} className="codex-calendar-cell is-blank" aria-hidden="true" />)}
        {grid.days.map(({ day, instant }) => {
          const dayRecords = byInstant.get(instant) ?? [];
          const kinds = [...new Set(dayRecords.map((record) => record.kind))].slice(0, 3);
          return (
            <button key={instant} type="button"
              className={`codex-calendar-cell${todayInstant === instant ? " is-published" : ""}${selectedInstant === instant ? " is-selected" : ""}`}
              aria-pressed={selectedInstant === instant}
              aria-label={`${grid.monthDef.name} ${day}${dayRecords.length ? `, ${dayRecords.length} record${dayRecords.length === 1 ? "" : "s"}` : ""}${todayInstant === instant ? ", today" : ""}`}
              onClick={() => setSelectedInstant(selectedInstant === instant ? null : instant)}>
              <span className="codex-calendar-daynum">{day}</span>
              {kinds.length > 0 && (
                <span className="codex-calendar-marks" aria-hidden="true">
                  {kinds.map((kind) => <CodexIcon key={kind} iconId={CHRONICLE_KIND_META[kind].iconId} className="codex-calendar-mark" />)}
                  {dayRecords.length > kinds.length && <span className="codex-calendar-more">+{dayRecords.length - kinds.length}</span>}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {selectedInstant !== null && (
        <section className="codex-calendar-day" aria-label="Records on this day">
          {selectedRecords.length === 0
            ? <p className="codex-list-empty">Nothing happened on this day.</p>
            : <nav className="codex-campaign-recent" aria-label="Records on this day">
                {selectedRecords.map((record) => {
                  const meta = CHRONICLE_KIND_META[record.kind];
                  return (
                    <button key={`${record.kind}-${record.id}`} type="button" className="codex-campaign-recentitem" onClick={() => onOpenEntry(record.id)}>
                      <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-campaign-recentglyph" />
                      <span className="codex-list-title">{record.title ?? record.text ?? meta.label}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </button>
                  );
                })}
              </nav>}
        </section>
      )}
    </div>
  );
}
