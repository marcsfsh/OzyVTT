import { useState } from "react";
import { Button, Select } from "@vtt/ui";
import { codexApi, type CodexPageSummary, type CodexRelationship } from "./api";
import { RELATIONSHIP_TYPES, relationshipLabel, entityIcon } from "./entities";

/**
 * The relationships panel on an entity: lists every typed connection (both directions, read in natural
 * language - "rules Barovia", "ally of the Keepers"), and lets the GM link this entity to another with a
 * chosen relationship type. Edges are server-owned; the parent refetches the page on any change.
 */
export function RelationshipsPanel({ gmToken, pageId, relationships, pages, onChanged, onOpen }: Readonly<{
  gmToken: string;
  pageId: string;
  relationships: readonly CodexRelationship[];
  pages: readonly CodexPageSummary[];
  onChanged: () => void;
  onOpen: (title: string) => void;
}>) {
  const [type, setType] = useState(RELATIONSHIP_TYPES[0].type);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targets = pages.filter((page) => page.id !== pageId);

  const add = async () => {
    if (!target) return;
    setBusy(true); setError(null);
    try { await codexApi.addRelationship(gmToken, pageId, target, type); setTarget(""); onChanged(); }
    catch { setError("Couldn't add that link."); }
    finally { setBusy(false); }
  };
  const remove = async (relId: string) => {
    try { await codexApi.removeRelationship(gmToken, relId); onChanged(); }
    catch { setError("Couldn't remove that link."); }
  };

  return (
    <div className="codex-rels">
      <h4 className="codex-backlinks-title">Relationships</h4>
      {relationships.length === 0 && <p className="codex-page-timeline-empty">No connections yet.</p>}
      {relationships.length > 0 && (
        <ul className="codex-rels-list">
          {relationships.map((rel) => (
            <li key={rel.id} className="codex-rels-item">
              <span className="codex-rels-label">{relationshipLabel(rel.type, rel.direction)}</span>
              <button type="button" className="codex-md-link codex-rels-target" onClick={() => onOpen(rel.otherTitle)}>{entityIcon(rel.otherType)} {rel.otherTitle}</button>
              <button type="button" className="codex-rels-remove" aria-label="Remove relationship" onClick={() => void remove(rel.id)}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="codex-rels-add">
        <Select aria-label="Relationship type" value={type} onChange={(event) => setType(event.target.value)}>
          {RELATIONSHIP_TYPES.map((entry) => <option key={entry.type} value={entry.type}>{entry.label}</option>)}
        </Select>
        <Select aria-label="Related entity" value={target} onChange={(event) => setTarget(event.target.value)}>
          <option value="">— entity —</option>
          {targets.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}
        </Select>
        <Button variant="secondary" size="sm" disabled={busy || !target} onClick={add}>Link</Button>
      </div>
      {error && <p className="codex-inspector-hint" role="alert">{error}</p>}
    </div>
  );
}
