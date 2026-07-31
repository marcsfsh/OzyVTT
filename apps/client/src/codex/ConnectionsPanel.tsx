import { useMemo, useState } from "react";
import { Alert, Badge, Button, Combobox, Input, Switch } from "@vtt/ui";
import { codexApi, CONNECTION_LABEL_MAX, type CodexPageConnection, type CodexPageSummary, type PlayerCodexPageConnection } from "./api";
import { CodexIcon, EntityIcon } from "./icons";
import { GmOnlyTag } from "./SecretMarkers";
import { CONNECTION_LABEL_SUGGESTIONS } from "./entities";
import { newId } from "../lib/ids";

/**
 * D8 — **one connection system**, one panel.
 *
 * Typed relationships and `[[wiki-links]]` used to be two features with two panels, two feeds and two
 * edge styles in the Graph. They are now one concept with an `origin` attribute: a connection the GM
 * declared and a connection derived from body text differ by where they came from, not by what they are.
 *
 * Three things this panel has to say out loud, because the server's model says them:
 *
 *  1. **A mention has no id** (`id === null`). It is derived from text, so it cannot be relabelled or
 *     deleted here — it is edited by editing the text that produced it, and the row says so instead of
 *     offering a delete button that would 404.
 *  2. **The label is free text**, not a slug from a fixed vocabulary. Migration v22 rewrote the twelve
 *     legacy slugs into the words a reader sees, so the stored value IS the label. There is therefore no
 *     translation table and — the accepted loss — **no inverse wording**: a free-text label cannot be
 *     inverted generically, so a row reads by its ARROW ("Barovia → rules → Strahd" one way, and the
 *     same edge read from Strahd's page as "Barovia → rules → Strahd" with the arrow pointing in).
 *  3. **The other end can be a session, quest or journal entry** (D13). Bodies join the graph, so a page
 *     can honestly answer "where else does this appear?" with "in Session 4's prep".
 */

type AnyConnection = CodexPageConnection | PlayerCodexPageConnection;

const OTHER_KIND_ICON: Readonly<Record<AnyConnection["otherKind"], string>> = {
  page: "scroll", session: "sessions", quest: "quest", journal: "book"
};
const OTHER_KIND_LABEL: Readonly<Record<AnyConnection["otherKind"], string>> = {
  page: "Page", session: "Session", quest: "Quest", journal: "Journal entry"
};

export type ConnectionsPanelProps = Readonly<{
  connections: readonly AnyConnection[];
  /** Open the other end. The caller owns the addresses, so this panel knows no routes. */
  onOpen: (kind: AnyConnection["otherKind"], id: string) => void;
  /**
   * The GM's write half. Absent makes the panel read-only — the capability-flag pattern this codebase
   * uses everywhere instead of a role check, so the player's page view renders the very same component.
   */
  write?: Readonly<{
    gmToken: string;
    pageId: string;
    pages: readonly CodexPageSummary[];
    onChanged: () => void;
  }>;
  /**
   * `false` drops the panel's own heading and landmark, for the page editor — which wraps this together
   * with "On the atlas" and "In the journal" under ONE "Connections" region, because they are one
   * question ("where else does this appear?") and three headings would be three features again.
   */
  standalone?: boolean;
}>;

export function ConnectionsPanel({ connections, onOpen, write, standalone = true }: ConnectionsPanelProps) {
  const [adding, setAdding] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [gmLayer, setGmLayer] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const Wrapper = standalone ? "section" : "div";
  const options = useMemo(
    () => (write?.pages ?? [])
      .filter((page) => page.id !== write?.pageId)
      .map((page) => ({ id: page.id, label: page.title, icon: <EntityIcon type={page.entityType} />, meta: undefined })),
    [write?.pages, write?.pageId]
  );
  /** The twelve humanized legacy labels plus everything already in use — suggestions, never a vocabulary. */
  const labelSuggestions = useMemo(() => {
    const used = new Set<string>(CONNECTION_LABEL_SUGGESTIONS);
    for (const row of connections) if (row.label) used.add(row.label);
    return [...used].sort();
  }, [connections]);

  const add = async () => {
    if (!write || !target || busy) return;
    setBusy(true); setError(null);
    try {
      await codexApi.addConnection(write.gmToken, write.pageId, {
        toPageId: target,
        label: label.trim() ? label.trim().slice(0, CONNECTION_LABEL_MAX) : null,
        layer: gmLayer ? "gm" : "player",
        commandId: newId()
      });
      setTarget(null); setLabel(""); setGmLayer(false); setAdding(false);
      write.onChanged();
    } catch (addError) { setError(addError instanceof Error ? addError.message : "Couldn't add that connection."); }
    finally { setBusy(false); }
  };
  const relabel = async (id: string) => {
    if (!write) return;
    setBusy(true); setError(null);
    try {
      await codexApi.updateConnection(write.gmToken, id, { label: editLabel.trim() ? editLabel.trim().slice(0, CONNECTION_LABEL_MAX) : null, commandId: newId() });
      setEditing(null); write.onChanged();
    } catch (patchError) { setError(patchError instanceof Error ? patchError.message : "Couldn't rename that connection."); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!write) return;
    setError(null);
    try { await codexApi.removeConnection(write.gmToken, id); write.onChanged(); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Couldn't remove that connection."); }
  };

  return (
    /* A named region when it stands alone, so "where else does this appear?" is a landmark a reader can
       jump to rather than a heading buried in a rail. */
    <Wrapper className="codex-connections-panel" {...(standalone ? { "aria-labelledby": "codex-connections-h" } : {})}>
      {standalone && <h4 className="codex-backlinks-title" id="codex-connections-h">Connections</h4>}
      {connections.length === 0 && <p className="codex-page-timeline-empty">Nothing is connected to this page yet.</p>}
      {connections.length > 0 && (
        <ul className="codex-conn-list">
          {connections.map((row) => {
            const key = `${row.otherKind}:${row.otherId}:${row.direction}:${row.label ?? ""}:${row.origin}`;
            const declaredId = "id" in row ? row.id : null;
            const isGmLayer = "layer" in row && row.layer === "gm";
            return (
              <li key={key} className="codex-conn-row">
                <span className={`codex-conn-arrow${row.direction === "in" ? " is-in" : ""}`} aria-hidden="true" />
                <span className="nh-sr-only">{row.direction === "out" ? "This page points to" : "Points at this page"}</span>
                <button type="button" className="codex-conn-target" onClick={() => onOpen(row.otherKind, row.otherId)}>
                  {row.otherKind === "page" && row.otherEntityType
                    ? <EntityIcon type={row.otherEntityType} />
                    : <CodexIcon iconId={OTHER_KIND_ICON[row.otherKind]} className="codex-ent-icon" />}
                  <span className="codex-list-title">{row.otherTitle}</span>
                </button>
                {row.label && <Badge tone="info" className="codex-conn-label">{row.label}</Badge>}
                {row.otherKind !== "page" && <span className="codex-conn-kind">{OTHER_KIND_LABEL[row.otherKind]}</span>}
                {/* A mention has no row to delete, so it explains itself rather than offering a control
                    that would 404: it is edited by editing the text that produced it. */}
                {/* The reason this row has no Label or Remove, said in VISIBLE words. It used to be a
                    native `title` tooltip, which a touch device never shows at all — so on the surface
                    where the question is most likely to be asked, the answer did not exist. */}
                {row.origin === "mention" && (
                  <Badge className="codex-conn-origin">Mentioned{row.section ? ` · ${row.section}` : ""}</Badge>
                )}
                {isGmLayer && <GmOnlyTag />}
                {write && declaredId && editing !== declaredId && (
                  <span className="codex-conn-actions">
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(declaredId); setEditLabel(row.label ?? ""); }}>Label</Button>
                    <Button variant="ghost" size="sm" onClick={() => void remove(declaredId)}>Remove</Button>
                  </span>
                )}
                {/* Design-language §5: a control that is absent owes the reader a reason, in words on the
                    row. A mention has no row of its own to edit — it is written by the text and unwritten
                    the same way — so this is where that is said. */}
                {write && !declaredId && row.origin === "mention" && (
                  <span className="codex-conn-why">Written as a [[link]] in the text — edit the text to change it.</span>
                )}
                {write && declaredId && editing === declaredId && (
                  <span className="codex-conn-actions">
                    <Input aria-label="Connection label" value={editLabel} maxLength={CONNECTION_LABEL_MAX} autoFocus
                      list="codex-conn-labels"
                      onChange={(event) => setEditLabel(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void relabel(declaredId); } if (event.key === "Escape") setEditing(null); }} />
                    <Button variant="secondary" size="sm" disabled={busy} onClick={() => void relabel(declaredId)}>Save</Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {write && !adding && <Button variant="ghost" size="sm" className="codex-conn-add" onClick={() => setAdding(true)}>Add connection</Button>}
      {write && adding && (
        <div className="codex-conn-form">
          <Combobox options={options} value={target} onChange={setTarget} ariaLabel="Connect to page" placeholder="Search pages…" />
          <Input aria-label="Label (optional)" placeholder="ally of, located in…" value={label} maxLength={CONNECTION_LABEL_MAX}
            list="codex-conn-labels" onChange={(event) => setLabel(event.target.value)} />
          {/* Layer is the D13 semantics made visible: a GM-layer connection never travels to a player,
              so it carries the violet mark that means exactly that everywhere else in the suite. */}
          <label className="codex-conn-gmswitch">
            <Switch checked={gmLayer} onChange={setGmLayer} label="GM only" aria-label="Keep this connection GM-only" />
            <GmOnlyTag />
          </label>
          <div className="codex-conn-formactions">
            <Button variant="secondary" size="sm" disabled={!target || busy} onClick={() => void add()}>Add</Button>
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setTarget(null); setLabel(""); setGmLayer(false); }}>Cancel</Button>
          </div>
        </div>
      )}
      <datalist id="codex-conn-labels">{labelSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>
      {error && <Alert tone="danger">{error}</Alert>}
    </Wrapper>
  );
}
