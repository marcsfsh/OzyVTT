import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, HiddenFromPlayers, Input, Skeleton } from "@vtt/ui";
import { socket } from "../socket";
import { journalApi, type CodexJournalEntry } from "./api";

/**
 * A page's campaign history in the editor: journal entries attached to it (including auto-logged battles),
 * plus a one-line composer. Each row opens the entry in the Journal via `onOpenEntry`.
 */
export function PageTimeline({ gmToken, pageId, onOpenReplay, onOpenEntry }: Readonly<{ gmToken: string; pageId: string; onOpenReplay?: (archiveId: number) => void; onOpenEntry?: (entryId: string) => void }>) {
  const [entries, setEntries] = useState<CodexJournalEntry[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An empty list mid-fetch must not read as settled.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    void journalApi.forPage(gmToken, pageId)
      .then((rows) => { setEntries(rows); setLoadError(null); })
      .catch((failure: unknown) => setLoadError(failure instanceof Error ? failure.message : "Couldn't load this page's journal entries."))
      .finally(() => setLoading(false));
  }, [gmToken, pageId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const onChanged = () => load(); socket.on("codex:changed", onChanged); return () => { socket.off("codex:changed", onChanged); }; }, [load]);

  const add = async () => {
    const text = note.trim();
    if (!text) return;
    setBusy(true); setError(null);
    try { await journalApi.create(gmToken, { playerText: text, attachPageId: pageId }); setNote(""); load(); }
    catch (addError) { setError(addError instanceof Error ? addError.message : "Couldn't log that note."); }
    finally { setBusy(false); }
  };

  return (
    <div className="codex-page-timeline codex-connections-block">
      <h5 className="codex-connections-sub">In the journal</h5>
      {loading && <Skeleton variant="text" />}
      {loadError && <Alert tone="danger">{loadError}</Alert>}
      {!loading && !loadError && entries.length === 0 && <p className="codex-page-timeline-empty">No journal entries for this page yet.</p>}
      {entries.length > 0 && (
        <ul className="codex-connections-list">
          {entries.map((entry) => {
            /* One row shape whether or not the row is openable. */
            const row = (
              <>
                {entry.kind === "combat" && <Badge tone="caution">Battle</Badge>}
                {(entry.sessionNumber != null || entry.inWorldLabel) && <span className="codex-page-timeline-meta">{[entry.sessionNumber != null ? `S${entry.sessionNumber}` : null, entry.inWorldLabel].filter(Boolean).join(" · ")}</span>}
                {/* Keyed on `revealedToPlayers`, not on missing player text. */}
                {!entry.revealedToPlayers && <HiddenFromPlayers />}
                <span className="codex-page-timeline-text codex-list-title">{entry.playerText || entry.gmText}</span>
              </>
            );
            return (
              <li key={entry.id} className="codex-page-timeline-item">
                {/* The whole row is the jump; the replay button stays a sibling (no button inside a button). */}
                {onOpenEntry
                  ? <button type="button" className="codex-connections-item" onClick={() => onOpenEntry(entry.id)}>{row}</button>
                  : <span className="codex-connections-item is-static">{row}</span>}
                {entry.kind === "combat" && entry.sourceEncounterId !== null && onOpenReplay &&
                  <button type="button" className="codex-linklike codex-connections-aside" onClick={() => onOpenReplay(entry.sourceEncounterId!)}>Open replay</button>}
              </li>
            );
          })}
        </ul>
      )}
      <div className="codex-page-timeline-add">
        <Input value={note} placeholder="Add a journal note" aria-label="Add a journal note to this page" onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void add(); }} />
        <Button variant="secondary" size="sm" disabled={busy || !note.trim()} onClick={add}>Add</Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
