import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Input, Panel, Select, Textarea } from "@vtt/ui";
import { socket } from "../socket";
import { calendarApi, calendarYearOf, codexApi, dateToInstant, formatWorldYear, journalApi, type CodexCalendar, type CodexInWorldDate, type CodexJournalEntry, type CodexPageSummary } from "./api";
import { CodexMarkdown } from "./CodexMarkdown";
import { CalendarEditor } from "./CalendarEditor";
import { EntityPicker } from "./EntityPicker";
import { RevealSwitch, GmOnlyTag } from "./SecretMarkers";
import { useConfirm } from "../components/feedback";

/** A raw in-world date rendered as "Month Day, Year Era" (client-side; the server stores the same shape). */
function formatWorldDate(calendar: CodexCalendar, date: CodexInWorldDate): string {
  const month = calendar.months[Math.max(0, Math.min(date.month, calendar.months.length - 1))];
  return `${month?.name ?? ""} ${date.day}, ${formatWorldYear(calendar, date.year)}`;
}

/**
 * The campaign journal + chronicle: GM-written two-layer entries placed on the world's own calendar.
 * A structured in-world date sorts the timeline chronologically and groups it by year; entries can also
 * carry a session #, be pinned to a page, and reveal to players. Logged encounters auto-post here.
 */
type Draft = { playerText: string; gmText: string; sessionNumber: string; dateYear: string; dateMonth: string; dateDay: string; attachPageId: string; revealed: boolean };
const EMPTY: Draft = { playerText: "", gmText: "", sessionNumber: "", dateYear: "", dateMonth: "0", dateDay: "", attachPageId: "", revealed: false };
const DRAFT_KEY = "codex-journal-draft";

function whenLabel(entry: CodexJournalEntry): string {
  if (entry.inWorldLabel) return entry.inWorldLabel;
  if (entry.sessionNumber !== null) return `Session ${entry.sessionNumber}`;
  if (entry.realDate) return entry.realDate;
  return new Date(entry.createdAt).toLocaleDateString();
}

export function JournalView({ gmToken, onOpenPage }: Readonly<{ gmToken: string; onOpenPage: (pageId: string) => void }>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [entries, setEntries] = useState<CodexJournalEntry[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [calendar, setCalendar] = useState<CodexCalendar | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => { try { const saved = sessionStorage.getItem(DRAFT_KEY); return saved ? { ...EMPTY, ...JSON.parse(saved) } : EMPTY; } catch { return EMPTY; } });
  const [editingId, setEditingId] = useState<string | null>(null);
  // An in-progress NEW entry, set aside while the composer is borrowed to edit an existing one. Without
  // this, clicking Edit overwrote the draft AND (via the effect below) deleted its sessionStorage backup.
  const [stashedDraft, setStashedDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextEntries, nextPages, nextCalendar] = await Promise.all([journalApi.timeline(gmToken), codexApi.listPages(gmToken), calendarApi.get(gmToken)]);
      setEntries(nextEntries); setPages(nextPages); setCalendar(nextCalendar); setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the journal."); }
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

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const submit = async () => {
    const inWorldDate = draft.dateYear.trim()
      ? { year: Math.trunc(Number(draft.dateYear) || 0), month: Number(draft.dateMonth || 0), day: Math.max(1, Math.trunc(Number(draft.dateDay) || 1)) }
      : null;
    const input = {
      playerText: draft.playerText, gmText: draft.gmText.trim() || null, revealedToPlayers: draft.revealed,
      attachPageId: draft.attachPageId || null,
      sessionNumber: draft.sessionNumber.trim() ? Number(draft.sessionNumber) : null,
      inWorldDate
    };
    try {
      if (editingId) await journalApi.update(gmToken, editingId, input); else await journalApi.create(gmToken, input);
      // Finishing an edit hands the composer back to whatever new entry was in progress.
      setDraft(editingId ? (stashedDraft ?? EMPTY) : EMPTY); setStashedDraft(null); setEditingId(null); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not save the entry."); }
  };
  const edit = (entry: CodexJournalEntry) => {
    // Set aside an unsaved NEW entry before the composer is reused, so Edit can never destroy it.
    if (!editingId && (draft.playerText.trim() || draft.gmText.trim())) setStashedDraft(draft);
    setEditingId(entry.id);
    const date = entry.inWorldDate; // the raw date the GM typed - correct even if the calendar has since changed
    setDraft({
      playerText: entry.playerText, gmText: entry.gmText ?? "", sessionNumber: entry.sessionNumber?.toString() ?? "",
      dateYear: date ? String(date.year) : "", dateMonth: date ? String(date.month) : "0", dateDay: date ? String(date.day) : "",
      attachPageId: entry.attachPageId ?? "", revealed: entry.revealedToPlayers
    });
  };
  const cancelEdit = () => { setEditingId(null); setDraft(stashedDraft ?? EMPTY); setStashedDraft(null); };
  const reveal = async (entry: CodexJournalEntry, revealed: boolean) => { await journalApi.reveal(gmToken, entry.id, revealed); await load(); };
  const remove = async (entry: CodexJournalEntry) => { if (await confirm({ title: "Delete entry", body: "Delete this journal entry? This cannot be undone.", confirmLabel: "Delete", danger: true })) { await journalApi.remove(gmToken, entry.id); await load(); } };

  // Group the timeline by in-world year (dated years ascending, undated last).
  const groups = useMemo(() => {
    const byYear = new Map<number | null, CodexJournalEntry[]>();
    for (const entry of entries) {
      const year = entry.calendarInstant !== null && calendar ? calendarYearOf(calendar, entry.calendarInstant) : null;
      const bucket = byYear.get(year) ?? [];
      bucket.push(entry);
      byYear.set(year, bucket);
    }
    return [...byYear.keys()]
      .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
      .map((year) => ({ key: year === null ? "undated" : String(year), label: year === null ? "Undated" : (calendar ? formatWorldYear(calendar, year) : String(year)), entries: byYear.get(year)! }));
  }, [entries, calendar]);

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
        <div className="codex-composer-foot">
          <RevealSwitch revealed={draft.revealed} onChange={(revealed) => set({ revealed })} ariaLabel="Show this entry to players" />
          <Button variant="primary" size="sm" disabled={!draft.playerText.trim() && !draft.gmText.trim()} onClick={submit}>{editingId ? "Save entry" : "Add entry"}</Button>
        </div>
      </Panel>

      {error && <p className="codex-rail-error" role="alert">{error}</p>}

      <div className="codex-timeline">
        {entries.length === 0 && <p className="codex-list-empty">No journal entries yet.</p>}
        {groups.map((group) => (
          <section key={group.key} className="codex-timeline-group">
            <div className="codex-timeline-year">{group.label}</div>
            {nowYear !== null && group.key === String(nowYear) && <div className="codex-timeline-now">Today — {nowLabel}</div>}
            {group.entries.map((entry) => (
              <article key={entry.id} className={`codex-entry${entry.kind === "combat" ? " is-combat" : ""}`}>
                <header className="codex-entry-head">
                  <div className="codex-entry-meta">
                    <Badge tone={entry.kind === "combat" ? "caution" : "neutral"}>{entry.kind === "combat" ? "Battle" : whenLabel(entry)}</Badge>
                    {entry.kind === "combat" && <span className="codex-entry-when">{whenLabel(entry)}</span>}
                    {entry.sessionNumber !== null && <span className="codex-entry-when">Session {entry.sessionNumber}</span>}
                  </div>
                  <RevealSwitch revealed={entry.revealedToPlayers} onChange={(revealed) => reveal(entry, revealed)} ariaLabel="Show this entry to players" />
                </header>
                {entry.playerText.trim() && <div className="codex-entry-body"><CodexMarkdown text={entry.playerText} token={gmToken} onNavigate={(target) => { const page = pages.find((candidate) => candidate.title.toLowerCase() === target.toLowerCase()); if (page) onOpenPage(page.id); }} /></div>}
                {entry.gmText && <div className="codex-entry-gm"><GmOnlyTag /><CodexMarkdown text={entry.gmText} token={gmToken} /></div>}
                <footer className="codex-entry-foot">
                  {entry.attachPageId && <Button variant="ghost" size="sm" onClick={() => onOpenPage(entry.attachPageId!)}>Open page</Button>}
                  <Button variant="ghost" size="sm" onClick={() => edit(entry)}>Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(entry)}>Delete</Button>
                </footer>
              </article>
            ))}
          </section>
        ))}
      </div>

      {calendarOpen && calendar && <CalendarEditor gmToken={gmToken} calendar={calendar} onSaved={setCalendar} onClose={() => setCalendarOpen(false)} />}
      {confirmDialog}
    </div>
  );
}
