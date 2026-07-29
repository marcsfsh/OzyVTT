import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Field, Input, Panel, SegmentedControl, Select, Skeleton, TagInput, Textarea } from "@vtt/ui";
import { socket } from "../socket";
import { calendarApi, calendarYearOf, codexApi, dateToInstant, formatWorldDate, journalApi, type CodexChronicleRecord, type CodexPageSummary, type GmCodexCalendar } from "./api";
import { CHRONICLE_KIND_META, CHRONICLE_LENSES, chronicleWhenLabel, deadlineFired, deadlineStateLabel, deadlineStateTone, downtimeProposedDate, downtimeSummaryLabel, groupChronicle, sameInWorldDate, type ChronicleLens } from "./chronicle";
import { CodexIcon } from "./icons";
import { CodexMarkdown } from "./CodexMarkdown";
import { CalendarEditor } from "./CalendarEditor";
import { EntityPicker } from "./EntityPicker";
import { RevealSwitch, GmOnlyTag } from "./SecretMarkers";
import { sessionByNumber, type SessionRef } from "./sessions";
import { useConfirm } from "../components/feedback";

/**
 * The campaign chronicle (CT-11 / CT-12): **one** timeline carrying GM-written two-layer journal entries
 * AND dated `event` pages, placed on the world's own calendar and readable through two lenses — by
 * in-world date or by session. A structured in-world date is what puts a record on it; entries can also
 * carry a session #, be pinned to a page, and reveal to players. Logged encounters auto-post here.
 *
 * The composer below writes JOURNAL ENTRIES only. An `event` row is a wiki page: its two layers, its
 * fields and its date are edited on the page itself, which is why an event row offers "Open page" where
 * an entry row offers Edit/Delete. One timeline, two kinds of record, each edited where it lives.
 */
/**
 * M11: the composer writes THREE shapes of the same record — an entry, a deadline (CT-5) and downtime
 * (CT-10). One composer rather than three, because they are one row in one table: two layers of prose, a
 * reveal flag and an in-world date. A deadline adds only the rule that the date is required (a deadline
 * with no date can never fire); downtime adds who/activity/days.
 */
const COMPOSER_KINDS = ["entry", "deadline", "downtime"] as const;
type ComposerKind = (typeof COMPOSER_KINDS)[number];
/** The words each shape uses. The KIND labels come from `CHRONICLE_KIND_META`, so the composer's switch
    and the rows it produces can never call the same record two different things. */
const COMPOSER_COPY: Readonly<Record<ComposerKind, Readonly<{ heading: string; textLabel: string; textPlaceholder: string; submit: string }>>> = {
  entry: { heading: "New journal entry", textLabel: "Player-facing summary", textPlaceholder: "What the party knows about this…", submit: "Add entry" },
  // D11-C: a deadline stores no payload — WHAT will happen is this text, WHEN is the record's own date.
  deadline: { heading: "New deadline", textLabel: "What will happen", textPlaceholder: "The duke's ultimatum expires…", submit: "Add deadline" },
  downtime: { heading: "New downtime", textLabel: "What the party knows", textPlaceholder: "How the time was spent…", submit: "Log downtime" }
};
/** The server's bounds, stated here too, so a slip is a disabled field rather than a generic 400. */
const DOWNTIME_TEXT_MAX = 120;
const DOWNTIME_DAYS_MAX = 3650;

type Draft = { kind: ComposerKind; playerText: string; gmText: string; sessionNumber: string; dateYear: string; dateMonth: string; dateDay: string; attachPageId: string; revealed: boolean; tags: readonly string[]; who: string; activity: string; days: string };
const EMPTY: Draft = { kind: "entry", playerText: "", gmText: "", sessionNumber: "", dateYear: "", dateMonth: "0", dateDay: "", attachPageId: "", revealed: false, tags: [], who: "", activity: "", days: "" };
const DRAFT_KEY = "codex-journal-draft";
const LENS_KEY = "codex-chronicle-lens";

/**
 * CI-6 (return edge): an entry knows where it happened (`attachMarkerId`, set by the combat bridge when
 * a battle is logged at a pin) and which encounter produced it (`sourceEncounterId`). Both jumps are
 * owned by surfaces above this one — the Atlas for the pin, the replay panel for the fight — so the
 * journal hands the id up rather than reaching sideways into either. `onOpenReplay` is the SAME prop
 * `PageTimeline` already takes, threaded from the same place, so there is one replay path and not two.
 */
export function JournalView({ gmToken, onOpenPage, onOpenMarker, onOpenReplay, openEntryId = null, onOpenedEntry = () => {}, sessions = [], onOpenSession }: Readonly<{
  gmToken: string;
  onOpenPage: (pageId: string) => void;
  onOpenMarker?: (markerId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  openEntryId?: string | null;
  onOpenedEntry?: () => void;
  /**
   * M9: the session RECORDS, handed down from the workspace's single feed rather than fetched here.
   * A second read would be a second answer to "which sessions exist", and the by-session lens would be
   * the surface where the two disagreed.
   */
  sessions?: readonly SessionRef[];
  /** R1: opens the session log ON that session. Absent = the lens keeps rendering exactly as it did. */
  onOpenSession?: (sessionId: string) => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [records, setRecords] = useState<CodexChronicleRecord[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [calendar, setCalendar] = useState<GmCodexCalendar | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // A draft saved before CI-2 has no `tags` key, so EMPTY supplies one; the Array guard also stops a
  // corrupt value reaching TagInput, which maps over it. `kind` is parsed the same fail-closed way (a
  // draft saved before M11 has none, and an unknown one must land on `entry` rather than on undefined).
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (!saved) return EMPTY;
      const parsed = JSON.parse(saved) as Partial<Draft>;
      return {
        ...EMPTY, ...parsed,
        kind: COMPOSER_KINDS.includes(parsed.kind as ComposerKind) ? (parsed.kind as ComposerKind) : "entry",
        tags: Array.isArray(parsed.tags) ? parsed.tags : []
      };
    } catch { return EMPTY; }
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  // An in-progress NEW entry, set aside while the composer is borrowed to edit an existing one. Without
  // this, clicking Edit overwrote the draft AND (via the effect below) deleted its sessionStorage backup.
  const [stashedDraft, setStashedDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // CF-2: an empty list is ambiguous until the first fetch settles — without this the journal
  // asserts "No journal entries yet." over a campaign that simply has not loaded.
  const [loading, setLoading] = useState(true);

  // CT-12: the lens is a reading preference, so it survives leaving and returning to the mode — the same
  // sessionStorage discipline the composer draft uses, and for the same reason.
  const [lens, setLens] = useState<ChronicleLens>(() => {
    try { return sessionStorage.getItem(LENS_KEY) === "session" ? "session" : "date"; } catch { return "date"; }
  });
  useEffect(() => { try { sessionStorage.setItem(LENS_KEY, lens); } catch { /* private mode - fine */ } }, [lens]);

  const load = useCallback(async () => {
    try {
      const [nextRecords, nextPages, nextCalendar] = await Promise.all([journalApi.chronicle(gmToken), codexApi.listPages(gmToken), calendarApi.get(gmToken)]);
      setRecords(nextRecords); setPages(nextPages); setCalendar(nextCalendar); setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the journal."); }
    finally { setLoading(false); }
  }, [gmToken]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onChanged = () => { void load(); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load]);
  // Persist an in-progress NEW entry so switching Codex tabs mid-compose doesn't silently drop it. While
  // editing an existing entry the composer holds that entry, so the thing worth keeping is the stash.
  useEffect(() => {
    try {
      const pending = stashedDraft ?? (editingId ? null : draft);
      // M11: a downtime draft can be worth keeping with no prose at all — who/activity carry it — so
      // emptiness has to ask about those too, or switching tabs mid-compose would silently drop one.
      const isEmpty = !pending || (!pending.playerText.trim() && !pending.gmText.trim() && !pending.who.trim() && !pending.activity.trim());
      if (isEmpty) sessionStorage.removeItem(DRAFT_KEY); else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(pending));
    } catch { /* private mode - fine */ }
  }, [draft, editingId, stashedDraft]);

  // CI-1 / R1: arriving from a search hit, the destination is prepared — the entry is marked and scrolled
  // to, not merely "the Journal mode, somewhere in a year of entries". Same handled-latch shape as the
  // atlas target and ReplayPanel's `openArchiveId`; the latch clears when the request does, so the same
  // entry can be reached again from a later search.
  const [focusedEntryId, setFocusedEntryId] = useState<string | null>(null);
  const handledEntryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!openEntryId) { handledEntryRef.current = null; return; }
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
      ? { year: Math.trunc(Number(draft.dateYear) || 0), month: Number(draft.dateMonth || 0), day: Math.max(1, Math.trunc(Number(draft.dateDay) || 1)) }
      : null;
    const input = {
      playerText: draft.playerText, gmText: draft.gmText.trim() || null, revealedToPlayers: draft.revealed,
      attachPageId: draft.attachPageId || null,
      sessionNumber: draft.sessionNumber.trim() ? Number(draft.sessionNumber) : null,
      inWorldDate,
      // Always sent, never omitted: on an edit, omitting `tags` would leave the old ones in place, so
      // removing the last tag from an entry has to travel as an explicit empty array.
      tags: draft.tags
    };
    try {
      // `editingId` is asked FIRST and the kind is never consulted on that path. The PATCH route edits
      // an entry's prose, date, session, pin and tags whatever kind the row is; it has no notion of kind
      // at all, which is why the switch is hidden while editing — a record's kind is fixed once written.
      if (editingId) await journalApi.update(gmToken, editingId, input);
      else if (draft.kind === "deadline") {
        // Guarded here as well as by the disabled button: `createDeadline` requires a date, and a
        // rejected create is a worse way to learn that than a button that will not arm.
        if (!inWorldDate) { setError("A deadline needs a date — that is what makes it fire."); return; }
        await journalApi.createDeadline(gmToken, { ...input, inWorldDate });
      } else if (draft.kind === "downtime") {
        // O-3: this creates a RECORD and nothing else. The clock does not move here, and the response's
        // proposed date is not applied — confirming it is a separate action on the row itself.
        await journalApi.createDowntime(gmToken, {
          ...input,
          downtime: {
            who: draft.who.trim().slice(0, DOWNTIME_TEXT_MAX),
            activity: draft.activity.trim().slice(0, DOWNTIME_TEXT_MAX),
            days: Math.min(DOWNTIME_DAYS_MAX, Math.max(0, Math.trunc(Number(draft.days) || 0)))
          }
        });
      } else await journalApi.create(gmToken, input);
      // Finishing an edit hands the composer back to whatever new entry was in progress; finishing a NEW
      // record keeps the composer on the kind it was on, since a GM setting deadlines usually sets several.
      setDraft(editingId ? (stashedDraft ?? EMPTY) : { ...EMPTY, kind: draft.kind }); setStashedDraft(null); setEditingId(null); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not save the entry."); }
  };
  const edit = (record: CodexChronicleRecord) => {
    // Set aside an unsaved NEW entry before the composer is reused, so Edit can never destroy it.
    if (!editingId && (draft.playerText.trim() || draft.gmText.trim() || draft.who.trim() || draft.activity.trim())) setStashedDraft(draft);
    setEditingId(record.id);
    const date = record.inWorldDate; // the raw date the GM typed - correct even if the calendar has since changed
    setDraft({
      // The composer's kind is a NEW-record choice; on the edit path it is never read (see `submit`), so
      // it is parked back on `entry` rather than pretending a deadline's kind can be changed here.
      kind: "entry",
      playerText: record.text, gmText: record.gmText ?? "", sessionNumber: record.sessionNumber?.toString() ?? "",
      dateYear: date ? String(date.year) : "", dateMonth: date ? String(date.month) : "0", dateDay: date ? String(date.day) : "",
      attachPageId: record.attachPageId ?? "", revealed: record.revealedToPlayers, tags: record.tags,
      // A downtime's who/activity/days are not editable in M11 — there is no route that rewrites a
      // payload — so the composer does not pretend to offer them on the edit path.
      who: "", activity: "", days: ""
    });
  };
  /**
   * O-3, the confirmation itself: mark this downtime applied and move the campaign clock by its days, in
   * one server-side transaction. The whole chronicle is re-read afterwards rather than patched from the
   * response, because moving the clock changes what every dated row's "Today" marker and every deadline's
   * fired state say — the clock is not a field on this record, it is the frame the whole timeline hangs in.
   */
  const applyDowntime = async (record: CodexChronicleRecord) => {
    try { await journalApi.applyDowntime(gmToken, record.id); await load(); }
    catch (applyError) { setError(applyError instanceof Error ? applyError.message : "Could not advance the campaign clock."); }
  };
  /** O-1 / D11-H: hand the GM's clock to the table. The only thing on this client that publishes it. */
  const publishDate = async () => {
    try { await calendarApi.publish(gmToken); await load(); }
    catch (publishError) { setError(publishError instanceof Error ? publishError.message : "Could not publish the date."); }
  };
  const cancelEdit = () => { setEditingId(null); setDraft(stashedDraft ?? EMPTY); setStashedDraft(null); };
  /**
   * Reveal from the row, whichever kind it is. Both branches call the record type's OWN reveal route —
   * an event row's switch flips the page's reveal flag, which is the same flag the page editor shows,
   * because there is one reveal state per record and the chronicle is a view of it, not a second copy.
   */
  const reveal = async (record: CodexChronicleRecord, revealed: boolean) => {
    if (record.kind === "event") await codexApi.revealPage(gmToken, record.id, revealed);
    else await journalApi.reveal(gmToken, record.id, revealed);
    await load();
  };
  const remove = async (record: CodexChronicleRecord) => { if (await confirm({ title: "Delete entry", body: "Delete this journal entry? This cannot be undone.", confirmLabel: "Delete", danger: true })) { await journalApi.remove(gmToken, record.id); await load(); } };

  // One vocabulary across the suite: hint with the tags already in use on pages AND on other entries, so
  // the GM reuses "session-recap" instead of inventing a near-duplicate. Free entry stays open (datalist).
  const tagSuggestions = useMemo(() => [...new Set([...pages.flatMap((page) => page.tags), ...records.flatMap((record) => record.tags)])].sort(), [pages, records]);

  // CT-12: the same records, grouped for whichever lens is on. Regrouping only — nothing is refetched and
  // nothing is written, so toggling can never change what the chronicle contains.
  const groups = useMemo(() => groupChronicle(records, lens, calendar), [records, lens, calendar]);

  // The world's "now": a readout + a Today marker placed in its year on the timeline. Since M11 this is
  // explicitly the GM's OWN clock — see the prep-clock row below for what the table is currently on.
  const now = calendar?.currentDate ?? null;
  const nowYear = now && calendar ? calendarYearOf(calendar, dateToInstant(calendar, now)) : null;
  const nowLabel = now && calendar ? formatWorldDate(calendar, now) : null;
  /**
   * O-1, the prep clock. Two values, and this is the only place both are on screen.
   *
   * The quiet state is the normal state: while the two agree there is nothing here at all — no chip, no
   * button, no "in sync" badge — because a GM who has never run ahead of the party should not have to
   * learn a second clock exists. It appears the moment they diverge, which is the moment it matters.
   */
  const publishedLabel = calendar?.publishedDate ? formatWorldDate(calendar, calendar.publishedDate) : null;
  const clockDiverged = calendar !== null && !sameInWorldDate(calendar.currentDate, calendar.publishedDate);
  /** The composer's own preview of what logging this downtime would later propose (O-3, stated up front). */
  const composerProposal = draft.kind === "downtime" && calendar
    ? downtimeProposedDate(calendar, Math.min(DOWNTIME_DAYS_MAX, Math.max(0, Math.trunc(Number(draft.days) || 0))))
    : null;
  const hasText = draft.playerText.trim() !== "" || draft.gmText.trim() !== "";
  /**
   * What each shape needs before it can be written. A deadline needs its date (the store rejects one
   * without it); downtime can stand on its who/activity alone, because the payload IS the record for a
   * downtime that nobody has written prose about yet.
   */
  const canSubmit = editingId || draft.kind === "entry"
    ? hasText
    : draft.kind === "deadline"
    ? hasText && draft.dateYear.trim() !== ""
    : hasText || draft.who.trim() !== "" || draft.activity.trim() !== "";

  return (
    <div className="codex-journal">
      <Panel accent="cyan" className="codex-composer">
        {/* M11: which shape of record this is. Hidden while editing — a record's kind is fixed once it is
            written, and there is no route that changes one. `SegmentedControl` is the `@vtt/ui` primitive
            (R9) and carries its own 44px floor; the labels come from the chronicle's own kind vocabulary. */}
        {!editingId && (
          <div className="codex-composer-kind">
            <SegmentedControl ariaLabel="What to write" value={draft.kind} onChange={(next) => set({ kind: next as ComposerKind })}
              options={COMPOSER_KINDS.map((id) => ({ value: id, label: CHRONICLE_KIND_META[id].label }))} />
          </div>
        )}
        <div className="codex-composer-head">
          <strong>{editingId ? "Edit entry" : COMPOSER_COPY[draft.kind].heading}</strong>
          {editingId && stashedDraft && <span className="codex-entry-when">Your unsaved entry is kept — it returns when you finish here.</span>}
          <div className="codex-composer-head-actions">
            {nowLabel && <span className="codex-now-chip" title="The campaign's current date — set it in the calendar">Now: {nowLabel}</span>}
            <Button variant="ghost" size="sm" onClick={() => setCalendarOpen(true)}>Calendar</Button>
            {editingId && <Button variant="ghost" size="sm" onClick={cancelEdit}>Cancel</Button>}
          </div>
        </div>
        {/* O-1: what the TABLE is currently on, and the one control that changes it. Rendered only while
            the two clocks disagree (see `clockDiverged`). §4: `Button` at its default size is route 1 —
            it grows the paint to 44px and has no `::after` at all — which is what this row needs, sitting
            as it does directly above the composer's own stack of fields. */}
        {clockDiverged && (
          <div className="codex-prepclock">
            <span className="codex-prepclock-label">Players still see</span>
            <span className="codex-now-chip">{publishedLabel ?? "no date yet"}</span>
            <Button variant="primary" onClick={publishDate}>Publish the date</Button>
          </div>
        )}
        <Field label={COMPOSER_COPY[draft.kind].textLabel} htmlFor="j-player"><Textarea id="j-player" className="codex-composer-body" value={draft.playerText} placeholder={COMPOSER_COPY[draft.kind].textPlaceholder} onChange={(event) => set({ playerText: event.target.value })} /></Field>
        <Field label={<span className="codex-composer-gm-label">GM-only notes <GmOnlyTag /></span>} htmlFor="j-gm"><Textarea id="j-gm" className="codex-composer-body codex-gm-block" value={draft.gmText} placeholder="Notes hidden from players…" onChange={(event) => set({ gmText: event.target.value })} /></Field>
        <div className="codex-composer-meta">
          <Field label="Session #" htmlFor="j-session"><Input id="j-session" type="number" inputMode="numeric" value={draft.sessionNumber} onChange={(event) => set({ sessionNumber: event.target.value })} /></Field>
          <Field label="Year" htmlFor="j-year"><Input id="j-year" type="number" inputMode="numeric" value={draft.dateYear} placeholder="1492" onChange={(event) => set({ dateYear: event.target.value })} /></Field>
          <Field label="Month" htmlFor="j-month"><Select id="j-month" value={draft.dateMonth} disabled={!draft.dateYear.trim()} onChange={(event) => set({ dateMonth: event.target.value })}>{(calendar?.months ?? []).map((month, index) => <option key={index} value={String(index)}>{month.name}</option>)}</Select></Field>
          <Field label="Day" htmlFor="j-day"><Input id="j-day" type="number" inputMode="numeric" value={draft.dateDay} placeholder="1" disabled={!draft.dateYear.trim()} onChange={(event) => set({ dateDay: event.target.value })} /></Field>
          <Field label="Pin to page" htmlFor="j-page"><EntityPicker id="j-page" pages={pages} value={draft.attachPageId || null} onChange={(id) => set({ attachPageId: id ?? "" })} ariaLabel="Pin to page" placeholder="— none —" /></Field>
        </div>
        {/* A deadline's date is not optional metadata, it is half the record — so say so where the button
            will not arm, rather than letting the GM discover it as a save failure. */}
        {!editingId && draft.kind === "deadline" && !draft.dateYear.trim() && (
          <p className="codex-composer-hint">A deadline needs a date — that is what makes it fire when the campaign passes it.</p>
        )}
        {/* CT-10's payload. Its own row, sharing the meta row's column rules so the composer keeps one
            grid rather than growing a second layout for three more fields. */}
        {!editingId && draft.kind === "downtime" && (
          <>
            <div className="codex-composer-meta">
              <Field label="Who" htmlFor="j-who"><Input id="j-who" maxLength={DOWNTIME_TEXT_MAX} value={draft.who} placeholder="Aldric" onChange={(event) => set({ who: event.target.value })} /></Field>
              <Field label="Activity" htmlFor="j-activity"><Input id="j-activity" maxLength={DOWNTIME_TEXT_MAX} value={draft.activity} placeholder="Forging a blade" onChange={(event) => set({ activity: event.target.value })} /></Field>
              <Field label="Days" htmlFor="j-days"><Input id="j-days" type="number" inputMode="numeric" min={0} max={DOWNTIME_DAYS_MAX} value={draft.days} placeholder="7" onChange={(event) => set({ days: event.target.value })} /></Field>
            </div>
            {/* O-3 stated BEFORE the record exists, not only after: logging downtime proposes a date and
                changes nothing. Without this the "Confirm" that appears on the row afterwards would be
                the first the GM heard that the clock was involved at all. */}
            {composerProposal && calendar && (
              <p className="codex-composer-hint">Logging this proposes advancing the campaign clock to {formatWorldDate(calendar, composerProposal)} — nothing moves until you confirm it on the record.</p>
            )}
          </>
        )}
        {/* Its own full-width row rather than a cell in .codex-composer-meta: that row's `flex: 1 1 130px`
            columns would squeeze a wrapping chip cloud into a 130px gutter on a phone. The composer is
            also the edit surface, so this one control covers both the new-entry and the edit path. */}
        <Field label="Tags" htmlFor="j-tags">
          <TagInput id="j-tags" ariaLabel="Tags" placeholder="session-recap, downtime" values={draft.tags}
            onChange={(next) => set({ tags: next })}
            max={24} maxReachedReason="An entry may carry at most 24 tags."
            suggestions={tagSuggestions}
            /* DEFAULT slugify on purpose — it IS the server contract (`codex-store.ts` tags():
               /^[a-z0-9][a-z0-9-]*$/, which throws rather than sanitising). Overriding it here would
               let "Session Recap" through as a value the PATCH rejects with a generic save failure. */ />
        </Field>
        <div className="codex-composer-foot">
          {/* O-2 / P2: a deadline and a downtime hide by default exactly as an entry does, and are
              revealed by this same switch. There is no kind-specific visibility anywhere. */}
          <RevealSwitch revealed={draft.revealed} onChange={(revealed) => set({ revealed })} ariaLabel="Show this entry to players" />
          <Button variant="primary" size="sm" disabled={!canSubmit} onClick={submit}>{editingId ? "Save entry" : COMPOSER_COPY[draft.kind].submit}</Button>
        </div>
      </Panel>

      {error && <Alert tone="danger">{error}</Alert>}

      {/* CT-12: the lens toggle. Above the timeline and outside the groups, because it governs all of
          them; `SegmentedControl` is the `@vtt/ui` primitive (R9) and carries its own 44px floor. */}
      <div className="codex-timeline-lens">
        <SegmentedControl ariaLabel="Timeline lens" value={lens} onChange={(next) => setLens(next as ChronicleLens)}
          options={CHRONICLE_LENSES.map((option) => ({ value: option.id, label: option.label }))} />
      </div>

      <div className="codex-timeline">
        {loading && <div className="codex-list-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>}
        {!loading && records.length === 0 && <p className="codex-list-empty">No journal entries yet.</p>}
        {groups.map((group) => {
          /**
           * M9: a session heading opens the session — but ONLY when a session record actually exists
           * for that number, and only under the session lens.
           *
           * Both halves matter. Under the date lens `group.key` is a calendar YEAR, so resolving it as
           * a session number would open session 1492. And M9 ships with **no backfill**, so most
           * numbered groups on an existing campaign have no record behind them: those must keep
           * rendering exactly as they render today rather than becoming buttons that 404. The heading
           * is only promoted to a control when there is something real on the other end of it.
           */
          const groupSession = lens === "session" && group.key !== "none" && onOpenSession
            ? sessionByNumber(sessions, Number(group.key))
            : null;
          return (
          <section key={group.key} className="codex-timeline-group">
            {groupSession
              /* §4 route 1 (grow the paint) — see `.codex-timeline-year.is-openable` in codex.css. */
              ? <button type="button" className="codex-timeline-year is-openable" onClick={() => onOpenSession!(groupSession.id)}>
                  {group.label}<span className="codex-timeline-year-open" aria-hidden="true">›</span>
                </button>
              : <div className="codex-timeline-year">{group.label}</div>}
            {/* The "Today" marker belongs to the in-world reading; under the session lens a calendar year
                is not what the groups mean, so placing it there would be an answer to a question nobody asked. */}
            {lens === "date" && nowYear !== null && group.key === String(nowYear) && <div className="codex-timeline-now">Today — {nowLabel}</div>}
            {group.records.map((record) => {
              // R2: ONE row shape for every record; the kind reads by icon + label, never by colour alone.
              const meta = CHRONICLE_KIND_META[record.kind];
              const isEvent = record.kind === "event";
              // M11: `fired` is the SERVER's derivation, read through the one client-side reader; the
              // payload is present only on a downtime. A record that is neither answers null/false and
              // renders exactly as it did before this milestone.
              const isDeadline = record.kind === "deadline";
              const fired = deadlineFired(record);
              const downtime = record.kind === "downtime" ? record.payload : null;
              const proposed = downtime && !downtime.applied ? downtimeProposedDate(calendar, downtime.days) : null;
              return (
              <article key={`${record.kind}-${record.id}`} id={`codex-entry-${record.id}`} aria-current={record.id === focusedEntryId ? "true" : undefined}
                className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${isEvent ? " is-event" : ""}${isDeadline ? " is-deadline" : ""}${downtime ? " is-downtime" : ""}${record.id === focusedEntryId ? " is-focused" : ""}`}>
                <header className="codex-entry-head">
                  <div className="codex-entry-meta">
                    <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {/* CT-5: a deadline's state is a WORD beside its kind, never the row's colour — the
                        badge tone is a scanning aid and nothing is said by it alone. */}
                    {isDeadline && <Badge tone={deadlineStateTone(fired)}>{deadlineStateLabel(fired)}</Badge>}
                    <span className="codex-entry-when">{chronicleWhenLabel(record)}</span>
                    {record.sessionNumber !== null && <span className="codex-entry-when">Session {record.sessionNumber}</span>}
                  </div>
                  <RevealSwitch revealed={record.revealedToPlayers} onChange={(revealed) => reveal(record, revealed)} ariaLabel={isEvent ? "Show this event to players" : "Show this entry to players"} />
                </header>
                {/* An event page has a name; a journal entry does not. Same slot either way, so the row
                    shape does not change - it is simply empty for the kind that has nothing to put in it. */}
                {record.title && <h4 className="codex-entry-title">{record.title}</h4>}
                {record.text.trim() && <div className="codex-entry-body"><CodexMarkdown text={record.text} token={gmToken} onNavigate={(target) => { const page = pages.find((candidate) => candidate.title.toLowerCase() === target.toLowerCase()); if (page) onOpenPage(page.id); }} /></div>}
                {record.gmText && <div className="codex-entry-gm"><GmOnlyTag /><CodexMarkdown text={record.gmText} token={gmToken} /></div>}
                {/* Read-only on purpose. An entry's tags are otherwise invisible until you open Edit, but
                    making them clickable would be the cross-type tag navigation that belongs to a later
                    milestone — clicking a tag still filters Pages and nothing else. */}
                {record.tags.length > 0 && (
                  <ul className="codex-entry-tags" aria-label="Entry tags">
                    {record.tags.map((tag) => <li key={tag}><Badge>{tag}</Badge></li>)}
                  </ul>
                )}
                {/* CT-10 / O-3: what this downtime was, and — until the GM confirms it — what confirming
                    would do, said in full BEFORE the button that does it. The button is deliberately the
                    only thing on this row that moves the campaign clock, and it exists only while the
                    record is unapplied: an applied downtime has no second confirmation to give. */}
                {downtime && (
                  <div className="codex-downtime">
                    <p className="codex-downtime-what">{downtimeSummaryLabel(downtime)}</p>
                    {downtime.applied
                      ? <p className="codex-downtime-state">The campaign clock has already been advanced for this downtime.</p>
                      : proposed && calendar
                      ? <div className="codex-downtime-apply">
                          <span className="codex-downtime-proposal">Advance the campaign clock to {formatWorldDate(calendar, proposed)}</span>
                          {/* §4 route 1: `Button` at its default size grows its own paint to 44px and
                              has no `::after`, which is what a control stacked above the row's footer
                              buttons needs — a route-2 overhang here would reach into their hit areas. */}
                          <Button variant="primary" onClick={() => applyDowntime(record)}>Confirm</Button>
                        </div>
                      : <p className="codex-downtime-state">Set the campaign's current date in the calendar to advance the clock from this downtime.</p>}
                  </div>
                )}
                {/* CI-6: the entry's two return edges sit beside the page edge it already had, so an
                    entry reads as "here is what happened, here is where, here is the fight itself".
                    §4: `Button size="sm"` is a `@vtt/ui` primitive and carries the 44px floor itself
                    (route 2, `.nh-btn--sm`) — no new control and no new floor to argue about.
                    An EVENT row's actions are deliberately just "Open page": the record is a wiki page,
                    and editing or deleting it from a timeline row would be a second place to do both. */}
                <footer className="codex-entry-foot">
                  {isEvent && <Button variant="ghost" size="sm" onClick={() => onOpenPage(record.id)}>Open page</Button>}
                  {!isEvent && record.attachPageId && <Button variant="ghost" size="sm" onClick={() => onOpenPage(record.attachPageId!)}>Open page</Button>}
                  {record.attachMarkerId && onOpenMarker &&
                    <Button variant="ghost" size="sm" onClick={() => onOpenMarker(record.attachMarkerId!)}>Open marker</Button>}
                  {record.kind === "combat" && record.sourceEncounterId !== null && onOpenReplay &&
                    <Button variant="ghost" size="sm" onClick={() => onOpenReplay(record.sourceEncounterId!)}>Open replay</Button>}
                  {!isEvent && <Button variant="ghost" size="sm" onClick={() => edit(record)}>Edit</Button>}
                  {!isEvent && <Button variant="ghost" size="sm" onClick={() => remove(record)}>Delete</Button>}
                </footer>
              </article>
              );
            })}
          </section>
          );
        })}
      </div>

      {/* The editor answers with the calendar the PUT echoed, which carries the world's shape and the
          GM's clock but says nothing about what the table is on — so the whole GM read is taken again
          rather than trusted, or moving the clock here would leave the prep-clock row above stale. */}
      {calendarOpen && calendar && <CalendarEditor gmToken={gmToken} calendar={calendar} onSaved={() => { void load(); }} onClose={() => setCalendarOpen(false)} />}
      {confirmDialog}
    </div>
  );
}
