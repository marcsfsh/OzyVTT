import { useState } from "react";
import { Alert, Badge, Button, GmOnlyTag, Input, Skeleton } from "@vtt/ui";
import {
  dateToInstant,
  formatWorldDate,
  formatWorldYear,
  type CodexCalendar,
  type CodexChronicleRecord,
  type GmCodexCalendar
} from "@vtt/domain";
import { calendarApi } from "./api";
import { CHRONICLE_KIND_META, chronicleRowSummary, sameInWorldDate } from "./chronicle";
import { CalendarEditor, CampaignDateEditor } from "./CalendarEditor";
import { MonthBar, MonthGrid, useMonthView } from "./MonthGrid";
import { RecordRow } from "./RecordRow";
import { hourLabel } from "../rest/game-date";

/**
 * The Calendar section: a lens over the chronicle. Records are placed by the server's `calendarInstant`;
 * the clamped `dateToInstant` is used only for the two clock markers, which arrive as raw dates.
 *
 * "Your date" (the GM's prep clock, violet because it is GM-only) is a button that opens a date editor.
 * "Players' date" is only ever a published copy of it, so it has no editor; Publish is always rendered,
 * disabled with a reason when there is nothing to publish.
 */
export type CalendarViewProps = Readonly<{
  gmToken: string;
  calendar: GmCodexCalendar | null;
  /** The game clock, whose hour goes with "Your date": the table's one clock. Null outside the GM's table. */
  gameHours?: number | null;
  records: readonly CodexChronicleRecord[];
  loading: boolean;
  error: string | null;
  onChanged: () => void;
  /** `?y=`/`?m=`: the visible month, so a month is bookmarkable. */
  year: string | null;
  month: string | null;
  onMonthChange: (year: number, month: number) => void;
  onOpenEntry: (entryId: string) => void;
  onOpenPage: (pageId: string) => void;
}>;

export function CalendarView({
  gmToken,
  calendar,
  gameHours = null,
  records,
  loading,
  error,
  onChanged,
  year,
  month,
  onMonthChange,
  onOpenEntry,
  onOpenPage
}: CalendarViewProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  /** The GM's clock editor, separate from the world's structure. */
  const [dateOpen, setDateOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const now = calendar?.currentDate ?? null;
  const published = calendar?.publishedDate ?? null;
  // The URL wins, else the GM's clock, else the first month of year 0.
  const { viewYear, viewMonth, grid, byInstant, step, selectedInstant, setSelectedInstant, selectedRecords } =
    useMonthView(calendar, records, { year, month }, now, onMonthChange);

  const nowInstant = calendar && now ? dateToInstant(calendar, now) : null;
  const publishedInstant = calendar && published ? dateToInstant(calendar, published) : null;
  const diverged = !sameInWorldDate(now, published);

  const publish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      await calendarApi.publish(gmToken);
      onChanged();
    } catch (failure) {
      setPublishError(failure instanceof Error ? failure.message : "Couldn't publish the date.");
    } finally {
      setPublishing(false);
    }
  };

  if (loading && !calendar)
    return (
      <div className="codex-main-loading">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} variant="text" />
        ))}
      </div>
    );
  if (error)
    return (
      <Alert tone="danger" title="Couldn't load the calendar">
        {error}
      </Alert>
    );
  if (!calendar || !grid) {
    return (
      <div className="codex-main-empty">
        <h3>No calendar yet</h3>
        <p>Define the months and weekdays of the world. Dated records are placed on this calendar.</p>
        <Button variant="primary" onClick={() => setEditorOpen(true)}>
          Edit calendar
        </Button>
        {editorOpen && (
          <CalendarEditor
            gmToken={gmToken}
            calendar={calendar}
            onSaved={() => {
              setEditorOpen(false);
              onChanged();
            }}
            onClose={() => setEditorOpen(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="codex-calendar">
      <header className="codex-calendar-clocks">
        <div className="codex-calendar-clock">
          <span className="codex-calendar-clocklabel">Your date</span>
          {/* Grows its own paint to 44px rather than overhanging the clock beside it. */}
          <button
            type="button"
            className="codex-calendar-clockset"
            onClick={() => setDateOpen(true)}
            aria-label={now ? `Your date is ${formatWorldDate(calendar, now)}. Change it.` : "Set your date"}
          >
            {now ? formatWorldDate(calendar, now) : "Set your date"}
          </button>
          {now && gameHours !== null && <span className="codex-calendar-hour">{hourLabel(gameHours)}</span>}
          <GmOnlyTag />
        </div>
        <div className="codex-calendar-clock">
          <span className="codex-calendar-clocklabel">Players' date</span>
          <strong>{published ? formatWorldDate(calendar, published) : "Not shared yet"}</strong>
        </div>
        {/* This view's primary action, always rendered so the GM learns it exists. */}
        <Button variant="primary" disabled={publishing || !diverged} onClick={() => void publish()}>
          Publish the date
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditorOpen(true)}>
          Edit calendar
        </Button>
      </header>
      {/* Three states: in sync, ahead of the players, or players have no date yet. */}
      <p className="codex-calendar-clockhint">
        {!now
          ? "Your date is the campaign's now, and every new record is dated by it. Rests and passing time at the table move it. The party sees it only when you publish."
          : !published
            ? "The party has no date yet. Publishing shares the date above with them; until then it is yours alone."
            : diverged
              ? "You are running ahead of the party. Publishing moves their date to yours."
              : "The party is on your date. Move yours and this becomes a date only you can see, until you publish again."}
      </p>
      {publishError && <Alert tone="danger">{publishError}</Alert>}

      <MonthBar title={grid.title} onStep={step}>
        <label className="codex-calendar-yearjump">
          <span className="nh-sr-only">Jump to year</span>
          <Input
            type="number"
            inputMode="numeric"
            aria-label="Jump to year"
            value={String(viewYear)}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next)) onMonthChange(Math.trunc(next), viewMonth);
            }}
          />
        </label>
      </MonthBar>

      <MonthGrid
        grid={grid}
        byInstant={byInstant}
        selectedInstant={selectedInstant}
        onSelect={setSelectedInstant}
        marks={(instant) => ({
          className: `${nowInstant === instant ? " is-now" : ""}${publishedInstant === instant ? " is-published" : ""}`,
          label: `${nowInstant === instant ? ", your date" : ""}${publishedInstant === instant ? ", players' date" : ""}`
        })}
      />

      {selectedInstant !== null && (
        <section className="codex-calendar-day" aria-label="Records on this day">
          <h4 className="codex-campaign-h">
            {grid.monthDef.name}{" "}
            {selectedInstant - dateToInstant(calendar, { year: viewYear, month: viewMonth, day: 1 }) + 1},{" "}
            {formatWorldYear(calendar, viewYear)}
          </h4>
          {selectedRecords.length === 0 ? (
            <p className="codex-list-empty">Nothing happened on this day.</p>
          ) : (
            <nav className="codex-campaign-recent" aria-label="Records on this day">
              {selectedRecords.map((record) => {
                const meta = CHRONICLE_KIND_META[record.kind];
                return (
                  <RecordRow
                    key={`${record.kind}-${record.id}`}
                    iconId={meta.iconId}
                    title={record.title ?? chronicleRowSummary(record) ?? meta.label}
                    onClick={() => (record.kind === "event" ? onOpenPage(record.id) : onOpenEntry(record.id))}
                  >
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </RecordRow>
                );
              })}
            </nav>
          )}
        </section>
      )}

      {editorOpen && (
        <CalendarEditor
          gmToken={gmToken}
          calendar={calendar}
          onSaved={() => {
            setEditorOpen(false);
            onChanged();
          }}
          onClose={() => setEditorOpen(false)}
        />
      )}
      {dateOpen && (
        <CampaignDateEditor
          gmToken={gmToken}
          calendar={calendar}
          onSaved={() => {
            setDateOpen(false);
            onChanged();
          }}
          onClose={() => setDateOpen(false)}
        />
      )}
    </div>
  );
}

/** The player's Calendar: one clock, revealed records only, no structure editing. */
export function PlayerCalendarView({
  calendar,
  records,
  year,
  month,
  onMonthChange,
  onOpenEntry
}: Readonly<{
  calendar: CodexCalendar | null;
  records: ReadonlyArray<
    Readonly<{
      id: string;
      kind: CodexChronicleRecord["kind"];
      title: string | null;
      text: string;
      calendarInstant: number | null;
    }>
  >;
  year: string | null;
  month: string | null;
  onMonthChange: (year: number, month: number) => void;
  onOpenEntry: (entryId: string) => void;
}>) {
  const today = calendar?.currentDate ?? null;
  const { grid, byInstant, step, selectedInstant, setSelectedInstant, selectedRecords } = useMonthView(
    calendar,
    records,
    { year, month },
    today,
    onMonthChange
  );

  if (!calendar || !grid)
    return (
      <div className="codex-main-empty">
        <h3>No calendar yet</h3>
        <p>When your GM sets up the world's calendar, it appears here.</p>
      </div>
    );
  const todayInstant = today ? dateToInstant(calendar, today) : null;

  return (
    <div className="codex-calendar">
      <header className="codex-calendar-clocks">
        <div className="codex-calendar-clock">
          <span className="codex-calendar-clocklabel">Today</span>
          <strong>{today ? formatWorldDate(calendar, today) : "Not shared yet"}</strong>
        </div>
      </header>
      <MonthBar title={grid.title} onStep={step} />
      <MonthGrid
        grid={grid}
        byInstant={byInstant}
        selectedInstant={selectedInstant}
        onSelect={setSelectedInstant}
        marks={(instant) => ({
          className: todayInstant === instant ? " is-published" : "",
          label: todayInstant === instant ? ", today" : ""
        })}
      />
      {selectedInstant !== null && (
        <section className="codex-calendar-day" aria-label="Records on this day">
          {selectedRecords.length === 0 ? (
            <p className="codex-list-empty">Nothing happened on this day.</p>
          ) : (
            <nav className="codex-campaign-recent" aria-label="Records on this day">
              {selectedRecords.map((record) => {
                const meta = CHRONICLE_KIND_META[record.kind];
                return (
                  <RecordRow
                    key={`${record.kind}-${record.id}`}
                    iconId={meta.iconId}
                    title={record.title ?? record.text ?? meta.label}
                    onClick={() => onOpenEntry(record.id)}
                  >
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </RecordRow>
                );
              })}
            </nav>
          )}
        </section>
      )}
    </div>
  );
}
