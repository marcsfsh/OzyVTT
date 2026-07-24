import { useEffect, useRef, useState } from "react";
import { Badge, Button, Field, IconButton, Input, Modal, SegmentedControl, Switch, Textarea } from "@vtt/ui";
import { codexApi, CodexRequestError, uploadCodexAsset, type CodexBacklink, type CodexPage, type CodexPageRevision } from "./api";
import { CodexMarkdown } from "./CodexMarkdown";
import { CodexImage } from "./CodexImage";

type BodyTab = "player" | "gm";
type SaveStatus = "idle" | "saving" | "saved" | "conflict" | "error";

type Draft = { title: string; folder: string; tagsText: string; playerBody: string; gmBody: string; bannerAssetId: string | null };

function draftOf(page: CodexPage): Draft {
  return { title: page.title, folder: page.folder ?? "", tagsText: page.tags.join(", "), playerBody: page.playerBody, gmBody: page.gmBody, bannerAssetId: page.bannerAssetId };
}
function serialize(draft: Draft): string { return JSON.stringify(draft); }
function parseTags(text: string): string[] {
  return [...new Set(text.split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
}

/** Insert or wrap markdown at the textarea's selection, returning the new value + caret to restore. */
function applyFormat(value: string, start: number, end: number, kind: string): { value: string; caret: number } {
  const selected = value.slice(start, end);
  const wrap = (marker: string) => ({ value: `${value.slice(0, start)}${marker}${selected || ""}${marker}${value.slice(end)}`, caret: start + marker.length + (selected.length || 0) });
  const linePrefix = (prefix: string) => {
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    return { value: `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`, caret: end + prefix.length };
  };
  switch (kind) {
    case "bold": return wrap("**");
    case "italic": return wrap("*");
    case "heading": return linePrefix("## ");
    case "bullet": return linePrefix("- ");
    case "link": return { value: `${value.slice(0, start)}[${selected || "text"}](https://)${value.slice(end)}`, caret: start + 1 };
    case "wikilink": return { value: `${value.slice(0, start)}[[${selected || ""}]]${value.slice(end)}`, caret: start + 2 + selected.length };
    default: return { value, caret: end };
  }
}

const TOOLBAR: ReadonlyArray<{ kind: string; label: string; glyph: string }> = [
  { kind: "bold", label: "Bold", glyph: "B" },
  { kind: "italic", label: "Italic", glyph: "I" },
  { kind: "heading", label: "Heading", glyph: "H" },
  { kind: "bullet", label: "Bullet list", glyph: "•" },
  { kind: "link", label: "Link", glyph: "🔗" },
  { kind: "wikilink", label: "Wiki-link to another page", glyph: "[[ ]]" }
];

type PageEditorProps = Readonly<{
  gmToken: string;
  page: CodexPage;
  backlinks: readonly CodexBacklink[];
  onChange: (page: CodexPage) => void;
  onDeleted: () => void;
  onNavigate: (target: string) => void;
}>;

export function PageEditor({ gmToken, page, backlinks, onChange, onDeleted, onNavigate }: PageEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(page));
  const [revealed, setRevealed] = useState(page.revealedToPlayers);
  const [tab, setTab] = useState<BodyTab>("player");
  const [preview, setPreview] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<CodexPageRevision[]>([]);
  const revRef = useRef(page.rev);
  const savedRef = useRef(serialize(draftOf(page)));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Debounced autosave: fire ~800ms after the last edit, guarding against no-op saves and stale revs.
  useEffect(() => {
    const current = serialize(draft);
    if (current === savedRef.current) return;
    setStatus("saving");
    const timer = setTimeout(async () => {
      try {
        const updated = await codexApi.updatePage(gmToken, page.id, {
          title: draft.title.trim() || "Untitled", folder: draft.folder.trim() || null, tags: parseTags(draft.tagsText),
          playerBody: draft.playerBody, gmBody: draft.gmBody, bannerAssetId: draft.bannerAssetId, expectedRev: revRef.current
        });
        savedRef.current = current;
        revRef.current = updated.rev;
        setStatus("saved");
        onChange(updated);
      } catch (error) {
        setStatus(error instanceof CodexRequestError && error.status === 409 ? "conflict" : "error");
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [draft, gmToken, page.id, onChange]);

  const body = tab === "player" ? draft.playerBody : draft.gmBody;
  const setBody = (next: string) => setDraft((prev) => ({ ...prev, [tab === "player" ? "playerBody" : "gmBody"]: next }));

  const format = (kind: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { value, caret } = applyFormat(body, textarea.selectionStart, textarea.selectionEnd, kind);
    setBody(value);
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(caret, caret); });
  };
  const insertAtCursor = (snippet: string) => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    setBody(`${body.slice(0, start)}${snippet}${body.slice(end)}`);
    const caret = start + snippet.length;
    requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(caret, caret); });
  };
  const uploadBanner = async (file: File | undefined) => { if (!file) return; try { const asset = await uploadCodexAsset(gmToken, file); setDraft((prev) => ({ ...prev, bannerAssetId: asset.id })); } catch { setStatus("error"); } };
  const insertImage = async (file: File | undefined) => { if (!file) return; try { const asset = await uploadCodexAsset(gmToken, file); insertAtCursor(`\n![${file.name.replace(/\.[^.]+$/, "")}](codex-asset:${asset.id})\n`); } catch { setStatus("error"); } };

  const toggleReveal = async (next: boolean) => {
    setRevealed(next);
    try { const updated = await codexApi.revealPage(gmToken, page.id, next); onChange(updated); }
    catch { setRevealed(!next); setStatus("error"); }
  };

  const openRevisions = async () => {
    setRevisionsOpen(true);
    try { setRevisions(await codexApi.listRevisions(gmToken, page.id)); } catch { setRevisions([]); }
  };
  const restore = async (revisionId: number) => {
    try {
      const updated = await codexApi.restoreRevision(gmToken, page.id, revisionId);
      revRef.current = updated.rev;
      const nextDraft = draftOf(updated);
      savedRef.current = serialize(nextDraft);
      setDraft(nextDraft);
      setStatus("saved");
      setRevisionsOpen(false);
      onChange(updated);
    } catch { setStatus("error"); }
  };
  const remove = async () => {
    if (!confirm(`Delete "${draft.title || "this page"}"? This cannot be undone.`)) return;
    try { await codexApi.deletePage(gmToken, page.id); onDeleted(); } catch { setStatus("error"); }
  };

  const statusLabel = status === "saving" ? "Saving…" : status === "saved" ? "Saved" : status === "conflict" ? "Changed elsewhere - reload" : status === "error" ? "Save failed" : "";

  return (
    <div className="codex-editor">
      <div className="codex-editor-head">
        <input className="codex-title-input" value={draft.title} placeholder="Untitled page" aria-label="Page title"
          onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} />
        <div className="codex-editor-actions">
          <span className={`codex-save-status codex-save-${status}`} role="status">{statusLabel}</span>
          <Switch checked={revealed} onChange={toggleReveal} label={revealed ? "Shown to players" : "GM only"} />
          <Button variant="ghost" size="sm" onClick={openRevisions}>History</Button>
          <Button variant="ghost" size="sm" onClick={remove}>Delete</Button>
        </div>
      </div>

      {draft.bannerAssetId
        ? <div className="codex-banner"><CodexImage assetId={draft.bannerAssetId} token={gmToken} alt="Page banner" className="codex-banner-img" /><div className="codex-banner-actions"><Button variant="ghost" size="sm" onClick={() => bannerInputRef.current?.click()}>Change</Button><Button variant="ghost" size="sm" onClick={() => setDraft((prev) => ({ ...prev, bannerAssetId: null }))}>Remove banner</Button></div></div>
        : <button type="button" className="codex-banner-add" onClick={() => bannerInputRef.current?.click()}>+ Add banner image</button>}
      <input ref={bannerInputRef} type="file" accept="image/*" hidden onChange={(event) => { void uploadBanner(event.target.files?.[0]); event.target.value = ""; }} />

      <div className="codex-meta-row">
        <Field label="Folder" htmlFor="codex-folder"><Input id="codex-folder" value={draft.folder} placeholder="Unfiled" onChange={(event) => setDraft((prev) => ({ ...prev, folder: event.target.value }))} /></Field>
        <Field label="Tags" htmlFor="codex-tags" help="Comma-separated"><Input id="codex-tags" value={draft.tagsText} placeholder="town, npc" onChange={(event) => setDraft((prev) => ({ ...prev, tagsText: event.target.value }))} /></Field>
      </div>

      <div className="codex-body-bar">
        <SegmentedControl ariaLabel="Which body to edit" value={tab} onChange={(value) => setTab(value as BodyTab)}
          options={[{ value: "player", label: "Player-facing" }, { value: "gm", label: "GM secret" }]} />
        <Switch checked={preview} onChange={setPreview} label="Preview" aria-label="Toggle preview" />
      </div>

      {!preview && (
        <div className="codex-toolbar" role="toolbar" aria-label="Formatting">
          {TOOLBAR.map((tool) => <IconButton key={tool.kind} label={tool.label} size="sm" onClick={() => format(tool.kind)}><span className="codex-tool-glyph">{tool.glyph}</span></IconButton>)}
          <IconButton label="Insert image" size="sm" onClick={() => imageInputRef.current?.click()}><span className="codex-tool-glyph">🖼</span></IconButton>
          <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => { void insertImage(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
      )}

      {preview
        ? <div className="codex-preview">{body.trim() ? <CodexMarkdown text={body} onNavigate={onNavigate} token={gmToken} /> : <p className="codex-preview-empty">Nothing to preview yet.</p>}</div>
        : <Textarea ref={textareaRef} className="codex-body-input" value={body} aria-label={tab === "player" ? "Player-facing body" : "GM secret body"}
            placeholder={tab === "player" ? "What players learn about this place…" : "Secrets, plot hooks, GM notes…"} onChange={(event) => setBody(event.target.value)} />}

      {backlinks.length > 0 && (
        <div className="codex-backlinks">
          <h4 className="codex-backlinks-title">Linked from</h4>
          <div className="codex-backlinks-list">
            {backlinks.map((link) => <button key={link.sourcePageId} type="button" className="codex-md-link" onClick={() => onNavigate(link.sourceTitle)}>{link.sourceTitle}</button>)}
          </div>
        </div>
      )}

      {revisionsOpen && (
        <Modal open onClose={() => setRevisionsOpen(false)} title="Revision history" size="md" ariaLabel="Revision history">
          {revisions.length === 0 ? <p className="codex-preview-empty">No earlier revisions.</p> : (
            <ul className="codex-revisions">
              {revisions.map((revision) => (
                <li key={revision.id} className="codex-revision">
                  <div><strong>v{revision.rev}</strong> · <span className="codex-revision-when">{new Date(revision.authoredAt).toLocaleString()}</span></div>
                  <div className="codex-revision-title">{revision.title}</div>
                  <Button variant="secondary" size="sm" onClick={() => restore(revision.id)}>Restore</Button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}

      <div className="codex-editor-foot"><Badge tone={revealed ? "success" : "neutral"}>{revealed ? "Visible to players when revealed" : "Secret"}</Badge></div>
    </div>
  );
}
