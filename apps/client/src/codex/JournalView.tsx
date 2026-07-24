import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Field, Input, Panel, Select, Switch, Textarea } from "@vtt/ui";
import { socket } from "../socket";
import { codexApi, journalApi, type CodexJournalEntry, type CodexPageSummary } from "./api";
import { CodexMarkdown } from "./CodexMarkdown";

/**
 * The campaign journal: a chronological timeline of GM-written, two-layer entries (player-facing +
 * GM-secret), each optionally dated (session #, real date, in-world label) and pinned to a page. Logged
 * encounters auto-post here via the server's combat-history bridge. Reveal an entry to surface it on the
 * player timeline. Ordered by in-world instant (later), then session number, then time.
 */
type Draft = { playerText: string; gmText: string; sessionNumber: string; realDate: string; inWorldLabel: string; attachPageId: string; revealed: boolean };
const EMPTY: Draft = { playerText: "", gmText: "", sessionNumber: "", realDate: "", inWorldLabel: "", attachPageId: "", revealed: false };

function whenLabel(entry: CodexJournalEntry): string {
  if (entry.inWorldLabel) return entry.inWorldLabel;
  if (entry.sessionNumber !== null) return `Session ${entry.sessionNumber}`;
  if (entry.realDate) return entry.realDate;
  return new Date(entry.createdAt).toLocaleDateString();
}

export function JournalView({ gmToken, onOpenPage }: Readonly<{ gmToken: string; onOpenPage: (pageId: string) => void }>) {
  const [entries, setEntries] = useState<CodexJournalEntry[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { const [nextEntries, nextPages] = await Promise.all([journalApi.timeline(gmToken), codexApi.listPages(gmToken)]); setEntries(nextEntries); setPages(nextPages); setError(null); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the journal."); }
  }, [gmToken]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const onChanged = () => { void load(); }; socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load]);

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const submit = async () => {
    const input = {
      playerText: draft.playerText, gmText: draft.gmText.trim() || null, revealedToPlayers: draft.revealed,
      attachPageId: draft.attachPageId || null,
      sessionNumber: draft.sessionNumber.trim() ? Number(draft.sessionNumber) : null,
      realDate: draft.realDate.trim() || null, inWorldLabel: draft.inWorldLabel.trim() || null
    };
    try {
      if (editingId) await journalApi.update(gmToken, editingId, input); else await journalApi.create(gmToken, input);
      setDraft(EMPTY); setEditingId(null); await load();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Could not save the entry."); }
  };
  const edit = (entry: CodexJournalEntry) => {
    setEditingId(entry.id);
    setDraft({ playerText: entry.playerText, gmText: entry.gmText ?? "", sessionNumber: entry.sessionNumber?.toString() ?? "", realDate: entry.realDate ?? "", inWorldLabel: entry.inWorldLabel ?? "", attachPageId: entry.attachPageId ?? "", revealed: entry.revealedToPlayers });
  };
  const reveal = async (entry: CodexJournalEntry, revealed: boolean) => { await journalApi.reveal(gmToken, entry.id, revealed); await load(); };
  const remove = async (entry: CodexJournalEntry) => { if (confirm("Delete this entry?")) { await journalApi.remove(gmToken, entry.id); await load(); } };

  return (
    <div className="codex-journal">
      <Panel accent="cyan" className="codex-composer">
        <div className="codex-composer-head"><strong>{editingId ? "Edit entry" : "New journal entry"}</strong>{editingId && <Button variant="ghost" size="sm" onClick={() => { setEditingId(null); setDraft(EMPTY); }}>Cancel</Button>}</div>
        <Field label="What the players know" htmlFor="j-player"><Textarea id="j-player" className="codex-composer-body" value={draft.playerText} placeholder="What happened, as the party would recall it…" onChange={(event) => set({ playerText: event.target.value })} /></Field>
        <Field label="GM-only notes" htmlFor="j-gm"><Textarea id="j-gm" className="codex-composer-body" value={draft.gmText} placeholder="The truth behind it…" onChange={(event) => set({ gmText: event.target.value })} /></Field>
        <div className="codex-composer-meta">
          <Field label="Session #" htmlFor="j-session"><Input id="j-session" type="number" inputMode="numeric" value={draft.sessionNumber} onChange={(event) => set({ sessionNumber: event.target.value })} /></Field>
          <Field label="In-world date" htmlFor="j-world"><Input id="j-world" value={draft.inWorldLabel} placeholder="3rd of Flamerule" onChange={(event) => set({ inWorldLabel: event.target.value })} /></Field>
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
        {entries.map((entry) => (
          <article key={entry.id} className={`codex-entry${entry.kind === "combat" ? " is-combat" : ""}`}>
            <header className="codex-entry-head">
              <div className="codex-entry-meta">
                <Badge tone={entry.kind === "combat" ? "caution" : "neutral"}>{entry.kind === "combat" ? "Battle" : whenLabel(entry)}</Badge>
                {entry.kind === "combat" && <span className="codex-entry-when">{whenLabel(entry)}</span>}
              </div>
              <Switch checked={entry.revealedToPlayers} onChange={(revealed) => reveal(entry, revealed)} aria-label="Reveal to players" label={entry.revealedToPlayers ? "Shown" : "Secret"} />
            </header>
            {entry.playerText.trim() && <div className="codex-entry-body"><CodexMarkdown text={entry.playerText} onNavigate={(target) => { const page = pages.find((candidate) => candidate.title.toLowerCase() === target.toLowerCase()); if (page) onOpenPage(page.id); }} /></div>}
            {entry.gmText && <div className="codex-entry-gm"><span className="codex-entry-gm-tag">GM</span><CodexMarkdown text={entry.gmText} /></div>}
            <footer className="codex-entry-foot">
              {entry.attachPageId && <Button variant="ghost" size="sm" onClick={() => onOpenPage(entry.attachPageId!)}>Open page</Button>}
              <Button variant="ghost" size="sm" onClick={() => edit(entry)}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={() => remove(entry)}>Delete</Button>
            </footer>
          </article>
        ))}
      </div>
    </div>
  );
}
