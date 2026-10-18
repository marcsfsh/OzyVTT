import { useMemo, type ReactNode } from "react";
import { Input, FilterChips, FilterFlyout } from "@vtt/ui";
import type { CodexCalendar, PlayerCodexChronicleRecord, PlayerCodexSession } from "@vtt/domain";
import { CHRONICLE_KIND_META } from "../chronicle";
import { CodexIcon } from "../icons";
import { CodexMarkdown } from "../CodexMarkdown";
import { sessionTitle } from "../sessions";
import { useCodexShell } from "../shell/context";
import { realDateLabel, recordDay, type StoryRecord } from "./model";

/** A session as the list shows it, for both audiences. */
export type ListedSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  realDate: string | null;
  recap: string;
  tags: readonly string[];
  /** The GM's: planned or played, and whether players read the recap. A player's are all played and shared. */
  status?: "planned" | "played";
  shared?: boolean;
}>;

export type SessionFilter = Readonly<{ text: string; statuses: readonly string[]; from: string; to: string }>;

/** How many of the sessions filters are set, for the Filters button. */
export const sessionFilterCount = (filter: SessionFilter) =>
  (filter.text ? 1 : 0) + filter.statuses.length + (filter.from || filter.to ? 1 : 0);

/** The sessions newest first, through the filter: text, status, and a played-between range of real dates. */
export function filterSessions<S extends ListedSession>(sessions: readonly S[], filter: SessionFilter): S[] {
  const needle = filter.text.trim().toLowerCase();
  return [...sessions]
    .sort((a, b) => (b.sessionNumber ?? Number.MAX_SAFE_INTEGER) - (a.sessionNumber ?? Number.MAX_SAFE_INTEGER))
    .filter((session) => {
      if (
        needle &&
        !sessionTitle(session).toLowerCase().includes(needle) &&
        !(session.realDate ?? "").toLowerCase().includes(needle) &&
        !session.tags.some((tag) => tag.includes(needle)) &&
        !session.recap.toLowerCase().includes(needle)
      )
        return false;
      if (filter.statuses.length > 0) {
        const marks = [session.status ?? "played", ...(session.shared === false ? ["hidden"] : [])];
        if (!filter.statuses.some((status) => marks.includes(status))) return false;
      }
      // Real dates are free text; an ISO date compares as a string, and anything else leaves the range alone.
      if ((filter.from || filter.to) && session.realDate) {
        if (filter.from && session.realDate < filter.from) return false;
        if (filter.to && session.realDate > filter.to) return false;
      } else if (filter.from || filter.to) return false;
      return true;
    });
}

/** The Sessions flyout: the filter, the status chips, the played-between range and the list. A pick opens one. */
export function SessionsFlyout<S extends ListedSession>({
  id,
  open,
  sessions,
  selectedId,
  filter,
  gm,
  onFilter,
  onPick,
  onClose
}: Readonly<{
  id: string;
  open: boolean;
  sessions: readonly S[];
  selectedId: string | null;
  filter: SessionFilter;
  gm: boolean;
  onFilter: (next: SessionFilter) => void;
  onPick: (sessionId: string) => void;
  onClose: () => void;
}>) {
  const shown = filterSessions(sessions, filter);
  return (
    <FilterFlyout id={id} open={open} title="Sessions" onClose={onClose}>
      <Input
        aria-label="Filter sessions"
        placeholder="Filter sessions"
        value={filter.text}
        onChange={(event) => onFilter({ ...filter, text: event.target.value })}
      />
      <FilterChips
        label="Status"
        options={
          gm
            ? [
                { value: "planned", label: "Planned" },
                { value: "played", label: "Played" },
                { value: "hidden", label: "Recap hidden" }
              ]
            : [{ value: "played", label: "Played" }]
        }
        selected={filter.statuses}
        onChange={(statuses) => onFilter({ ...filter, statuses })}
      />
      <span className="story-eyebrow">Played between</span>
      <div className="story-daterange">
        <Input
          type="date"
          aria-label="Played from"
          value={filter.from}
          onChange={(event) => onFilter({ ...filter, from: event.target.value })}
        />
        <Input
          type="date"
          aria-label="Played to"
          value={filter.to}
          onChange={(event) => onFilter({ ...filter, to: event.target.value })}
        />
      </div>
      <span className="story-eyebrow">
        {shown.length} {shown.length === 1 ? "session" : "sessions"}
      </span>
      <SessionRows sessions={shown} selectedId={selectedId} gm={gm} onPick={onPick} />
    </FilterFlyout>
  );
}

/** One row per session: its name, when it was played and where its recap stands. */
export function SessionRows<S extends ListedSession>({
  sessions,
  selectedId,
  gm,
  onPick
}: Readonly<{ sessions: readonly S[]; selectedId: string | null; gm: boolean; onPick: (sessionId: string) => void }>) {
  if (sessions.length === 0) return <p className="story-hint">No sessions match.</p>;
  return (
    <ul className="story-sessionrows" aria-label="Sessions">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            type="button"
            className={`story-sessionrow${session.id === selectedId ? " is-selected" : ""}`}
            aria-current={session.id === selectedId ? "true" : undefined}
            onClick={() => onPick(session.id)}
          >
            <CodexIcon iconId="sessions" className="story-item-icon" />
            <span className="prep-row-text">
              <span className="prep-row-title">{sessionTitle(session)}</span>
              <span className="prep-row-line">
                {[
                  realDateLabel(session.realDate),
                  gm
                    ? session.status === "planned"
                      ? "Planned"
                      : session.shared
                        ? "Recap shared"
                        : "Played, recap hidden"
                    : "Played"
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The players' session page: the recap, and what was filed under the session that they can read. */
export function PlayerSessionPage({
  token,
  session,
  records,
  calendar,
  days,
  knownTitles,
  lineOf,
  onFollow,
  phone = false
}: Readonly<{
  token: string;
  session: PlayerCodexSession;
  records: readonly PlayerCodexChronicleRecord[];
  calendar: CodexCalendar | null;
  days: string;
  /** A record's line, naming its quest or faction (see `recordLine`). */
  lineOf: (record: StoryRecord) => string;
  knownTitles: ReadonlySet<string>;
  onFollow: (target: string) => void;
  /** A phone titles the page in its top bar, so the page leaves its own title out. */
  phone?: boolean;
}>) {
  const filed = records.filter((record) => record.sessionId === session.id);
  return (
    <article className="session-reader" aria-label={sessionTitle(session)}>
      <header className="session-titlerow">
        {!phone && <h2 className="session-title">{sessionTitle(session)}</h2>}
        <span className="story-grow" />
        <span className="session-meta">{[realDateLabel(session.realDate), days].filter(Boolean).join(" · ")}</span>
      </header>
      {session.recap.trim() ? (
        <div className="session-recap">
          <CodexMarkdown
            text={session.recap}
            token={token}
            onNavigate={onFollow}
            knownTitles={knownTitles}
            audience="player"
          />
        </div>
      ) : (
        <p className="story-hint">No recap written yet.</p>
      )}
      {filed.length > 0 && (
        <>
          <h3 className="story-eyebrow">From this session</h3>
          <ul className="session-lines">
            {filed.map((record) => {
              const meta = CHRONICLE_KIND_META[record.kind];
              return (
                <li key={record.id} className="session-line">
                  <CodexIcon iconId={meta.iconId} className="story-item-icon" />
                  <span className="prep-row-text">
                    <span className="prep-row-line">
                      {[recordDay(record, calendar), meta.label].filter(Boolean).join(" · ")}
                    </span>
                    <span className="prep-row-title">{lineOf(record)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </article>
  );
}

/** The players' recap cards, newest first, for a phone; a recap new since the last visit says so. */
export function RecapCards({
  token,
  sessions,
  unseen,
  knownTitles,
  onFollow,
  onOpen
}: Readonly<{
  token: string;
  sessions: readonly PlayerCodexSession[];
  unseen: ReadonlySet<string>;
  knownTitles: ReadonlySet<string>;
  onFollow: (target: string) => void;
  onOpen: (sessionId: string) => void;
}>) {
  const ordered = filterSessions(
    sessions.map((session) => ({ ...session, recap: session.recap })),
    { text: "", statuses: [], from: "", to: "" }
  );
  if (ordered.length === 0) return <p className="story-hint">No recaps shared yet.</p>;
  return (
    <ol className="story-recapcards" aria-label="Recaps, newest first">
      {ordered.map((session) => (
        <li key={session.id} className={`story-recapcard${unseen.has(session.id) ? " is-new" : ""}`}>
          <button type="button" className="story-recapcard-head" onClick={() => onOpen(session.id)}>
            <span className="session-title is-small">{sessionTitle(session)}</span>
            {unseen.has(session.id) && <span className="story-newchip">New</span>}
            <span className="story-grow" />
            {session.realDate && <span className="session-meta">{realDateLabel(session.realDate)}</span>}
          </button>
          {session.recap.trim() && (
            <div className="session-recap is-clamped">
              <CodexMarkdown
                text={session.recap}
                token={token}
                onNavigate={onFollow}
                knownTitles={knownTitles}
                audience="player"
              />
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Story's own bar on a laptop: Chronicle, Timeline and Sessions, then whatever the view adds. */
export function StoryBar({
  view,
  onView,
  children,
  end
}: Readonly<{
  view: "chronicle" | "timeline" | "sessions";
  onView: (view: "chronicle" | "timeline" | "sessions") => void;
  children?: ReactNode;
  end?: ReactNode;
}>) {
  const views = [
    { id: "chronicle", label: "Chronicle" },
    { id: "timeline", label: "Timeline" },
    { id: "sessions", label: "Sessions" }
  ] as const;
  return (
    <div className="story-bar">
      <nav className="nh-segmented" aria-label="Story views">
        {views.map((each) => (
          <button
            key={each.id}
            type="button"
            className="nh-segmented-option tap-target interactive"
            aria-pressed={each.id === view}
            aria-current={each.id === view ? "page" : undefined}
            onClick={() => onView(each.id)}
          >
            <span className="nh-segmented-label">{each.label}</span>
          </button>
        ))}
      </nav>
      {children}
      <span className="story-grow" />
      {end}
    </div>
  );
}

/** The sessions filter in the address (`q`, `status`, `from`, `to`), so a filtered list can be linked and reopened. */
export function useSessionFilter(): readonly [SessionFilter, (next: SessionFilter) => void, boolean] {
  const { query, setFilter } = useCodexShell();
  const filter: SessionFilter = {
    text: query.get("q") ?? "",
    statuses: (query.get("status") ?? "").split(",").filter(Boolean),
    from: query.get("from") ?? "",
    to: query.get("to") ?? ""
  };
  const write = (next: SessionFilter) =>
    setFilter({
      q: next.text || null,
      status: next.statuses.join(",") || null,
      from: next.from || null,
      to: next.to || null
    });
  const any = Boolean(filter.text || filter.statuses.length || filter.from || filter.to);
  return [filter, write, any] as const;
}

/** The session the Sessions view opens on when the address names none: the active one, else the newest. */
export function defaultSessionId<S extends ListedSession>(
  sessions: readonly S[],
  activeId: string | null
): string | null {
  if (activeId && sessions.some((session) => session.id === activeId)) return activeId;
  return filterSessions(sessions, { text: "", statuses: [], from: "", to: "" })[0]?.id ?? null;
}

export function useSortedSessions<S extends ListedSession>(sessions: readonly S[]): S[] {
  return useMemo(() => filterSessions(sessions, { text: "", statuses: [], from: "", to: "" }), [sessions]);
}
