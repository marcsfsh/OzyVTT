import { useEffect, useMemo } from "react";
import { Badge } from "@vtt/ui";
import {
  calendarYearOf,
  dateToInstant,
  formatWorldDate,
  type CodexCalendar,
  type PlayerCodexChronicleRecord,
  type PlayerCodexPageSummary,
  type PlayerCodexQuest
} from "@vtt/domain";
import {
  CHRONICLE_KIND_META,
  chronicleWhenLabel,
  deadlineFired,
  deadlineStateLabel,
  deadlineStateTone,
  downtimeOf,
  downtimeSummaryLabel,
  groupChronicle,
  milestoneOf,
  milestoneSummaryLabel,
  questEventLabel,
  questEventOf,
  standingChangeLabel,
  standingOf
} from "./chronicle";
import { CodexIcon } from "./icons";
import { CodexMarkdown } from "./CodexMarkdown";
import { JournalFilters, filterChronicle } from "./JournalFilters";

/** The player's Journal: the GM's year grouping and Today marker, using the server's `calendarInstant`. */
export function PlayerJournal({
  records,
  calendar,
  pages,
  token,
  focusedId,
  onNavigate,
  knownTitles,
  quests,
  kindFilter,
  tagFilter,
  textFilter,
  onFilterChange
}: Readonly<{
  records: readonly PlayerCodexChronicleRecord[];
  calendar: CodexCalendar | null;
  pages: readonly PlayerCodexPageSummary[];
  token: string;
  focusedId: string | null;
  onNavigate: (target: string) => void;
  knownTitles: ReadonlySet<string>;
  quests: readonly PlayerCodexQuest[];
  /** The GM's Journal filters over the player's records. */
  kindFilter: string | null;
  tagFilter: string | null;
  textFilter: string;
  onFilterChange: (next: Readonly<Record<string, string | null>>) => void;
}>) {
  useEffect(() => {
    if (!focusedId) return;
    document.getElementById(`codex-player-entry-${focusedId}`)?.scrollIntoView({ block: "center" });
  }, [focusedId, records]);

  const filter = { kind: kindFilter, tag: tagFilter, text: textFilter };
  const filtered = useMemo(
    () => filterChronicle(records, { kind: kindFilter, tag: tagFilter, text: textFilter }),
    [records, kindFilter, tagFilter, textFilter]
  );
  /** By in-world year, from the server's instants, as the GM's date lens reads. */
  const groups = useMemo(() => groupChronicle(filtered, "date", calendar), [filtered, calendar]);
  const today = calendar?.currentDate ?? null;
  const todayYear = today && calendar ? calendarYearOf(calendar, dateToInstant(calendar, today)) : null;
  const todayLabel = today && calendar ? formatWorldDate(calendar, today) : null;

  return (
    <div className="codex-journal">
      {/* Filters live in the address so the dashboard's deadline card can deep-link. */}
      {records.length > 0 && <JournalFilters records={records} filter={filter} onFilterChange={onFilterChange} />}
      <div className="codex-timeline">
        {records.length === 0 && <p className="codex-list-empty">No entries shared yet.</p>}
        {records.length > 0 && filtered.length === 0 && (
          <p className="codex-list-empty">Nothing in the Journal matches these filters.</p>
        )}
        {groups.map((group) => (
          <section key={group.key} className="codex-timeline-group">
            <div className="codex-timeline-year">{group.label}</div>
            {todayYear !== null && group.key === String(todayYear) && (
              <div className="codex-timeline-now">Today: {todayLabel}</div>
            )}
            {group.records.map((record) => {
              const meta = CHRONICLE_KIND_META[record.kind];
              const fired = deadlineFired(record);
              const downtime = downtimeOf(record);
              const milestone = milestoneOf(record);
              const standingChange = standingOf(record);
              const questEvent = questEventOf(record);
              return (
                <article
                  key={`${record.kind}-${record.id}`}
                  id={`codex-player-entry-${record.id}`}
                  aria-current={record.id === focusedId ? "true" : undefined}
                  className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${record.kind === "event" ? " is-event" : ""}${record.kind === "deadline" ? " is-deadline" : ""}${downtime ? " is-downtime" : ""}${record.id === focusedId ? " is-focused" : ""}`}
                >
                  <header className="codex-entry-head codex-entry-meta">
                    <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {record.kind === "deadline" && (
                      <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>
                    )}
                    <span className="codex-entry-when">{chronicleWhenLabel(record)}</span>
                  </header>
                  {record.title && <h4 className="codex-entry-title">{record.title}</h4>}
                  <div className="codex-entry-body">
                    <CodexMarkdown
                      text={record.text}
                      onNavigate={onNavigate}
                      token={token}
                      knownTitles={knownTitles}
                      audience="player"
                    />
                  </div>
                  {downtime && <p className="codex-downtime-what">{downtimeSummaryLabel(downtime)}</p>}
                  {milestone && <p className="codex-downtime-what">{milestoneSummaryLabel(milestone)}</p>}
                  {standingChange && (
                    <p className="codex-downtime-what">
                      {standingChangeLabel(
                        standingChange,
                        pages.find((summary) => summary.id === standingChange.factionPageId)?.title ?? null
                      )}
                    </p>
                  )}
                  {/* A quest-history row has no prose. The title comes from the player's own quest feed;
                      an unrevealed quest stays "A quest". */}
                  {questEvent && (
                    <p className="codex-downtime-what">
                      {questEventLabel(
                        questEvent,
                        quests.find((quest) => quest.id === questEvent.questId)?.title ?? null
                      )}
                    </p>
                  )}
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
