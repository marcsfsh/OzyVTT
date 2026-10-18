import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, IconEyeOff, IconPlus } from "@vtt/ui";
import {
  dateToInstant,
  formatWorldDate,
  instantToDate,
  type CodexCalendar,
  type CodexChronicleRecord,
  type CodexPageSummary,
  type CodexSession,
  type GmCodexCalendar,
  type PlayerCodexChronicleRecord,
  type PlayerCodexSession
} from "@vtt/domain";
import {
  CHRONICLE_KIND_META,
  campaignDeadlines,
  chronicleRowSummary,
  deadlineFired,
  deadlineStateLabel,
  deadlineStateTone,
  questEventLabel,
  questEventOf,
  standingChangeLabel,
  standingOf
} from "../chronicle";
import { CodexIcon } from "../icons";
import { CodexMarkdown } from "../CodexMarkdown";
import { sessionTitle } from "../sessions";
import { recordDay, sessionDays, spineGroups, type StoryRecord } from "./model";
import { MonthBar, MonthGrid, useMonthView } from "./MonthGrid";

/**
 * The chronicle: the session spine on the left, newest first, each session with its in-world days, its recap and
 * what was filed under it; the calendar on the right with the dates, the month, the clocks and downtime. The GM's
 * and the players' chronicle share the layout and differ only in what they are given.
 */

type Named = Readonly<{ id: string; title: string }>;

/**
 * A record's one line: its title, or what its payload says, naming the quest or faction when the reader has its
 * page. The names come from the reader's own lists, so a player's line never names what the player can't see.
 */
export function recordLine(record: StoryRecord, quests: readonly Named[], pages: readonly Named[]): string {
  const meta = CHRONICLE_KIND_META[record.kind];
  if (record.title?.trim()) return record.title;
  const questEvent = questEventOf(record as never);
  if (questEvent)
    return questEventLabel(questEvent, quests.find((quest) => quest.id === questEvent.questId)?.title ?? null);
  const standing = standingOf(record as never);
  if (standing)
    return standingChangeLabel(standing, pages.find((page) => page.id === standing.factionPageId)?.title ?? null);
  return chronicleRowSummary(record as never) || meta.label;
}

type SpineSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  recap: string;
  planned: boolean;
  hidden: boolean;
}>;

/** One record's row on the spine: its date and kind, then its line. A GM row opens to the full record. */
function SpineRow({
  record,
  line,
  day,
  open,
  current,
  gm,
  onToggle,
  children
}: Readonly<{
  record: StoryRecord;
  line: string;
  day: string | null;
  open: boolean;
  /** The record the address names, which a jump from elsewhere landed on. */
  current: boolean;
  gm: boolean;
  onToggle: () => void;
  children?: ReactNode;
}>) {
  const meta = CHRONICLE_KIND_META[record.kind];
  return (
    <li
      className={`story-spinerow${open ? " is-open" : ""}${gm && record.revealedToPlayers === false ? " is-hidden" : ""}`}
    >
      <button
        type="button"
        className="story-spinerow-open"
        aria-expanded={open}
        aria-current={current ? "true" : undefined}
        id={`story-row-${record.id}`}
        onClick={onToggle}
      >
        <CodexIcon iconId={meta.iconId} className="story-spinerow-icon" />
        <span className="story-spinerow-text">
          <span className="story-spinerow-meta">
            {[day, meta.label].filter(Boolean).join(" · ")}
            {gm && record.revealedToPlayers === false && (
              <span className="story-hiddenword">
                <IconEyeOff /> Hidden
              </span>
            )}
          </span>
          <span className="story-spinerow-line">{line}</span>
        </span>
      </button>
      {open && children}
    </li>
  );
}

/** The spine itself: sessions newest first, then what no session holds. */
function Spine<R extends StoryRecord>({
  sessions,
  records,
  calendar,
  token,
  audience,
  focusedId,
  onFollow,
  knownTitles,
  lineOf,
  onOpenSession,
  renderOpen
}: Readonly<{
  sessions: readonly SpineSession[];
  records: readonly R[];
  lineOf: (record: R) => string;
  calendar: CodexCalendar | null;
  token: string;
  audience: "gm" | "player";
  focusedId: string | null;
  onFollow: (target: string) => void;
  knownTitles?: ReadonlySet<string>;
  onOpenSession: (sessionId: string) => void;
  /** What a GM's row shows when opened; players' rows read whole already. */
  renderOpen?: (record: R) => ReactNode;
}>) {
  const [openId, setOpenId] = useState<string | null>(focusedId);
  // A link to one record opens it and brings it into view once.
  useEffect(() => {
    if (!focusedId) return;
    setOpenId(focusedId);
    requestAnimationFrame(() => document.getElementById(`story-row-${focusedId}`)?.scrollIntoView({ block: "center" }));
  }, [focusedId]);
  const groups = useMemo(() => spineGroups(sessions, records), [sessions, records]);
  if (groups.length === 0)
    return <p className="story-hint">Nothing in the chronicle yet. Sessions and what happens in them appear here.</p>;
  return (
    <ol className="story-spine" aria-label="Sessions and what happened">
      {groups.map((group) => {
        const session = group.session;
        const days = session ? sessionDays(records, session.id, calendar) : "";
        return (
          <li key={group.key} className="story-spinegroup">
            <span className={`story-spinedot${session?.planned ? " is-planned" : ""}`} aria-hidden="true" />
            <div className="story-spinehead">
              {session ? (
                <button type="button" className="story-spinetitle" onClick={() => onOpenSession(session.id)}>
                  {sessionTitle(session)}
                </button>
              ) : (
                <span className="story-spinetitle is-plain">Not in a session</span>
              )}
              {session?.planned && <span className="story-plannedchip">Planned</span>}
              {audience === "gm" && session?.hidden && !session.planned && (
                <span className="story-hiddenword">
                  <IconEyeOff /> Recap hidden
                </span>
              )}
              <span className="story-grow" />
              {days && <span className="story-spinedays">{days}</span>}
            </div>
            {session &&
              (session.recap.trim() ? (
                <div className="story-spinerecap">
                  <CodexMarkdown
                    text={session.recap}
                    token={token}
                    onNavigate={onFollow}
                    knownTitles={knownTitles}
                    audience={audience === "player" ? "player" : undefined}
                  />
                </div>
              ) : (
                <p className="story-hint">
                  {session.planned ? "Prep only. The recap is written after the session." : "No recap written yet."}
                </p>
              ))}
            {group.records.length > 0 && (
              <ul className="story-spinerows">
                {group.records.map((record) => (
                  <SpineRow
                    key={`${record.kind}-${record.id}`}
                    record={record}
                    line={lineOf(record)}
                    day={recordDay(record, calendar)}
                    gm={audience === "gm"}
                    open={openId === record.id}
                    current={focusedId === record.id}
                    onToggle={() => setOpenId((now) => (now === record.id ? null : record.id))}
                  >
                    {renderOpen ? (
                      renderOpen(record)
                    ) : (
                      <div className="story-spinerow-body">
                        <CodexMarkdown
                          text={record.text}
                          token={token}
                          onNavigate={onFollow}
                          knownTitles={knownTitles}
                          audience="player"
                        />
                      </div>
                    )}
                  </SpineRow>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The month on the calendar side, marking the reader's dates, with the day's records under it. */
function CalendarMonth<R extends StoryRecord & Readonly<{ kind: CodexChronicleRecord["kind"] }>>({
  calendar,
  records,
  marks,
  fallback,
  year,
  month,
  lineOf,
  onMonthChange,
  onOpenRecord
}: Readonly<{
  calendar: CodexCalendar | null;
  records: readonly R[];
  lineOf: (record: R) => string;
  marks: ReadonlyArray<Readonly<{ date: CodexCalendar["currentDate"]; className: string; label: string }>>;
  fallback: CodexCalendar["currentDate"];
  year: string | null;
  month: string | null;
  onMonthChange: (year: number, month: number) => void;
  onOpenRecord: (record: R) => void;
}>) {
  const { grid, byInstant, step, selectedInstant, setSelectedInstant, selectedRecords } = useMonthView(
    calendar,
    records,
    { year, month },
    fallback ?? null,
    onMonthChange
  );
  if (!calendar || !grid) return null;
  const instants = marks.map((mark) => ({ ...mark, instant: mark.date ? dateToInstant(calendar, mark.date) : null }));
  return (
    <div className="story-month">
      <MonthBar title={grid.title} onStep={step} />
      <MonthGrid
        grid={grid}
        byInstant={byInstant}
        selectedInstant={selectedInstant}
        onSelect={setSelectedInstant}
        marks={(instant) => ({
          className: instants
            .filter((mark) => mark.instant === instant)
            .map((mark) => ` ${mark.className}`)
            .join(""),
          label: instants
            .filter((mark) => mark.instant === instant)
            .map((mark) => `, ${mark.label}`)
            .join("")
        })}
      />
      {selectedInstant !== null && (
        <section className="story-day" aria-label="Records on this day">
          <h4 className="story-eyebrow">{formatWorldDate(calendar, instantToDate(calendar, selectedInstant))}</h4>
          {selectedRecords.length === 0 ? (
            <p className="story-hint">Nothing happened on this day.</p>
          ) : (
            <ul className="story-daylist">
              {(selectedRecords as readonly R[]).map((record) => {
                const meta = CHRONICLE_KIND_META[record.kind];
                return (
                  <li key={`${record.kind}-${record.id}`}>
                    <button type="button" className="story-dayrow" onClick={() => onOpenRecord(record)}>
                      <CodexIcon iconId={meta.iconId} className="story-spinerow-icon" />
                      <span className="story-ellipsis">{lineOf(record)}</span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** The clocks: deadlines, passed first, each saying which. */
function Clocks<R extends StoryRecord>({
  records,
  calendar,
  gm,
  lineOf,
  onOpen
}: Readonly<{
  records: readonly R[];
  calendar: CodexCalendar | null;
  gm: boolean;
  lineOf: (record: R) => string;
  onOpen?: (record: R) => void;
}>) {
  const clocks = campaignDeadlines(records);
  if (clocks.length === 0) return null;
  return (
    <section className="story-card" aria-label="Clocks">
      <h3 className="story-eyebrow">Clocks</h3>
      <ul className="story-clocks">
        {clocks.map((record) => {
          const fired = deadlineFired(record);
          const hidden = gm && record.revealedToPlayers === false;
          const inside = (
            <>
              <CodexIcon iconId="hourglass" className="story-spinerow-icon" />
              <span className="story-spinerow-text">
                <span className="story-spinerow-line">{lineOf(record)}</span>
                <span className="story-spinerow-meta">{recordDay(record, calendar) ?? "Undated"}</span>
              </span>
              <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>
              {hidden && (
                <span className="story-hiddenmark" role="img" aria-label="Hidden" title="Hidden">
                  <IconEyeOff />
                </span>
              )}
            </>
          );
          return (
            <li key={record.id}>
              {onOpen ? (
                <button
                  type="button"
                  className={`story-clock${hidden ? " is-hidden" : ""}`}
                  onClick={() => onOpen(record)}
                >
                  {inside}
                </button>
              ) : (
                <div className="story-clock is-static">{inside}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ----- The GM's chronicle -----

export function GmChronicle({
  gmToken,
  records,
  calendar,
  sessions,
  pages,
  quests,
  focusedId,
  year,
  month,
  onMonthChange,
  onOpenSession,
  onFollow,
  dateBar,
  downtime,
  onAdd,
  renderRecord,
  onOpenRecord
}: Readonly<{
  gmToken: string;
  records: readonly CodexChronicleRecord[];
  calendar: GmCodexCalendar | null;
  sessions: readonly CodexSession[];
  pages: readonly CodexPageSummary[];
  quests: readonly Named[];
  focusedId: string | null;
  year: string | null;
  month: string | null;
  onMonthChange: (year: number, month: number) => void;
  onOpenSession: (sessionId: string) => void;
  onFollow: (target: string) => void;
  dateBar: ReactNode;
  downtime: ReactNode;
  onAdd: () => void;
  /** The full record, with its actions, inside an opened row. */
  renderRecord: (record: CodexChronicleRecord) => ReactNode;
  /** Opens one record from the calendar or the clocks. */
  onOpenRecord: (record: CodexChronicleRecord) => void;
}>) {
  const spineSessions = useMemo<SpineSession[]>(
    () =>
      sessions.map((session) => ({
        id: session.id,
        sessionNumber: session.sessionNumber,
        recap: session.recapBody,
        planned: session.status === "planned",
        hidden: !session.revealedToPlayers
      })),
    [sessions]
  );
  const known = useMemo(() => new Set(pages.map((page) => page.title.trim().toLowerCase())), [pages]);
  const lineOf = (record: StoryRecord) => recordLine(record, quests, pages);
  return (
    <div className="story-chronicle">
      <div className="story-spinecol scroll-y">
        <Spine
          sessions={spineSessions}
          records={records}
          calendar={calendar}
          token={gmToken}
          audience="gm"
          lineOf={lineOf}
          focusedId={focusedId}
          onFollow={onFollow}
          knownTitles={known}
          onOpenSession={onOpenSession}
          renderOpen={renderRecord}
        />
      </div>
      <aside className="story-calcol scroll-y" aria-label="Calendar">
        {dateBar}
        <CalendarMonth
          calendar={calendar}
          records={records}
          fallback={calendar?.currentDate ?? null}
          marks={[
            { date: calendar?.publishedDate ?? null, className: "is-published", label: "players' date" },
            { date: calendar?.currentDate ?? null, className: "is-now", label: "your date" }
          ]}
          year={year}
          month={month}
          lineOf={lineOf}
          onMonthChange={onMonthChange}
          onOpenRecord={onOpenRecord}
        />
        <Clocks records={records} calendar={calendar} gm lineOf={lineOf} onOpen={onOpenRecord} />
        {downtime}
        <button type="button" className="story-addbox" onClick={onAdd}>
          <IconPlus /> Add to the chronicle
        </button>
      </aside>
    </div>
  );
}

// ----- The players' chronicle -----

export function PlayerChronicle({
  token,
  records,
  calendar,
  sessions,
  pages,
  quests,
  focusedId,
  year,
  month,
  knownTitles,
  onMonthChange,
  onOpenSession,
  onFollow,
  dateBar,
  downtime,
  onOpenEvent
}: Readonly<{
  token: string;
  records: readonly PlayerCodexChronicleRecord[];
  calendar: CodexCalendar | null;
  sessions: readonly PlayerCodexSession[];
  pages: readonly Named[];
  quests: readonly Named[];
  focusedId: string | null;
  year: string | null;
  month: string | null;
  knownTitles: ReadonlySet<string>;
  onMonthChange: (year: number, month: number) => void;
  onOpenSession: (sessionId: string) => void;
  onFollow: (target: string) => void;
  dateBar: ReactNode;
  downtime: ReactNode;
  /** An event on the calendar opens its page. */
  onOpenEvent: (pageId: string) => void;
}>) {
  const spineSessions = useMemo<SpineSession[]>(
    () =>
      sessions.map((session) => ({
        id: session.id,
        sessionNumber: session.sessionNumber,
        recap: session.recap,
        planned: false,
        hidden: false
      })),
    [sessions]
  );
  const [opened, setOpened] = useState<string | null>(focusedId);
  const lineOf = (record: StoryRecord) => recordLine(record, quests, pages);
  return (
    <div className="story-chronicle">
      <div className="story-spinecol scroll-y">
        <Spine
          sessions={spineSessions}
          records={records}
          calendar={calendar}
          token={token}
          audience="player"
          lineOf={lineOf}
          focusedId={opened}
          onFollow={onFollow}
          knownTitles={knownTitles}
          onOpenSession={onOpenSession}
        />
      </div>
      <aside className="story-calcol scroll-y" aria-label="Calendar">
        {dateBar}
        <CalendarMonth
          calendar={calendar}
          records={records}
          fallback={calendar?.currentDate ?? null}
          marks={[{ date: calendar?.currentDate ?? null, className: "is-published", label: "today" }]}
          year={year}
          month={month}
          lineOf={lineOf}
          onMonthChange={onMonthChange}
          onOpenRecord={(record) => (record.kind === "event" ? onOpenEvent(record.id) : setOpened(record.id))}
        />
        <Clocks records={records} calendar={calendar} gm={false} lineOf={lineOf} />
        {downtime}
      </aside>
    </div>
  );
}
