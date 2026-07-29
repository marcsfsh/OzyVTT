import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Field, Input, Panel, SegmentedControl, Select, Skeleton, TagInput, Textarea } from "@vtt/ui";
import { socket } from "../socket";
import { calendarApi, calendarYearOf, codexApi, dateToInstant, formatWorldDate, journalApi, type CodexCalendar, type CodexChronicleRecord, type CodexPageSummary } from "./api";
import { CHRONICLE_KIND_META, CHRONICLE_LENSES, chronicleWhenLabel, groupChronicle, type ChronicleLens } from "./chronicle";
import { CodexIcon } from "./icons";
import { CodexMarkdown } from "./CodexMarkdown";
import { CalendarEditor } from "./CalendarEditor";
import { EntityPicker } from "./EntityPicker";
import { RevealSwitch, GmOnlyTag } from "./SecretMarkers";
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
type Draft = { playerText: string; gmText: string; sessionNumber: string; dateYear: string; dateMonth: string; dateDay: string; attachPageId: string; revealed: boolean; tags: readonly string[] };
const EMPTY: Draft = { playerText: "", gmText: "", sessionNumber: "", dateYear: "", dateMonth: "0", dateDay: "", attachPageId: "", revealed: false, tags: [] };
const DRAFT_KEY = "codex-journal-draft";
const LENS_KEY = "codex-chronicle-lens";

/**
 * CI-6 (return edge): an entry knows where it happened (`attachMarkerId`, set by the combat bridge when
 * a battle is logged at a pin) and which encounter produced it (`sourceEncounterId`). Both jumps are
 * owned by surfaces above this one — the Atlas for the pin, the replay panel for the fight — so the
 * journal hands the id up rather than reaching sideways into either. `onOpenReplay` is the SAME prop
 * `PageTimeline` already takes, threaded from the same place, so there is one replay path and not two.
 */
export function JournalView({ gmToken, onOpenPage, onOpenMarker, onOpenReplay, openEntryId = null, onOpenedEntry = () => {} }: Readonly<{ gmToken: string; onOpenPage: (pageId: string) => void; onOpenMarker?: (markerId: string) => void; onOpenReplay?: (archiveId: number) => void; openEntryId?: string | null; onOpenedEntry?: () => void }>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [records, setRecords] = useState<CodexChronicleRecord[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [calendar, setCalendar] = useState<CodexCalendar | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // A draft saved before CI-2 has no `tags` key, so EMPTY supplies one; the Array guard also stops a
  // corrupt value reaching TagInput, which maps over it.
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = sessionStorage.getItem(DRAFT_KEY);
      if (!saved) return EMPTY;
      const parsed = JSON.parse(saved) as Partial<Draft>;
      return { ...EMPTY, ...parsed, tags: Array.isArray(parsed.tags) ? parsed.tags : [] };
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
      const isEmpty = !pending || (!pending.playerText.trim() && !pending.gmText.trim());
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
      if (editingId) await journalApi.update(gmToken, editingId, input); else await journalApi.create(gmToken, input);
      // Finishing an edit hands the composer back to whatever new entry was in progress.
      setDraft(editingId ? (stashedDraft ?? EMPTY) : EMPTY); setStashedDraft(null); setEditingId(null); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not save the entry."); }
  };
  const edit = (record: CodexChronicleRecord) => {
    // Set aside an unsaved NEW entry before the composer is reused, so Edit can never destroy it.
    if (!editingId && (draft.playerText.trim() || draft.gmText.trim())) setStashedDraft(draft);
    setEditingId(record.id);
    const date = record.inWorldDate; // the raw date the GM typed - correct even if the calendar has since changed
    setDraft({
      playerText: record.text, gmText: record.gmText ?? "", sessionNumber: record.sessionNumber?.toString() ?? "",
      dateYear: date ? String(date.year) : "", dateMonth: date ? String(date.month) : "0", dateDay: date ? String(date.day) : "",
      attachPageId: record.attachPageId ?? "", revealed: record.revealedToPlayers, tags: record.tags
    });
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

  // The world's "now": a readout + a Today marker placed in its year on the timeline.
  const now = calendar?.currentDate ?? null;
  const nowYear = now && calendar ? calendarYearOf(calendar, dateToInstant(calendar, now)) : null;
  const nowLabel = now && calendar ? formatWorldDate(calendar, now) : null;

  return (
    <div className="codex-journal">
      <Panel accent="cyan" className="codex-composer">
        <div className="codex-composer-head">
          <strong>{editingId ? "Edit entry" : "New journal entry"}</strong>
          {editingId && stashedDraft && <span className="codex-entry-when">Your unsaved entry is kept — it returns when you finish here.</span>}
          <div className="codex-composer-head-actions">
            {nowLabel && <span className="codex-now-chip" title="The world's current date — set it in the calendar">Now: {nowLabel}</span>}
            <Button variant="ghost" size="sm" onClick={() => setCalendarOpen(true)}>Calendar</Button>
            {editingId && <Button variant="ghost" size="sm" onClick={cancelEdit}>Cancel</Button>}
          </div>
        </div>
        <Field label="Player-facing summary" htmlFor="j-player"><Textarea id="j-player" className="codex-composer-body" value={draft.playerText} placeholder="What the party knows about this…" onChange={(event) => set({ playerText: event.target.value })} /></Field>
        <Field label={<span className="codex-composer-gm-label">GM-only notes <GmOnlyTag /></span>} htmlFor="j-gm"><Textarea id="j-gm" className="codex-composer-body codex-gm-block" value={draft.gmText} placeholder="Notes hidden from players…" onChange={(event) => set({ gmText: event.target.value })} /></Field>
        <div className="codex-composer-meta">
          <Field label="Session #" htmlFor="j-session"><Input id="j-session" type="number" inputMode="numeric" value={draft.sessionNumber} onChange={(event) => set({ sessionNumber: event.target.value })} /></Field>
          <Field label="Year" htmlFor="j-year"><Input id="j-year" type="number" inputMode="numeric" value={draft.dateYear} placeholder="1492" onChange={(event) => set({ dateYear: event.target.value })} /></Field>
          <Field label="Month" htmlFor="j-month"><Select id="j-month" value={draft.dateMonth} disabled={!draft.dateYear.trim()} onChange={(event) => set({ dateMonth: event.target.value })}>{(calendar?.months ?? []).map((month, index) => <option key={index} value={String(index)}>{month.name}</option>)}</Select></Field>
          <Field label="Day" htmlFor="j-day"><Input id="j-day" type="number" inputMode="numeric" value={draft.dateDay} placeholder="1" disabled={!draft.dateYear.trim()} onChange={(event) => set({ dateDay: event.target.value })} /></Field>
          <Field label="Pin to page" htmlFor="j-page"><EntityPicker id="j-page" pages={pages} value={draft.attachPageId || null} onChange={(id) => set({ attachPageId: id ?? "" })} ariaLabel="Pin to page" placeholder="— none —" /></Field>
        </div>
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
          <RevealSwitch revealed={draft.revealed} onChange={(revealed) => set({ revealed })} ariaLabel="Show this entry to players" />
          <Button variant="primary" size="sm" disabled={!draft.playerText.trim() && !draft.gmText.trim()} onClick={submit}>{editingId ? "Save entry" : "Add entry"}</Button>
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
        {groups.map((group) => (
          <section key={group.key} className="codex-timeline-group">
            <div className="codex-timeline-year">{group.label}</div>
            {/* The "Today" marker belongs to the in-world reading; under the session lens a calendar year
                is not what the groups mean, so placing it there would be an answer to a question nobody asked. */}
            {lens === "date" && nowYear !== null && group.key === String(nowYear) && <div className="codex-timeline-now">Today — {nowLabel}</div>}
            {group.records.map((record) => {
              // R2: ONE row shape for every record; the kind reads by icon + label, never by colour alone.
              const meta = CHRONICLE_KIND_META[record.kind];
              const isEvent = record.kind === "event";
              return (
              <article key={`${record.kind}-${record.id}`} id={`codex-entry-${record.id}`} aria-current={record.id === focusedEntryId ? "true" : undefined}
                className={`codex-entry${record.kind === "combat" ? " is-combat" : ""}${isEvent ? " is-event" : ""}${record.id === focusedEntryId ? " is-focused" : ""}`}>
                <header className="codex-entry-head">
                  <div className="codex-entry-meta">
                    <CodexIcon iconId={meta.iconId} className="codex-ent-icon codex-entry-kindglyph" />
                    <Badge tone={meta.tone}>{meta.label}</Badge>
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
        ))}
      </div>

      {calendarOpen && calendar && <CalendarEditor gmToken={gmToken} calendar={calendar} onSaved={setCalendar} onClose={() => setCalendarOpen(false)} />}
      {confirmDialog}
    </div>
  );
}
