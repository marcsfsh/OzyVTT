import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Combobox,
  Field,
  GmOnlyTag,
  IconButton,
  IconX,
  Input,
  Panel,
  RevealSwitch,
  SegmentedControl,
  Select,
  Skeleton,
  TagInput,
  Textarea
} from "@vtt/ui";
import { socket } from "../socket";
import {
  calendarApi,
  calendarYearOf,
  codexApi,
  dateToInstant,
  formatWorldDate,
  journalApi,
  type CodexAutosaveSettings,
  type CodexChronicleKind,
  type CodexChronicleRecord,
  type CodexPageSummary,
  type CodexSession,
  type GmCodexCalendar
} from "./api";
import {
  CHRONICLE_FILTER_KINDS,
  CHRONICLE_KIND_META,
  CHRONICLE_LENSES,
  questEventLabel,
  questEventOf,
  chronicleWhenLabel,
  deadlineFired,
  deadlinesPassedBy,
  deadlineStateLabel,
  deadlineStateTone,
  downtimeOf,
  downtimeProposedDate,
  downtimeSummaryLabel,
  groupChronicle,
  milestoneOf,
  milestoneSummaryLabel,
  revealAheadOfPlayers,
  sameInWorldDate,
  standingChangeLabel,
  standingOf,
  type ChronicleLens
} from "./chronicle";
import { CodexIcon } from "./icons";
import { CodexMarkdown } from "./CodexMarkdown";
import { CalendarEditor } from "./CalendarEditor";
import { CodexEditor } from "./CodexEditor";
import { BODY_LAYER, TwoLayerBodyTabs, type BodyLayer } from "./TwoLayerBodyTabs";
import { sessionByNumber, sessionTitle } from "./sessions";
import { Notice, useConfirm, type NoticeMessage } from "../components/feedback";

/**
 * The campaign chronicle: one timeline of two-layer journal entries and dated `event` pages, read by
 * in-world date or by session. The composer writes journal entries only; an event row is a wiki page and
 * is edited on the page.
 */
/**
 * The composer's record shapes, all one journal row. `standing` records are written only by the standing
 * card, together with the value change, so they are not offered here.
 */
const COMPOSER_KINDS = ["entry", "deadline", "downtime", "milestone"] as const;
type ComposerKind = (typeof COMPOSER_KINDS)[number];
/** Per-kind copy. Kind labels come from `CHRONICLE_KIND_META`; the layer names come from `TwoLayerBodyTabs`. */
const COMPOSER_COPY: Readonly<
  Record<ComposerKind, Readonly<{ heading: string; textPlaceholder: string; submit: string }>>
> = {
  entry: { heading: "New journal entry", textPlaceholder: "What players know about this", submit: "Add entry" },
  deadline: { heading: "New deadline", textPlaceholder: "The duke's ultimatum expires", submit: "Add deadline" },
  downtime: { heading: "New downtime", textPlaceholder: "How the time was spent", submit: "Log downtime" },
  milestone: {
    heading: "New milestone",
    textPlaceholder: "What players know about this level",
    submit: "Record milestone"
  }
};
/** The server's bounds, so a slip is a disabled field rather than a 400. */
const DOWNTIME_TEXT_MAX = 120;
const DOWNTIME_DAYS_MAX = 3650;
/** The 5e level range. No XP arithmetic. */
const MILESTONE_LEVEL_MIN = 1;
const MILESTONE_LEVEL_MAX = 20;
const MILESTONE_REASON_MAX = 120;

type Draft = {
  kind: ComposerKind;
  playerText: string;
  gmText: string;
  sessionId: string;
  dateYear: string;
  dateMonth: string;
  dateDay: string;
  attachPageId: string;
  revealed: boolean;
  tags: readonly string[];
  who: string;
  activity: string;
  days: string;
  level: string;
  reason: string;
};
const EMPTY: Draft = {
  kind: "entry",
  playerText: "",
  gmText: "",
  sessionId: "",
  dateYear: "",
  dateMonth: "0",
  dateDay: "",
  attachPageId: "",
  revealed: false,
  tags: [],
  who: "",
  activity: "",
  days: "",
  level: "",
  reason: ""
};
const DRAFT_KEY = "codex-journal-draft";
const LENS_KEY = "codex-chronicle-lens";
const JOURNAL_DETAILS_KEY = "codex-journal-details";
const JOURNAL_DETAILS_ID = "codex-journal-details";
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
  autosave,
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
  const [records, setRecords] = useState<CodexChronicleRecord[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [calendar, setCalendar] = useState<GmCodexCalendar | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Older drafts may lack `tags` or `kind`; fall back to safe defaults.
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (!saved) return EMPTY;
      const parsed = JSON.parse(saved) as Partial<Draft>;
      return {
        ...EMPTY,
        ...parsed,
        kind: COMPOSER_KINDS.includes(parsed.kind as ComposerKind) ? (parsed.kind as ComposerKind) : "entry",
        tags: Array.isArray(parsed.tags) ? parsed.tags : []
      };
    } catch {
      return EMPTY;
    }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingKind, setEditingKind] = useState<CodexChronicleKind | null>(null);
  // A new entry set aside while the composer edits an existing one, so Edit never destroys it.
  const [stashedDraft, setStashedDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Until the first fetch settles, an empty list is not "no entries".
  const [loading, setLoading] = useState(true);
  /** Acknowledges a publish, since the prep-clock row disappears once the clocks agree. */
  const [notice, setNotice] = useState<NoticeMessage>(null);
  /** State rather than a raw read, so turning it back on takes effect without a reload. */
  const [revealWarn, setRevealWarn] = useState(readRevealWarn);
  const [bodyTab, setBodyTab] = useState<BodyLayer>("player");
  const detailsRef = useRef<HTMLElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      return localStorage.getItem(JOURNAL_DETAILS_KEY) === "open";
    } catch {
      return false;
    }
  });
  const showDetails = useCallback((open: boolean) => {
    setDetailsOpen(open);
    try {
      localStorage.setItem(JOURNAL_DETAILS_KEY, open ? "open" : "closed");
    } catch {
      /* private mode - fine */
    }
  }, []);
  useEffect(() => {
    if (detailsOpen) detailsRef.current?.focus();
  }, [detailsOpen]);

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

  const load = useCallback(async () => {
    try {
      const [nextRecords, nextPages, nextCalendar] = await Promise.all([
        journalApi.chronicle(gmToken),
        codexApi.listPages(gmToken),
        calendarApi.get(gmToken)
      ]);
      setRecords(nextRecords);
      setPages(nextPages);
      setCalendar(nextCalendar);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the journal.");
    } finally {
      setLoading(false);
    }
  }, [gmToken]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const onChanged = () => {
      void load();
    };
    socket.on("codex:changed", onChanged);
    return () => {
      socket.off("codex:changed", onChanged);
    };
  }, [load]);
  // Persist an in-progress new entry across tab switches. While editing, the stash is what's worth keeping.
  useEffect(() => {
    try {
      const pending = stashedDraft ?? (editingId ? null : draft);
      // Downtime and milestone drafts can carry the record without any prose.
      const isEmpty =
        !pending ||
        (!pending.playerText.trim() &&
          !pending.gmText.trim() &&
          !pending.who.trim() &&
          !pending.activity.trim() &&
          !pending.level.trim() &&
          !pending.reason.trim());
      if (isEmpty) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(pending));
    } catch {
      /* private mode - fine */
    }
  }, [draft, editingId, stashedDraft]);

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

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const submit = async () => {
    const inWorldDate = draft.dateYear.trim()
      ? {
          year: Math.trunc(Number(draft.dateYear) || 0),
          month: Number(draft.dateMonth || 0),
          day: Math.max(1, Math.trunc(Number(draft.dateDay) || 1))
        }
      : null;
    const input = {
      playerText: draft.playerText,
      gmText: draft.gmText.trim() || null,
      revealedToPlayers: draft.revealed,
      attachPageId: draft.attachPageId || null,
      /**
       * Sessions are linked by id; `sessionNumber` is a 400 on writes. Send an explicit null for "None",
       * since omitting the key on create would auto-file under the active session.
       */
      sessionId: draft.sessionId ? draft.sessionId : null,
      inWorldDate,
      // Always sent: omitting `tags` on an edit would keep the old ones, so clearing needs `[]`.
      tags: draft.tags
    };
    try {
      // The edit path ignores kind; a record's kind is fixed once written.
      if (editingId) await journalApi.update(gmToken, editingId, input);
      else if (draft.kind === "deadline") {
        // Also guarded by the disabled button.
        if (!inWorldDate) {
          setError("A deadline needs a date. Set the year, month and day above.");
          return;
        }
        await journalApi.createDeadline(gmToken, { ...input, inWorldDate });
      } else if (draft.kind === "downtime") {
        // Creates the record only; the clock moves when the GM confirms on the row.
        await journalApi.createDowntime(gmToken, {
          ...input,
          downtime: {
            who: draft.who.trim().slice(0, DOWNTIME_TEXT_MAX),
            activity: draft.activity.trim().slice(0, DOWNTIME_TEXT_MAX),
            days: Math.min(DOWNTIME_DAYS_MAX, Math.max(0, Math.trunc(Number(draft.days) || 0)))
          }
        });
      } else if (draft.kind === "milestone") {
        // Clamped to the 5e level range, matching the server.
        await journalApi.createMilestone(gmToken, {
          ...input,
          milestone: {
            level: Math.min(
              MILESTONE_LEVEL_MAX,
              Math.max(MILESTONE_LEVEL_MIN, Math.trunc(Number(draft.level) || MILESTONE_LEVEL_MIN))
            ),
            reason: draft.reason.trim().slice(0, MILESTONE_REASON_MAX)
          }
        });
      } else await journalApi.create(gmToken, input);
      // After an edit, restore any stashed new entry; after a create, stay on the same kind.
      setDraft(editingId ? (stashedDraft ?? EMPTY) : { ...EMPTY, kind: draft.kind });
      setStashedDraft(null);
      setEditingId(null);
      setEditingKind(null);
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save the entry.");
    }
  };
  const edit = (record: CodexChronicleRecord) => {
    if (
      !editingId &&
      (draft.playerText.trim() ||
        draft.gmText.trim() ||
        draft.who.trim() ||
        draft.activity.trim() ||
        draft.level.trim() ||
        draft.reason.trim())
    )
      setStashedDraft(draft);
    setEditingId(record.id);
    // The edit path needs the kind so a deadline's date cannot be cleared.
    setEditingKind(record.kind);
    const date = record.inWorldDate; // the raw date the GM typed, still valid if the calendar changed
    setDraft({
      // Never read on the edit path (see `submit`).
      kind: "entry",
      playerText: record.text,
      gmText: record.gmText ?? "",
      sessionId: record.sessionId ?? "",
      dateYear: date ? String(date.year) : "",
      dateMonth: date ? String(date.month) : "0",
      dateDay: date ? String(date.day) : "",
      attachPageId: record.attachPageId ?? "",
      revealed: record.revealedToPlayers,
      tags: record.tags,
      // Payloads have no update route, so they are not editable here.
      who: "",
      activity: "",
      days: "",
      level: "",
      reason: ""
    });
  };
  /** Re-reads the whole chronicle afterwards: moving the clock changes every row's dating and deadline state. */
  const applyDowntime = async (record: CodexChronicleRecord) => {
    try {
      await journalApi.applyDowntime(gmToken, record.id);
      await load();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Could not advance the campaign clock.");
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
      setError(publishError instanceof Error ? publishError.message : "Could not publish the date.");
    }
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingKind(null);
    setDraft(stashedDraft ?? EMPTY);
    setStashedDraft(null);
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

  // Filter before grouping so an empty group never renders as a bare heading.
  const allTags = useMemo(() => [...new Set(records.flatMap((record) => record.tags))].sort(), [records]);
  const filtered = useMemo(() => {
    const needle = textFilter.trim().toLowerCase();
    return records.filter(
      (record) =>
        (!kindFilter || record.kind === kindFilter) &&
        (!tagFilter || record.tags.includes(tagFilter)) &&
        (!needle ||
          record.text.toLowerCase().includes(needle) ||
          (record.gmText ?? "").toLowerCase().includes(needle) ||
          (record.title ?? "").toLowerCase().includes(needle))
    );
  }, [records, kindFilter, tagFilter, textFilter]);
  const groups = useMemo(() => groupChronicle(filtered, lens, calendar), [filtered, lens, calendar]);

  // The GM's clock; the prep-clock row shows what players are on.
  const now = calendar?.currentDate ?? null;
  const nowYear = now && calendar ? calendarYearOf(calendar, dateToInstant(calendar, now)) : null;
  const nowLabel = now && calendar ? formatWorldDate(calendar, now) : null;
  /** The prep-clock row appears only while the GM's clock and the published clock differ. */
  const publishedLabel = calendar?.publishedDate ? formatWorldDate(calendar, calendar.publishedDate) : null;
  const clockDiverged = calendar !== null && !sameInWorldDate(calendar.currentDate, calendar.publishedDate);
  /** The composer's preview of the date this downtime would propose. */
  const composerProposal =
    draft.kind === "downtime" && calendar
      ? downtimeProposedDate(calendar, Math.min(DOWNTIME_DAYS_MAX, Math.max(0, Math.trunc(Number(draft.days) || 0))))
      : null;
  const hasText = draft.playerText.trim() !== "" || draft.gmText.trim() !== "";
  /** A deadline needs its date on edit as well as create; a dateless deadline can never fire. */
  const needsDate = editingId ? editingKind === "deadline" : draft.kind === "deadline";
  const canSubmit =
    (editingId || draft.kind === "entry"
      ? hasText
      : draft.kind === "deadline"
        ? hasText && draft.dateYear.trim() !== ""
        : // A milestone needs only its level; prose is optional.
          draft.kind === "milestone"
          ? draft.level.trim() !== ""
          : hasText || draft.who.trim() !== "" || draft.activity.trim() !== "") &&
    (!needsDate || draft.dateYear.trim() !== "");

  return (
    <div className="codex-journal">
      <Panel accent="cyan" className="codex-composer">
        {/* Hidden while editing: a record's kind is fixed once written. */}
        {!editingId && (
          <div className="codex-composer-kind">
            <SegmentedControl
              ariaLabel="What to write"
              value={draft.kind}
              onChange={(next) => set({ kind: next as ComposerKind })}
              options={COMPOSER_KINDS.map((id) => ({ value: id, label: CHRONICLE_KIND_META[id].label }))}
            />
          </div>
        )}
        <div className="codex-composer-head">
          <strong>{editingId ? "Edit entry" : COMPOSER_COPY[draft.kind].heading}</strong>
          {editingId && stashedDraft && (
            <span className="codex-entry-when">Your unsaved entry is kept. It returns when you finish here.</span>
          )}
          <div className="codex-composer-head-actions">
            {nowLabel && (
              <span className="codex-now-chip" title="The date a new record is given">
                Your date: {nowLabel}
              </span>
            )}
            {nowLabel && <GmOnlyTag />}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (onOpenCalendar ? onOpenCalendar() : setCalendarOpen(true))}
            >
              Calendar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={detailsOpen}
              aria-controls={JOURNAL_DETAILS_ID}
              onClick={() => showDetails(!detailsOpen)}
            >
              Details
            </Button>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={cancelEdit}>
                Cancel
              </Button>
            )}
          </div>
        </div>
        {/* Rendered only while the two clocks differ. Default-size buttons here: this row sits directly above
            the composer's fields, where a `size="sm"` control's 44px ::after hit area would overlap them. */}
        {clockDiverged && (
          <div className="codex-prepclock">
            <span className="codex-prepclock-label">Players' date:</span>
            <span className="codex-now-chip">{publishedLabel ?? "not shared yet"}</span>
            <Button variant="secondary" onClick={publishDate}>
              Publish the date
            </Button>
            {/* The way back from "Stop warning me about this". */}
            {!revealWarn && (
              <Button
                variant="ghost"
                onClick={() => {
                  setRevealWarn(true);
                  writeRevealWarn(true);
                }}
              >
                Warn me again before showing an entry
              </Button>
            )}
          </div>
        )}
        <TwoLayerBodyTabs value={bodyTab} onChange={setBodyTab}>
          {bodyTab === "gm" && <GmOnlyTag />}
        </TwoLayerBodyTabs>
        {/* The same editor a page body uses, so `[[links]]` autocomplete and join the connection graph. */}
        {bodyTab === "player" ? (
          <CodexEditor
            id="j-player"
            token={gmToken}
            value={draft.playerText}
            onChange={(playerText) => set({ playerText })}
            ariaLabel={BODY_LAYER.player.label}
            placeholder={COMPOSER_COPY[draft.kind].textPlaceholder}
            pages={shellPages}
            onNavigate={(target) => {
              const match = shellPages.find((page) => page.title.toLowerCase() === target.trim().toLowerCase());
              if (match) onOpenPage(match.id);
            }}
            rows={7}
          />
        ) : (
          <CodexEditor
            id="j-gm"
            token={gmToken}
            value={draft.gmText}
            onChange={(gmText) => set({ gmText })}
            ariaLabel={BODY_LAYER.gm.label}
            placeholder="Notes hidden from players"
            pages={shellPages}
            onNavigate={(target) => {
              const match = shellPages.find((page) => page.title.toLowerCase() === target.trim().toLowerCase());
              if (match) onOpenPage(match.id);
            }}
            gmLayer
            rows={7}
          />
        )}
        {/* The date is in Details, so the hint says where to set it. */}
        {needsDate && !draft.dateYear.trim() && (
          <p className="codex-composer-hint">
            A deadline needs a date. Set the year, month and day under Details. It fires when your date passes it.
          </p>
        )}
        {!editingId && draft.kind === "downtime" && (
          <>
            <div className="codex-composer-meta">
              <Field label="Who" htmlFor="j-who">
                <Input
                  id="j-who"
                  maxLength={DOWNTIME_TEXT_MAX}
                  value={draft.who}
                  placeholder="Aldric"
                  onChange={(event) => set({ who: event.target.value })}
                />
              </Field>
              <Field label="Activity" htmlFor="j-activity">
                <Input
                  id="j-activity"
                  maxLength={DOWNTIME_TEXT_MAX}
                  value={draft.activity}
                  placeholder="Forging a blade"
                  onChange={(event) => set({ activity: event.target.value })}
                />
              </Field>
              <Field label="Days" htmlFor="j-days">
                <Input
                  id="j-days"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={DOWNTIME_DAYS_MAX}
                  value={draft.days}
                  placeholder="7"
                  onChange={(event) => set({ days: event.target.value })}
                />
              </Field>
            </div>
            {/* Say up front that logging proposes a date and moves nothing. */}
            {composerProposal && calendar && (
              <p className="codex-composer-hint">
                Logging this proposes moving your date to {formatWorldDate(calendar, composerProposal)}. Nothing moves
                until you confirm it on the record.
              </p>
            )}
          </>
        )}
        {!editingId && draft.kind === "milestone" && (
          <>
            <div className="codex-composer-meta">
              <Field label="Level reached" htmlFor="j-level">
                <Input
                  id="j-level"
                  type="number"
                  inputMode="numeric"
                  min={MILESTONE_LEVEL_MIN}
                  max={MILESTONE_LEVEL_MAX}
                  value={draft.level}
                  placeholder="5"
                  onChange={(event) => set({ level: event.target.value })}
                />
              </Field>
              <Field label="Why" htmlFor="j-reason">
                <Input
                  id="j-reason"
                  maxLength={MILESTONE_REASON_MAX}
                  value={draft.reason}
                  placeholder="Cleared the Sunless Citadel"
                  onChange={(event) => set({ reason: event.target.value })}
                />
              </Field>
            </div>
            <p className="codex-composer-hint">
              A milestone records the level the party reached and when. It changes no character sheet and counts no XP.
              Leave the date blank to record it at your current date.
            </p>
          </>
        )}
        <div className="codex-composer-foot">
          <RevealSwitch
            revealed={draft.revealed}
            onChange={(revealed) => set({ revealed })}
            ariaLabel="Show this entry to players"
          />
          <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>
            {editingId ? "Save entry" : COMPOSER_COPY[draft.kind].submit}
          </Button>
        </div>

        {/* Filing details: the same panel as pages and quests, scoped to the composer rather than the viewport. */}
        {detailsOpen && (
          <aside
            id={JOURNAL_DETAILS_ID}
            className="codex-editor-context scroll-y"
            aria-label="Entry details"
            tabIndex={-1}
            ref={detailsRef}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                showDetails(false);
              }
            }}
          >
            <div className="codex-context-head">
              <h3 className="codex-backlinks-title">Entry details</h3>
              <IconButton label="Close entry details" size="sm" onClick={() => showDetails(false)}>
                <IconX />
              </IconButton>
            </div>
            {/* Chosen by record, so renumbering a session relabels entries without a journal write. */}
            <Field label="Session" htmlFor="j-session">
              <Select
                id="j-session"
                value={draft.sessionId}
                onChange={(event) => set({ sessionId: event.target.value })}
              >
                <option value="">None</option>
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {sessionTitle(session)}
                    {session.id === activeSessionId ? " (active)" : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="codex-composer-meta">
              <Field label="Year" htmlFor="j-year">
                <Input
                  id="j-year"
                  type="number"
                  inputMode="numeric"
                  value={draft.dateYear}
                  placeholder="1492"
                  onChange={(event) => set({ dateYear: event.target.value })}
                />
              </Field>
              <Field label="Month" htmlFor="j-month">
                <Select
                  id="j-month"
                  value={draft.dateMonth}
                  disabled={!draft.dateYear.trim()}
                  onChange={(event) => set({ dateMonth: event.target.value })}
                >
                  {(calendar?.months ?? []).map((month, index) => (
                    <option key={index} value={String(index)}>
                      {month.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Day" htmlFor="j-day">
                <Input
                  id="j-day"
                  type="number"
                  inputMode="numeric"
                  value={draft.dateDay}
                  placeholder="1"
                  disabled={!draft.dateYear.trim()}
                  onChange={(event) => set({ dateDay: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Attach to page" htmlFor="j-page">
              <Combobox
                id="j-page"
                options={pages.map((page) => ({ id: page.id, label: page.title }))}
                value={draft.attachPageId || null}
                onChange={(id) => set({ attachPageId: id ?? "" })}
                ariaLabel="Attach to page"
                placeholder="None"
              />
            </Field>
            <Field label="Tags" htmlFor="j-tags">
              <TagInput
                id="j-tags"
                ariaLabel="Tags"
                placeholder="session-recap, downtime"
                values={draft.tags}
                onChange={(next) => set({ tags: next })}
                max={24}
                maxReachedReason="An entry may carry at most 24 tags."
                suggestions={tagSuggestions}
                /* Keep the default slugify: it matches the server's tag rule, which rejects rather than sanitises. */
              />
            </Field>
          </aside>
        )}
      </Panel>

      {error && <Alert tone="danger">{error}</Alert>}
      <Notice notice={notice} />

      {/* Filters are client-side over the fetched records; their state lives in the URL. */}
      <div className="codex-timeline-lens">
        <SegmentedControl
          ariaLabel="Journal lens"
          value={lens}
          onChange={(next) => setLens(next as ChronicleLens)}
          options={CHRONICLE_LENSES.map((option) => ({ value: option.id, label: option.label }))}
        />
        <Select
          aria-label="Filter by kind"
          value={kindFilter ?? ""}
          onChange={(event) => onFilterChange?.({ kind: event.target.value || null })}
        >
          <option value="">All kinds</option>
          {CHRONICLE_FILTER_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {CHRONICLE_KIND_META[kind].label}
            </option>
          ))}
        </Select>
        <Input
          aria-label="Filter the journal"
          placeholder="Filter the journal"
          value={textFilter}
          onChange={(event) => onFilterChange?.({ q: event.target.value || null })}
        />
        {allTags.length > 0 && (
          <Select
            aria-label="Filter by tag"
            value={tagFilter ?? ""}
            onChange={(event) => onFilterChange?.({ tag: event.target.value || null })}
          >
            <option value="">All tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </Select>
        )}
      </div>

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
              {group.records.map((record) => {
                const meta = CHRONICLE_KIND_META[record.kind];
                const isEvent = record.kind === "event";
                const isDeadline = record.kind === "deadline";
                const fired = deadlineFired(record);
                // Payloads are only opened through their kind gates (`chronicle.ts`).
                const downtime = downtimeOf(record);
                const milestone = milestoneOf(record);
                const standing = standingOf(record);
                const questEvent = questEventOf(record);
                // The server's proposed date, since the server decides where the clock lands.
                const proposed = downtime && !downtime.applied ? record.proposedDate : null;
                // Counted against the whole chronicle, not this group. Zero says nothing.
                const passing = proposed ? deadlinesPassedBy(records, calendar, proposed) : 0;
                return (
                  <article
                    key={`${record.kind}-${record.id}`}
                    id={`codex-entry-${record.id}`}
                    aria-current={record.id === focusedEntryId ? "true" : undefined}
                    className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${isEvent ? " is-event" : ""}${isDeadline ? " is-deadline" : ""}${downtime ? " is-downtime" : ""}${record.id === focusedEntryId ? " is-focused" : ""}`}
                  >
                    <header className="codex-entry-head">
                      <div className="codex-entry-meta">
                        <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {isDeadline && <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>}
                        <span className="codex-entry-when">{chronicleWhenLabel(record)}</span>
                        {/* `sessionId` present: a link. Null with a number: a deleted, once-revealed session's bare label. */}
                        {record.sessionId && onOpenSession ? (
                          <button
                            type="button"
                            className="codex-entry-sessionlink"
                            onClick={() => onOpenSession(record.sessionId!)}
                          >
                            {record.sessionNumber !== null ? `Session ${record.sessionNumber}` : "This session"}
                          </button>
                        ) : (
                          record.sessionNumber !== null && (
                            <span className="codex-entry-when">Session {record.sessionNumber}</span>
                          )
                        )}
                      </div>
                      <RevealSwitch
                        revealed={record.revealedToPlayers}
                        onChange={(revealed) => reveal(record, revealed)}
                        ariaLabel={isEvent ? "Show this event to players" : "Show this entry to players"}
                      />
                    </header>
                    {record.title && <h4 className="codex-entry-title">{record.title}</h4>}
                    {record.text.trim() && (
                      <div className="codex-entry-body">
                        <CodexMarkdown
                          text={record.text}
                          token={gmToken}
                          onNavigate={(target) => {
                            const page = pages.find(
                              (candidate) => candidate.title.toLowerCase() === target.toLowerCase()
                            );
                            if (page) onOpenPage(page.id);
                          }}
                        />
                      </div>
                    )}
                    {record.gmText && (
                      <div className="codex-entry-gm">
                        <GmOnlyTag />
                        <CodexMarkdown text={record.gmText} token={gmToken} />
                      </div>
                    )}
                    {/* Read-only; tag navigation lives in Pages. */}
                    {record.tags.length > 0 && (
                      <ul className="codex-entry-tags" aria-label="Entry tags">
                        {record.tags.map((tag) => (
                          <li key={tag}>
                            <Badge>{tag}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* Confirm is the only control on this row that moves the clock, and only while unapplied. */}
                    {downtime && (
                      <div className="codex-downtime">
                        <p className="codex-downtime-what">{downtimeSummaryLabel(downtime)}</p>
                        {downtime.applied ? (
                          <p className="codex-downtime-state">Your date has already been moved for this downtime.</p>
                        ) : proposed && calendar ? (
                          <div className="codex-downtime-apply">
                            <span className="codex-downtime-proposal">
                              Move your date to {formatWorldDate(calendar, proposed)}
                              {passing > 0
                                ? `. This passes ${passing} ${passing === 1 ? "deadline" : "deadlines"}.`
                                : ""}
                            </span>
                            {/* Default size: grows its own paint to 44px with no ::after overhang into the footer buttons below. */}
                            <Button variant="secondary" onClick={() => applyDowntime(record)}>
                              Confirm
                            </Button>
                          </div>
                        ) : (
                          <p className="codex-downtime-state">
                            Set your date on the Calendar to move the clock from this downtime.
                          </p>
                        )}
                      </div>
                    )}
                    {milestone && <p className="codex-downtime-what">{milestoneSummaryLabel(milestone)}</p>}
                    {/* A quest-history row has no prose; this sentence is the whole record. */}
                    {questEvent && <p className="codex-downtime-what">{questEventLabel(questEvent, null)}</p>}
                    {standing && (
                      <p className="codex-downtime-what">
                        {standingChangeLabel(
                          standing,
                          pages.find((page) => page.id === standing.factionPageId)?.title ?? null
                        )}
                      </p>
                    )}
                    {/* Event rows only offer "Open page": edit and delete happen on the page. */}
                    <footer className="codex-entry-foot">
                      {isEvent && (
                        <Button variant="ghost" size="sm" onClick={() => onOpenPage(record.id)}>
                          Open page
                        </Button>
                      )}
                      {!isEvent && record.attachPageId && (
                        <Button variant="ghost" size="sm" onClick={() => onOpenPage(record.attachPageId!)}>
                          Open page
                        </Button>
                      )}
                      {record.attachMarkerId && onOpenMarker && (
                        <Button variant="ghost" size="sm" onClick={() => onOpenMarker(record.attachMarkerId!)}>
                          Open pin
                        </Button>
                      )}
                      {record.kind === "combat" && record.sourceEncounterId !== null && onOpenReplay && (
                        <Button variant="ghost" size="sm" onClick={() => onOpenReplay(record.sourceEncounterId!)}>
                          Open replay
                        </Button>
                      )}
                      {!isEvent && (
                        <Button variant="ghost" size="sm" onClick={() => edit(record)}>
                          Edit
                        </Button>
                      )}
                      {!isEvent && (
                        <Button variant="ghost" size="sm" onClick={() => remove(record)}>
                          Delete
                        </Button>
                      )}
                    </footer>
                  </article>
                );
              })}
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
