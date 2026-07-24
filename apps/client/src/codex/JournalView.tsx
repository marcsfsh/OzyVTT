import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Input, Panel, Select, Switch, Textarea } from "@vtt/ui";
import { socket } from "../socket";
import { calendarApi, calendarYearOf, codexApi, formatWorldYear, instantToDate, journalApi, type CodexCalendar, type CodexJournalEntry, type CodexPageSummary } from "./api";
import { CodexMarkdown } from "./CodexMarkdown";
import { CalendarEditor } from "./CalendarEditor";

/**
 * The campaign journal + chronicle: GM-written two-layer entries placed on the world's own calendar.
 * A structured in-world date sorts the timeline chronologically and groups it by year; entries can also
 * carry a session #, be pinned to a page, and reveal to players. Logged encounters auto-post here.
 */
type Draft = { playerText: string; gmText: string; sessionNumber: string; dateYear: string; dateMonth: string; dateDay: string; attachPageId: string; revealed: boolean };
const EMPTY: Draft = { playerText: "", gmText: "", sessionNumber: "", dateYear: "", dateMonth: "0", dateDay: "", attachPageId: "", revealed: false };

function whenLabel(entry: CodexJournalEntry): string {
  if (entry.inWorldLabel) return entry.inWorldLabel;
  if (entry.sessionNumber !== null) return `Session ${entry.sessionNumber}`;
  if (entry.realDate) return entry.realDate;
  return new Date(entry.createdAt).toLocaleDateString();
}

export function JournalView({ gmToken, onOpenPage }: Readonly<{ gmToken: string; onOpenPage: (pageId: string) => void }>) {
  const [entries, setEntries] = useState<CodexJournalEntry[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [calendar, setCalendar] = useState<CodexCalendar | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextEntries, nextPages, nextCalendar] = await Promise.all([journalApi.timeline(gmToken), codexApi.listPages(gmToken), calendarApi.get(gmToken)]);
      setEntries(nextEntries); setPages(nextPages); setCalendar(nextCalendar); setError(null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the journal."); }
  }, [gmToken]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onChanged = () => { void load(); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load]);

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
      setDraft(EMPTY); setEditingId(null); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not save the entry."); }
  };
  const edit = (entry: CodexJournalEntry) => {
    setEditingId(entry.id);
    const date = entry.calendarInstant !== null && calendar ? instantToDate(calendar, entry.calendarInstant) : null;
    setDraft({
      playerText: entry.playerText, gmText: entry.gmText ?? "", sessionNumber: entry.sessionNumber?.toString() ?? "",
      dateYear: date ? String(date.year) : "", dateMonth: date ? String(date.month) : "0", dateDay: date ? String(date.day) : "",
      attachPageId: entry.attachPageId ?? "", revealed: entry.revealedToPlayers
    });
  };
  const reveal = async (entry: CodexJournalEntry, revealed: boolean) => { await journalApi.reveal(gmToken, entry.id, revealed); await load(); };
  const remove = async (entry: CodexJournalEntry) => { if (confirm("Delete this entry?")) { await journalApi.remove(gmToken, entry.id); await load(); } };

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

  return (
    <div className="codex-journal">
      <Panel accent="cyan" className="codex-composer">
        <div className="codex-composer-head">
          <strong>{editingId ? "Edit entry" : "New journal entry"}</strong>
          <div className="codex-composer-head-actions">
            <Button variant="ghost" size="sm" onClick={() => setCalendarOpen(true)}>📅 Calendar</Button>
            {editingId && <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Cancel</Button>}
          </div>
        </div>
        <Field label="What the players know" htmlFor="j-player"><Textarea id="j-player" className="codex-composer-body" value={draft.playerText} placeholder="What happened, as the party would recall it…" onChange={(event) => set({ playerText: event.target.value })} /></Field>
        <Field label="GM-only notes" htmlFor="j-gm"><Textarea id="j-gm" className="codex-composer-body" value={draft.gmText} placeholder="The truth behind it…" onChange={(event) => set({ gmText: event.target.value })} /></Field>
        <div className="codex-composer-meta">
          <Field label="Session #" htmlFor="j-session"><Input id="j-session" type="number" inputMode="numeric" value={draft.sessionNumber} onChange={(event) => set({ sessionNumber: event.target.value })} /></Field>
          <Field label="Year" htmlFor="j-year"><Input id="j-year" type="number" inputMode="numeric" value={draft.dateYear} placeholder="1492" onChange={(event) => set({ dateYear: event.target.value })} /></Field>
          <Field label="Month" htmlFor="j-month"><Select id="j-month" value={draft.dateMonth} disabled={!draft.dateYear.trim()} onChange={(event) => set({ dateMonth: event.target.value })}>{(calendar?.months ?? []).map((month, index) => <option key={index} value={String(index)}>{month.name}</option>)}</Select></Field>
          <Field label="Day" htmlFor="j-day"><Input id="j-day" type="number" inputMode="numeric" value={draft.dateDay} placeholder="1" disabled={!draft.dateYear.trim()} onChange={(event) => set({ dateDay: event.target.value })} /></Field>
          <Field label="Pin to page" htmlFor="j-page"><Select id="j-page" value={draft.attachPageId} onChange={(event) => set({ attachPageId: event.target.value })}><option value="">— none —</option>{pages.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}</Select></Field>
        </div>
        <div className="codex-composer-foot">
          <Switch checked={draft.revealed} onChange={(revealed) => set({ revealed })} label={draft.revealed ? "Shown to players" : "GM only"} />
          <Button variant="primary" size="sm" disabled={!draft.playerText.trim() && !draft.gmText.trim()} onClick={submit}>{editingId ? "Save entry" : "Add entry"}</Button>
        </div>
      </Panel>

      {error && <p className="codex-rail-error" role="alert">{error}</p>}

      <div className="codex-timeline">
        {entries.length === 0 && <p className="codex-list-empty">No entries yet. Record your first session above.</p>}
        {groups.map((group) => (
          <section key={group.key} className="codex-timeline-group">
            <div className="codex-timeline-year">{group.label}</div>
            {group.entries.map((entry) => (
              <article key={entry.id} className={`codex-entry${entry.kind === "combat" ? " is-combat" : ""}`}>
                <header className="codex-entry-head">
                  <div className="codex-entry-meta">
                    <Badge tone={entry.kind === "combat" ? "caution" : "neutral"}>{entry.kind === "combat" ? "Battle" : whenLabel(entry)}</Badge>
                    {entry.kind === "combat" && <span className="codex-entry-when">{whenLabel(entry)}</span>}
                    {entry.sessionNumber !== null && <span className="codex-entry-when">Session {entry.sessionNumber}</span>}
                  </div>
                  <Switch checked={entry.revealedToPlayers} onChange={(revealed) => reveal(entry, revealed)} aria-label="Reveal to players" label={entry.revealedToPlayers ? "Shown" : "Secret"} />
                </header>
                {entry.playerText.trim() && <div className="codex-entry-body"><CodexMarkdown text={entry.playerText} token={gmToken} onNavigate={(target) => { const page = pages.find((candidate) => candidate.title.toLowerCase() === target.toLowerCase()); if (page) onOpenPage(page.id); }} /></div>}
                {entry.gmText && <div className="codex-entry-gm"><span className="codex-entry-gm-tag">GM</span><CodexMarkdown text={entry.gmText} token={gmToken} /></div>}
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
    </div>
  );
}
