import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Input } from "@vtt/ui";
import { socket } from "../socket";
import { journalApi, type CodexJournalEntry } from "./api";
import { GmOnlyTag } from "./SecretMarkers";

/**
 * A page's pinned campaign history, shown inline in the editor: every journal entry attached to this
 * page - including battles the combat-history bridge auto-logs at a location marker that links here -
 * plus a one-line composer to pin a new note. Gives the journal's "pin to page" a place it's read back.
 */
export function PageTimeline({ gmToken, pageId }: Readonly<{ gmToken: string; pageId: string }>) {
  const [entries, setEntries] = useState<CodexJournalEntry[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => { void journalApi.forPage(gmToken, pageId).then(setEntries).catch(() => setEntries([])); }, [gmToken, pageId]);
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
    <div className="codex-page-timeline">
      <h4 className="codex-backlinks-title">Journal</h4>
      {entries.length === 0 && <p className="codex-page-timeline-empty">No journal entries for this page yet.</p>}
      {entries.length > 0 && (
        <ul className="codex-page-timeline-list">
          {entries.map((entry) => (
            <li key={entry.id} className="codex-page-timeline-item">
              {entry.kind === "combat" && <Badge tone="caution">Battle</Badge>}
              {(entry.sessionNumber != null || entry.inWorldLabel) && <span className="codex-page-timeline-meta">{[entry.sessionNumber != null ? `S${entry.sessionNumber}` : null, entry.inWorldLabel].filter(Boolean).join(" · ")}</span>}
              {!entry.playerText.trim() && <GmOnlyTag />}
              <span className="codex-page-timeline-text">{entry.playerText || entry.gmText}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="codex-page-timeline-add">
        <Input value={note} placeholder="Add a journal note…" aria-label="Add a journal note to this page" onChange={(event) => setNote(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void add(); }} />
        <Button variant="secondary" size="sm" disabled={busy || !note.trim()} onClick={add}>Add</Button>
      </div>
      {error && <p className="codex-rail-error" role="alert">{error}</p>}
    </div>
  );
}
