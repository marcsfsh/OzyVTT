import { useMemo, useState } from "react";
import { Alert, Badge, Button, Combobox, GmOnlyTag, Input, Switch } from "@vtt/ui";
import { codexApi, CONNECTION_LABEL_MAX, type CodexPageConnection, type CodexPageSummary, type PlayerCodexPageConnection } from "./api";
import { CodexIcon, EntityIcon } from "./icons";
import { CONNECTION_LABEL_SUGGESTIONS } from "./entities";
import { newId } from "../lib/ids";

/**
 * One connection system, one panel. A declared connection and a `[[mention]]` differ only by `origin`.
 * A mention has no id, so it can't be relabelled or deleted here; it is edited through its source text.
 * Labels are free text with no inverse wording, so rows read by their arrow. The other end can be a page,
 * session, quest or journal entry.
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
  /** Open the other end. The caller owns the addresses. */
  onOpen: (kind: AnyConnection["otherKind"], id: string) => void;
  /** The GM's write half. Absent makes the panel read-only, so players render the same component. */
  write?: Readonly<{
    gmToken: string;
    pageId: string;
    pages: readonly CodexPageSummary[];
    onChanged: () => void;
  }>;
  /** `false` drops the heading and landmark, for the page editor's combined Connections region. */
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
  /** Suggestions plus labels already in use; never a closed vocabulary. */
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
    /* A named region when standalone, so it is a landmark. */
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
                {/* Why a mention has no Label or Remove, in visible words (touch devices never show `title`). */}
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
                {write && !declaredId && row.origin === "mention" && (
                  <span className="codex-conn-why">Written as a [[link]] in the text. Edit the text to change it.</span>
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
          <Combobox options={options} value={target} onChange={setTarget} ariaLabel="Connect to page" placeholder="Search pages" />
          <Input aria-label="Label (optional)" placeholder="ally of, located in" value={label} maxLength={CONNECTION_LABEL_MAX}
            list="codex-conn-labels" onChange={(event) => setLabel(event.target.value)} />
          {/* A GM-layer connection never reaches players, so it carries the violet mark. */}
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
