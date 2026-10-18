import { useMemo, type ReactNode } from "react";
import { Button, IconChevron, IconEyeOff, SegmentedControl } from "@vtt/ui";
import { formatWorldYear, instantToDate, type CodexCalendar, type CodexInWorldDate } from "@vtt/domain";
import { CHRONICLE_KIND_META, chronicleRowSummary, deadlineFired, deadlineStateLabel } from "../chronicle";
import { CodexIcon } from "../icons";
import {
  ageMarks,
  dayWithWeekday,
  instantOf,
  laneOf,
  monthDays,
  summaryOf,
  yearMonths,
  type AgeMark,
  type StoryRecord
} from "./model";

export type TimelineZoom = "ages" | "year" | "month";
export const TIMELINE_ZOOMS: ReadonlyArray<Readonly<{ value: TimelineZoom; label: string }>> = [
  { value: "ages", label: "Ages" },
  { value: "year", label: "Year" },
  { value: "month", label: "Month" }
];

/** The next planned session, as the GM's month shows it after the players' date. */
export type NextSessionCard = Readonly<{ title: string; line: string }>;

type TimelineProps = Readonly<{
  audience: "gm" | "player";
  records: readonly StoryRecord[];
  calendar: CodexCalendar | null;
  /** The players' date: their Today. */
  playersDate: CodexInWorldDate | null;
  /** The GM's own date; null for a player. */
  gmDate?: CodexInWorldDate | null;
  zoom: TimelineZoom;
  /** The year and month on show, from the address; null follows the reader's date. */
  year: number | null;
  month: number | null;
  phone: boolean;
  nextSession?: NextSessionCard | null;
  selectedId: string | null;
  onZoom: (zoom: TimelineZoom) => void;
  onShow: (year: number, month: number | null, zoom: TimelineZoom) => void;
  onSelect: (record: StoryRecord) => void;
  /** The selected event, read on the right on a laptop. */
  aside?: ReactNode;
  /** A record's line, naming its quest or faction (see `recordLine`). */
  lineOf?: (record: StoryRecord) => string;
}>;

const kindLine = (record: StoryRecord) => CHRONICLE_KIND_META[record.kind].label;
const plainLine = (record: StoryRecord) =>
  record.title ?? (chronicleRowSummary(record as never) || CHRONICLE_KIND_META[record.kind].label);

/**
 * The timeline: the world's history in three zooms. Ages puts every dated event on one line with the quiet
 * centuries folded, and the campaign at its end. Year lays one year out month by month. Month lists the days that
 * hold anything, the world's lane beside the party's on a laptop and in one lane on a phone, with the players' date
 * and, for the GM, the GM's own date drawn across it.
 */
export function Timeline(props: TimelineProps) {
  const { calendar, zoom, phone, onZoom } = props;
  if (!calendar || calendar.months.length === 0)
    return (
      <div className="story-timeline">
        <p className="story-hint">The world has no calendar yet, so nothing can be placed in time.</p>
      </div>
    );
  return (
    <div className={`story-timeline${phone ? " is-phone" : ""}`}>
      {phone && (
        <SegmentedControl
          ariaLabel="Zoom"
          className="story-zoom"
          value={zoom}
          onChange={(next) => onZoom(next as TimelineZoom)}
          options={TIMELINE_ZOOMS.map((option) => ({ value: option.value, label: option.label }))}
        />
      )}
      {zoom === "ages" && <Ages {...props} calendar={calendar} />}
      {zoom === "year" && <Year {...props} calendar={calendar} />}
      {zoom === "month" && <Month {...props} calendar={calendar} />}
    </div>
  );
}

// ----- Ages -----

function Ages({
  records,
  calendar,
  playersDate,
  gmDate,
  audience,
  phone,
  selectedId,
  onSelect,
  onShow,
  aside
}: TimelineProps & Readonly<{ calendar: CodexCalendar }>) {
  const now = audience === "gm" ? (gmDate ?? playersDate) : playersDate;
  const marks = useMemo(() => ageMarks(records, calendar, now), [records, calendar, now]);
  if (marks.length === 0)
    return <p className="story-hint">No dated events yet. An event page with a date appears on this line.</p>;
  const openMark = (mark: AgeMark) => (mark.record ? onSelect(mark.record) : onShow(mark.year, null, "year"));
  if (phone)
    return (
      <ol className="story-lane" aria-label="The ages, newest first">
        {[...marks].reverse().map((mark) => (
          <li key={mark.key} className="story-lane-row">
            <span className="story-daymark is-wide">
              <b>{mark.year}</b>
              <i>{calendar.yearName}</i>
            </span>
            <button
              type="button"
              className={`story-item${mark.campaign ? " is-party" : " is-world"}${mark.hidden ? " is-hidden" : ""}`}
              onClick={() => openMark(mark)}
            >
              <span className="story-item-meta">
                {mark.hidden ? (
                  <>
                    <IconEyeOff /> Hidden
                  </>
                ) : mark.campaign ? (
                  <>
                    <CodexIcon iconId="sessions" className="story-item-icon" /> {mark.line}
                  </>
                ) : (
                  <>
                    <CodexIcon iconId="hourglass" className="story-item-icon" /> Lore
                  </>
                )}
              </span>
              <span className="story-item-text">
                <b>{mark.title}.</b> {mark.campaign ? mark.yearLabel : mark.line}
              </span>
            </button>
          </li>
        ))}
      </ol>
    );
  return (
    <div className="story-ages-wrap">
      <div className="story-ages-main scroll-y">
        <ol
          className="story-ages"
          aria-label="The ages, oldest first"
          style={{ "--marks": marks.length } as React.CSSProperties}
        >
          {marks.map((mark, index) => (
            <li
              key={mark.key}
              className={`story-age${index % 2 === 0 ? " is-up" : " is-down"}${mark.foldBefore ? " is-folded" : ""}${mark.campaign ? " is-campaign" : ""}${mark.hidden ? " is-hidden" : ""}`}
            >
              {mark.foldBefore && (
                <span
                  className="story-age-fold"
                  role="img"
                  aria-label="Quiet years folded"
                  title="Quiet years folded"
                />
              )}
              <button
                type="button"
                className={`story-age-open${mark.record && mark.record.id === selectedId ? " is-selected" : ""}`}
                aria-pressed={mark.record ? mark.record.id === selectedId : undefined}
                onClick={() => openMark(mark)}
              >
                <span className="story-age-year">{mark.yearLabel}</span>
                <span className="story-age-title">{mark.title}</span>
                <span className="story-age-line">
                  {mark.hidden ? (
                    <>
                      <IconEyeOff /> Hidden
                    </>
                  ) : (
                    mark.line
                  )}
                </span>
              </button>
              <span className="story-age-diamond" aria-hidden="true" />
            </li>
          ))}
        </ol>
        {now && (
          <Year
            {...{ records, calendar, playersDate, gmDate, audience, phone: false, selectedId, onSelect, onShow }}
            zoom="year"
            year={now.year}
            month={null}
            onZoom={() => undefined}
            compact
          />
        )}
      </div>
      {aside}
    </div>
  );
}

// ----- Year -----

function Year({
  records,
  calendar,
  playersDate,
  gmDate,
  audience,
  year,
  phone,
  onShow,
  compact = false
}: TimelineProps & Readonly<{ calendar: CodexCalendar; compact?: boolean }>) {
  const shownYear = year ?? (audience === "gm" ? (gmDate ?? playersDate)?.year : playersDate?.year) ?? 0;
  const months = useMemo(() => yearMonths(records, calendar, shownYear), [records, calendar, shownYear]);
  const players = instantOf(calendar, playersDate);
  const mine = audience === "gm" ? instantOf(calendar, gmDate ?? null) : null;
  const monthOf = (instant: number | null) => {
    if (instant === null) return null;
    const date = instantToDate(calendar, instant);
    return date.year === shownYear ? date : null;
  };
  const today = monthOf(players);
  const yours = monthOf(mine);
  return (
    <section
      className={`story-year${compact ? " is-compact" : ""}${phone ? " is-phone" : ""}`}
      aria-label={`${formatWorldYear(calendar, shownYear)}, by month`}
    >
      <div className="story-year-head">
        {!compact && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous year"
            onClick={() => onShow(shownYear - 1, null, "year")}
          >
            <IconChevron className="story-chevron-left" />
          </Button>
        )}
        <h3 className="story-eyebrow">{formatWorldYear(calendar, shownYear)}, by month</h3>
        {!compact && (
          <Button variant="ghost" size="sm" aria-label="Next year" onClick={() => onShow(shownYear + 1, null, "year")}>
            <IconChevron className="story-chevron-right" />
          </Button>
        )}
      </div>
      <ol className="story-months" style={{ "--months": months.length } as React.CSSProperties}>
        {months.map((month) => {
          const isToday = today?.month === month.month;
          const clocks = month.records.filter((record) => record.kind === "deadline");
          const events = month.records.filter((record) => record.kind === "event");
          return (
            <li key={month.month}>
              <button
                type="button"
                className={`story-month-cell${isToday ? " is-today" : ""}`}
                onClick={() => onShow(shownYear, month.month, "month")}
              >
                <span className="story-month-name">{month.name}</span>
                {month.sessions && <span className="story-month-sessions">{month.sessions}</span>}
                {isToday && today && (
                  <span className="story-month-today">
                    {audience === "gm" ? "Players" : "Today"}: {today.day}
                  </span>
                )}
                {yours?.month === month.month && audience === "gm" && (
                  <span className="story-month-yours">Yours: {yours.day}</span>
                )}
                {clocks.map((record) => (
                  <span
                    key={record.id}
                    className={`story-month-clock${record.revealedToPlayers === false ? " is-hidden" : ""}`}
                  >
                    {summaryOf(record.title ?? record.text)}: {instantToDate(calendar, record.calendarInstant!).day}
                  </span>
                ))}
                {events.map((record) => (
                  <span
                    key={record.id}
                    className={`story-month-event${record.revealedToPlayers === false ? " is-hidden" : ""}`}
                  >
                    {record.title ?? summaryOf(record.text)}
                  </span>
                ))}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ----- Month -----

function Month({
  records,
  calendar,
  playersDate,
  gmDate,
  audience,
  year,
  month,
  phone,
  nextSession,
  selectedId,
  onSelect,
  onShow,
  aside,
  lineOf = plainLine
}: TimelineProps & Readonly<{ calendar: CodexCalendar }>) {
  const reader = audience === "gm" ? (gmDate ?? playersDate) : playersDate;
  const shownYear = year ?? reader?.year ?? 0;
  const shownMonth = Math.min(month ?? reader?.month ?? 0, calendar.months.length - 1);
  const days = useMemo(
    () => monthDays(records, calendar, shownYear, shownMonth),
    [records, calendar, shownYear, shownMonth]
  );
  const players = instantOf(calendar, playersDate);
  const mine = audience === "gm" ? instantOf(calendar, gmDate ?? null) : null;
  const step = (delta: number) => {
    const count = calendar.months.length;
    const total = shownYear * count + shownMonth + delta;
    onShow(Math.floor(total / count), ((total % count) + count) % count, "month");
  };
  const title = `${calendar.months[shownMonth]?.name ?? ""} ${formatWorldYear(calendar, shownYear)}`;

  // The lines drawn across the month: the players' date, then the GM's next session after it, then the GM's date.
  type Row =
    | Readonly<{ kind: "day"; instant: number; day: (typeof days)[number] }>
    | Readonly<{ kind: "line"; instant: number; who: "players" | "gm"; label: string }>
    | Readonly<{ kind: "next"; instant: number }>;
  const rows: Row[] = days.map((day) => ({ kind: "day", instant: day.instant, day }));
  const inMonth = (instant: number | null) => {
    if (instant === null) return false;
    const date = instantToDate(calendar, instant);
    return date.year === shownYear && date.month === shownMonth;
  };
  if (players !== null && inMonth(players)) {
    rows.push({
      kind: "line",
      instant: players + 0.5,
      who: "players",
      label: `${audience === "gm" ? "Players' date" : "Today"} · ${dayWithWeekday(calendar, instantToDate(calendar, players))}`
    });
    if (audience === "gm" && nextSession) rows.push({ kind: "next", instant: players + 0.6 });
  }
  if (mine !== null && inMonth(mine) && mine !== players)
    rows.push({
      kind: "line",
      instant: mine + 0.7,
      who: "gm",
      label: `Your date · ${dayWithWeekday(calendar, instantToDate(calendar, mine))}`
    });
  rows.sort((a, b) => a.instant - b.instant);

  const item = (record: StoryRecord) => {
    const lane = laneOf(record.kind);
    const hidden = audience === "gm" && record.revealedToPlayers === false;
    const meta = CHRONICLE_KIND_META[record.kind];
    return (
      <button
        key={`${record.kind}-${record.id}`}
        type="button"
        className={`story-item is-${lane}${hidden ? " is-hidden" : ""}${record.id === selectedId ? " is-selected" : ""}`}
        onClick={() => onSelect(record)}
      >
        {phone && <span className="story-item-lane">{lane === "world" ? "In the world" : "The party"}</span>}
        <span className="story-item-meta">
          {hidden ? (
            <>
              <IconEyeOff /> Hidden
            </>
          ) : (
            <>
              <CodexIcon iconId={meta.iconId} className="story-item-icon" />
              {record.sessionNumber !== null && lane === "party" ? `Session ${record.sessionNumber}` : kindLine(record)}
              {record.kind === "deadline" ? ` · ${deadlineStateLabel(deadlineFired(record as never))}` : ""}
            </>
          )}
        </span>
        <span className="story-item-text">{lineOf(record)}</span>
      </button>
    );
  };

  return (
    <div className="story-ages-wrap">
      {/* A phone scrolls the whole Story as one column, so the month doesn't scroll on its own there. */}
      <div className={`story-month-main${phone ? "" : " scroll-y"}`}>
        <div className="story-year-head">
          <Button variant="ghost" size="sm" aria-label="Previous month" onClick={() => step(-1)}>
            <IconChevron className="story-chevron-left" />
          </Button>
          <h3 className="story-eyebrow">{title}</h3>
          <Button variant="ghost" size="sm" aria-label="Next month" onClick={() => step(1)}>
            <IconChevron className="story-chevron-right" />
          </Button>
        </div>
        {rows.length === 0 && <p className="story-hint">Nothing is dated in this month.</p>}
        <ol className={`story-lanes${phone ? " is-one" : ""}`} aria-label={title}>
          {!phone && rows.length > 0 && (
            <li className="story-lanes-head" aria-hidden="true">
              <span>In the world</span>
              <span>Day</span>
              <span>The party</span>
            </li>
          )}
          {rows.map((row) =>
            row.kind === "line" ? (
              <li key={`line-${row.who}`} className={`story-nowline${row.who === "gm" ? " is-gm" : ""}`}>
                <span>{row.label}</span>
              </li>
            ) : row.kind === "next" ? (
              <li key="next" className="story-lane-row">
                {!phone && <span />}
                <span className="story-daymark is-next">
                  <b>Next</b>
                </span>
                <div className="story-lane-cell">
                  <div className="story-item is-next">
                    <span className="story-item-meta">
                      <CodexIcon iconId="sessions" className="story-item-icon" /> {nextSession!.title}
                    </span>
                    <span className="story-item-text">{nextSession!.line}</span>
                  </div>
                </div>
              </li>
            ) : (
              <li key={row.instant} className="story-lane-row">
                {!phone && (
                  <div className="story-lane-cell is-world">
                    {row.day.records.filter((record) => laneOf(record.kind) === "world").map(item)}
                  </div>
                )}
                <span className="story-daymark">
                  <b>{row.day.day}</b>
                  {row.day.weekday && <i>{row.day.weekday.slice(0, 3)}</i>}
                </span>
                <div className="story-lane-cell">
                  {(phone ? row.day.records : row.day.records.filter((record) => laneOf(record.kind) === "party")).map(
                    item
                  )}
                </div>
              </li>
            )
          )}
        </ol>
      </div>
      {aside}
    </div>
  );
}
