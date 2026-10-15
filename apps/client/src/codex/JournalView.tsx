import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, SegmentedControl, Skeleton } from "@vtt/ui";
import {
  calendarYearOf,
  dateToInstant,
  formatWorldDate,
  type CodexAutosaveSettings,
  type CodexChronicleRecord,
  type CodexPageSummary,
  type CodexSession
} from "@vtt/domain";
import { calendarApi, codexApi, journalApi } from "./api";
import { CHRONICLE_LENSES, groupChronicle, revealAheadOfPlayers, type ChronicleLens } from "./chronicle";
import { CalendarEditor } from "./CalendarEditor";
import { JournalComposer, useJournalDraft } from "./JournalComposer";
import { JournalEntryCard } from "./JournalEntryCard";
import { JournalFilters, filterChronicle } from "./JournalFilters";
import { sessionByNumber } from "./sessions";
import { Notice, useConfirm, type NoticeMessage } from "../components/feedback";
import { useCodexQuery } from "./useCodexQuery";

/**
 * The campaign chronicle: one timeline of two-layer journal entries and dated `event` pages, read by
 * in-world date or by session. The composer writes journal entries only; an event row is a wiki page and
 * is edited on the page.
 */
/** A stable empty feed, so a list that has not loaded yet keeps one identity across renders. */
const NO_ROWS: readonly never[] = [];
const LENS_KEY = "codex-chronicle-lens";
/** Per-device switch for the prep-clock reveal warning. Absent (or unreadable storage) means on. */
const REVEAL_WARN_KEY = "codex.warn-reveal-ahead";
const readRevealWarn = (): boolean => {
  try {
    return localStorage.getItem(REVEAL_WARN_KEY) !== "off";
  } catch {
    return true;
  }
};
const writeRevealWarn = (on: boolean) => {
  try {
    localStorage.setItem(REVEAL_WARN_KEY, on ? "on" : "off");
  } catch {
    /* private mode - the preference stays in-session */
  }
};

/** Pin and replay jumps are handed up via `onOpenMarker`/`onOpenReplay`; this view never navigates sideways. */
export function JournalView({
  gmToken,
  pages: shellPages,
  onOpenPage,
  onOpenMarker,
  onOpenReplay,
  openEntryId = null,
  onOpenedEntry = () => {},
  sessions = [],
  activeSessionId = null,
  onOpenSession,
  onOpenCalendar,
  kindFilter = null,
  tagFilter = null,
  textFilter = "",
  onFilterChange
}: Readonly<{
  gmToken: string;
  /** Autosave cadence for the edit path. New entries still use an explicit Add. */
  autosave: CodexAutosaveSettings;
  /** The shell's page feed, for `[[` autocomplete. */
  pages: readonly CodexPageSummary[];
  onOpenPage: (pageId: string) => void;
  onOpenMarker?: (markerId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  openEntryId?: string | null;
  onOpenedEntry?: () => void;
  /** Filters live in the URL so a dashboard card can deep-link to a filtered Journal. */
  kindFilter?: string | null;
  tagFilter?: string | null;
  textFilter?: string;
  onFilterChange?: (next: Readonly<Record<string, string | null>>) => void;
  onOpenCalendar?: () => void;
  activeSessionId?: string | null;
  /** From the workspace's single session feed, so the by-session lens agrees with Sessions. */
  sessions?: readonly CodexSession[];
  /** Opens Sessions on that session. */
  onOpenSession?: (sessionId: string) => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  // Until the first read settles, an empty list is not "no entries".
  const journal = useCodexQuery(
    useCallback(async () => {
      const [records, pages, calendar] = await Promise.all([
        journalApi.chronicle(gmToken),
        codexApi.listPages(gmToken),
        calendarApi.get(gmToken)
      ]);
      return { records, pages, calendar };
    }, [gmToken]),
    { failure: "Could not load the journal." }
  );
  const records = journal.data?.records ?? NO_ROWS;
  const pages = journal.data?.pages ?? NO_ROWS;
  const calendar = journal.data?.calendar ?? null;
  const loading = journal.loading;
  const load = journal.reload;
  /** A failed write. Fresh data clears it. */
  const [actionError, setActionError] = useState<string | null>(null);
  useEffect(() => setActionError(null), [journal.data]);
  const error = actionError ?? journal.error;
  const [calendarOpen, setCalendarOpen] = useState(false);
  const composer = useJournalDraft();
  /** Acknowledges a publish, since the prep-clock row disappears once the clocks agree. */
  const [notice, setNotice] = useState<NoticeMessage>(null);
  /** State rather than a raw read, so turning it back on takes effect without a reload. */
  const [revealWarn, setRevealWarn] = useState(readRevealWarn);
  // The lens survives leaving and returning to the Journal.
  const [lens, setLens] = useState<ChronicleLens>(() => {
    try {
      return sessionStorage.getItem(LENS_KEY) === "session" ? "session" : "date";
    } catch {
      return "date";
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(LENS_KEY, lens);
    } catch {
      /* private mode - fine */
    }
  }, [lens]);

  // Arriving from a search hit: mark and scroll to the entry once. The latch clears with the request so
  // the same entry can be reached again later.
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const handledEntryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openEntryId) {
      handledEntryRef.current = null;
      return;
    }
    if (loading || handledEntryRef.current === openEntryId) return;
    handledEntryRef.current = openEntryId;
    setFocusedEntryId(openEntryId);
    onOpenedEntry();
  }, [openEntryId, loading, onOpenedEntry]);
  // Runs on `records` too: the article only exists once the timeline has rendered it.
  useEffect(() => {
    if (!focusedEntryId) return;
    document.getElementById(`codex-entry-${focusedEntryId}`)?.scrollIntoView({ block: "center" });
  }, [focusedEntryId, records]);

  /** Re-reads the whole chronicle afterwards: moving the clock changes every row's dating and deadline state. */
  const applyDowntime = async (record: CodexChronicleRecord) => {
    try {
      await journalApi.applyDowntime(gmToken, record.id);
      await load();
    } catch (applyError) {
      setActionError(applyError instanceof Error ? applyError.message : "Could not advance the campaign clock.");
    }
  };
  /** Publish the GM's clock to players. Nothing else on this client does. */
  const publishDate = async () => {
    // Name the date before the round-trip so the message reflects what was published.
    const published = calendar?.currentDate ? formatWorldDate(calendar, calendar.currentDate) : null;
    try {
      await calendarApi.publish(gmToken);
      await load();
      setNotice({
        tone: "success",
        text: published ? `Players now see ${published}.` : "The date is published to players."
      });
    } catch (publishError) {
      setActionError(publishError instanceof Error ? publishError.message : "Could not publish the date.");
    }
  };
  /** Each kind uses its own reveal route; an event row flips the page's reveal flag. */
  const reveal = async (record: CodexChronicleRecord, revealed: boolean) => {
    /**
     * Warn before a reveal hands players a date past their published clock. Hiding never warns. Pages are
     * not checked: their date is one the GM typed deliberately, whereas these records auto-date at the
     * prep clock.
     */
    if (revealed && revealWarn && revealAheadOfPlayers(record, calendar)) {
      const dated =
        record.inWorldLabel ??
        (record.inWorldDate && calendar ? formatWorldDate(calendar, record.inWorldDate) : "a later date");
      const seen =
        calendar?.publishedDate && calendar ? formatWorldDate(calendar, calendar.publishedDate) : "no date yet";
      const proceed = await confirm({
        title: "This is dated ahead of the players",
        body: `Players' date is still ${seen}. Showing this record tells them the date has reached ${dated}. Publish the date first if you do not want that.`,
        confirmLabel: "Show anyway",
        suppress: {
          label: "Stop warning me about this",
          onChange: (suppressed) => {
            if (suppressed) {
              setRevealWarn(false);
              writeRevealWarn(false);
            }
          }
        }
      });
      if (!proceed) return;
    }
    if (record.kind === "event") await codexApi.revealPage(gmToken, record.id, revealed);
    else await journalApi.reveal(gmToken, record.id, revealed);
    await load();
  };
  const remove = async (record: CodexChronicleRecord) => {
    if (
      await confirm({
        title: "Delete entry",
        body: "Delete this journal entry? This cannot be undone.",
        confirmLabel: "Delete",
        danger: true
      })
    ) {
      await journalApi.remove(gmToken, record.id);
      await load();
    }
  };

  // Suggest tags already in use on pages and entries, so the GM reuses existing ones.
  const tagSuggestions = useMemo(
    () => [...new Set([...pages.flatMap((page) => page.tags), ...records.flatMap((record) => record.tags)])].sort(),
    [pages, records]
  );

  const filter = { kind: kindFilter, tag: tagFilter, text: textFilter };
  const filtered = useMemo(
    () => filterChronicle(records, { kind: kindFilter, tag: tagFilter, text: textFilter }),
    [records, kindFilter, tagFilter, textFilter]
  );
  const groups = useMemo(() => groupChronicle(filtered, lens, calendar), [filtered, lens, calendar]);

  // The GM's clock, for the Today marker.
  const now = calendar?.currentDate ?? null;
  const nowYear = now && calendar ? calendarYearOf(calendar, dateToInstant(calendar, now)) : null;
  const nowLabel = now && calendar ? formatWorldDate(calendar, now) : null;

  return (
    <div className="codex-journal">
      <JournalComposer
        gmToken={gmToken}
        composer={composer}
        calendar={calendar}
        sessions={sessions}
        activeSessionId={activeSessionId}
        pages={pages}
        editorPages={shellPages}
        tagSuggestions={tagSuggestions}
        revealWarn={revealWarn}
        onWarnAgain={() => {
          setRevealWarn(true);
          writeRevealWarn(true);
        }}
        onOpenPage={onOpenPage}
        onOpenCalendar={() => (onOpenCalendar ? onOpenCalendar() : setCalendarOpen(true))}
        onPublish={() => void publishDate()}
        onSaved={load}
        onError={setActionError}
      />

      {error && <Alert tone="danger">{error}</Alert>}
      <Notice notice={notice} />

      {/* Filters are client-side over the fetched records; their state lives in the URL. */}
      <JournalFilters records={records} filter={filter} onFilterChange={onFilterChange ?? (() => undefined)}>
        <SegmentedControl
          ariaLabel="Journal lens"
          value={lens}
          onChange={(next) => setLens(next as ChronicleLens)}
          options={CHRONICLE_LENSES.map((option) => ({ value: option.id, label: option.label }))}
        />
      </JournalFilters>

      <div className="codex-timeline">
        {loading && (
          <div className="codex-list-loading">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} variant="text" />
            ))}
          </div>
        )}
        {!loading && records.length === 0 && <p className="codex-list-empty">No journal entries yet.</p>}
        {!loading && records.length > 0 && filtered.length === 0 && (
          <p className="codex-list-empty">Nothing in the Journal matches these filters.</p>
        )}
        {groups.map((group) => {
          /**
           * A session heading opens its session only under the session lens and only when a session record
           * exists for that number (older numbered groups may have none). Under the date lens the key is a year.
           */
          const groupSession =
            lens === "session" && group.key !== "none" && onOpenSession
              ? sessionByNumber(sessions, Number(group.key))
              : null;
          return (
            <section key={group.key} className="codex-timeline-group">
              {groupSession ? (
                <button
                  type="button"
                  className="codex-timeline-year is-openable"
                  onClick={() => onOpenSession!(groupSession.id)}
                >
                  {group.label}
                  <span className="codex-timeline-year-open" aria-hidden="true">
                    ›
                  </span>
                </button>
              ) : (
                <div className="codex-timeline-year">{group.label}</div>
              )}
              {/* The Today marker belongs to the date lens only. */}
              {lens === "date" && nowYear !== null && group.key === String(nowYear) && (
                <div className="codex-timeline-now">Today: {nowLabel}</div>
              )}
              {group.records.map((record) => (
                <JournalEntryCard
                  key={`${record.kind}-${record.id}`}
                  gmToken={gmToken}
                  record={record}
                  records={records}
                  calendar={calendar}
                  pages={pages}
                  focused={record.id === focusedEntryId}
                  onOpenPage={onOpenPage}
                  onOpenMarker={onOpenMarker}
                  onOpenReplay={onOpenReplay}
                  onOpenSession={onOpenSession}
                  onReveal={(revealed) => void reveal(record, revealed)}
                  onApplyDowntime={() => void applyDowntime(record)}
                  onEdit={() => composer.edit(record)}
                  onRemove={() => void remove(record)}
                />
              ))}
            </section>
          );
        })}
      </div>

      {/* Reload the full GM calendar after a save: the PUT echo lacks the published date. */}
      {calendarOpen && calendar && (
        <CalendarEditor
          gmToken={gmToken}
          calendar={calendar}
          onSaved={() => {
            void load();
          }}
          onClose={() => setCalendarOpen(false)}
        />
      )}
      {confirmDialog}
    </div>
  );
}
