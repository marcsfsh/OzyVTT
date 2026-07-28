import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Field, IconButton, Input, Modal, SaveState, SegmentedControl, Select, TagInput, Textarea, type SaveStatus } from "@vtt/ui";
import { codexApi, CodexRequestError, uploadCodexAsset, type CodexBacklink, type CodexPage, type CodexPageRevision, type CodexPageSummary, type CodexRelationship } from "./api";
import { CodexMarkdown } from "./CodexMarkdown";
import { CodexImage } from "./CodexImage";
import { PageTimeline } from "./PageTimeline";
import { PageMarkers } from "./PageMarkers";
import { RelationshipsPanel } from "./RelationshipsPanel";
import { RevealSwitch, GmOnlyTag } from "./SecretMarkers";
import { CodexIcon } from "./icons";
import { useConfirm } from "../components/feedback";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityDef, splitEntityFields, type EntityType } from "./entities";

type BodyTab = "player" | "gm";

type Draft = { title: string; entityType: EntityType; fields: Record<string, string>; folder: string; tagsText: string; playerBody: string; gmBody: string; bannerAssetId: string | null };

function draftOf(page: CodexPage): Draft {
  // The editor holds one flat value map; public `fields` + GM-only `gmFields` merge for editing and re-split on save.
  return { title: page.title, entityType: page.entityType, fields: { ...page.fields, ...page.gmFields }, folder: page.folder ?? "", tagsText: page.tags.join(", "), playerBody: page.playerBody, gmBody: page.gmBody, bannerAssetId: page.bannerAssetId };
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
    case "strike": return wrap("~~");
    case "code": return wrap("`");
    case "heading": return linePrefix("## ");
    case "bullet": return linePrefix("- ");
    case "numbered": return linePrefix("1. ");
    case "quote": return linePrefix("> ");
    case "rule": return { value: `${value.slice(0, start)}\n---\n${value.slice(end)}`, caret: start + 5 };
    case "wikilink": return { value: `${value.slice(0, start)}[[${selected || ""}]]${value.slice(end)}`, caret: start + 2 + selected.length };
    default: return { value, caret: end };
  }
}

const TOOLBAR: ReadonlyArray<{ kind: string; label: string; glyph?: string; icon?: string }> = [
  { kind: "bold", label: "Bold", glyph: "B" },
  { kind: "italic", label: "Italic", glyph: "I" },
  { kind: "strike", label: "Strikethrough", glyph: "S" },
  { kind: "code", label: "Inline code", glyph: "‹›" },
  { kind: "heading", label: "Heading", glyph: "H" },
  { kind: "bullet", label: "Bullet list", glyph: "•" },
  { kind: "numbered", label: "Numbered list", glyph: "1." },
  { kind: "quote", label: "Quote", glyph: "”" },
  { kind: "rule", label: "Divider", glyph: "―" },
  { kind: "wikilink", label: "Wiki-link to another page", glyph: "[[ ]]" }
];

type PageEditorProps = Readonly<{
  gmToken: string;
  page: CodexPage;
  pages: readonly CodexPageSummary[];
  backlinks: readonly CodexBacklink[];
  relationships: readonly CodexRelationship[];
  onChange: (page: CodexPage) => void;
  onDeleted: () => void;
  onNavigate: (target: string) => void;
  /** Jump to the archived fight an auto-logged battle came from. GM-only: archives carry GM narration. */
  onOpenReplay?: (archiveId: number) => void;
  /** CI-3: open one of this page's journal entries, on the Journal, with that entry focused. */
  onOpenEntry?: (entryId: string) => void;
  /** CI-4: open one of this page's atlas pins — its map first, then the pin (both halves, per R1). */
  onOpenMarker?: (markerId: string, mapId: string) => void;
  /** CI-5: open the Graph focused on this entity's own node. */
  onShowInGraph?: (pageId: string) => void;
  onRelationshipsChanged: () => void;
}>;

/** When the caret sits inside an unclosed `[[…`, return the open bracket's offset + the typed query. */
function wikiContext(value: string, caret: number): { start: number; query: string } | null {
  const prefix = value.slice(0, caret);
  const open = prefix.lastIndexOf("[[");
  if (open === -1) return null;
  const query = prefix.slice(open + 2);
  if (/[[\]\n]/.test(query)) return null; // a bracket or newline since `[[` means it's not an open wiki-link
  return { start: open, query };
}

export function PageEditor({ gmToken, page, pages, backlinks, relationships, onChange, onDeleted, onNavigate, onOpenReplay, onOpenEntry, onOpenMarker, onShowInGraph, onRelationshipsChanged }: PageEditorProps) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => draftOf(page));
  const [revealed, setRevealed] = useState(page.revealedToPlayers);
  const [tab, setTab] = useState<BodyTab>("player");
  const [preview, setPreview] = useState(false);
  const [suggest, setSuggest] = useState<{ start: number; query: string; index: number } | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<CodexPageRevision[]>([]);
  const revRef = useRef(page.rev);
  const savedRef = useRef(serialize(draftOf(page)));
  const draftRef = useRef(draft);
  const savingRef = useRef(false);
  const dirtyRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { draftRef.current = draft; }, [draft]);

  // Serialized autosave: only ever ONE PATCH in flight. Overlapping saves would race the same expectedRev
  // and 409 against *themselves*, then wedge the editor (revRef never resyncs). A fresh edit mid-save sets
  // dirtyRef and re-runs on completion; a genuine 409 resyncs revRef so the next edit saves cleanly.
  const flush = useCallback(async () => {
    if (savingRef.current) { dirtyRef.current = true; return; }
    const snapshot = serialize(draftRef.current);
    if (snapshot === savedRef.current) return;
    savingRef.current = true;
    setStatus("saving");
    try {
      const draftNow = draftRef.current;
      // Split the flat value map back into player-facing `fields` and GM-only `gmFields` (secret motives never reach players).
      const { fields, gmFields } = splitEntityFields(draftNow.entityType, draftNow.fields);
      const updated = await codexApi.updatePage(gmToken, page.id, {
        title: draftNow.title.trim() || "Untitled", entityType: draftNow.entityType, fields, gmFields,
        folder: draftNow.folder.trim() || null, tags: parseTags(draftNow.tagsText),
        playerBody: draftNow.playerBody, gmBody: draftNow.gmBody, bannerAssetId: draftNow.bannerAssetId, expectedRev: revRef.current
      });
      savedRef.current = snapshot;
      revRef.current = updated.rev;
      setStatus("saved");
      onChange(updated);
    } catch (error) {
      if (error instanceof CodexRequestError && error.status === 409) {
        try { revRef.current = (await codexApi.getPage(gmToken, page.id)).page.rev; } catch { /* keep stale rev; a later flush retries */ }
        setStatus("conflict");
      } else { setStatus("error"); }
    } finally {
      savingRef.current = false;
      if (dirtyRef.current) { dirtyRef.current = false; void flush(); }
    }
  }, [gmToken, page.id, onChange]);

  // Debounce: ~800ms after the last edit, ask flush() to run (it self-serializes).
  useEffect(() => {
    if (serialize(draft) === savedRef.current) return;
    const timer = setTimeout(() => { void flush(); }, 800);
    return () => clearTimeout(timer);
  }, [draft, flush]);

  // Flush any pending edit when the editor unmounts (navigating away / switching Codex tabs) - the debounce
  // timer alone would silently drop the last edit. flushRef holds the latest flush so this runs only on unmount.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { if (serialize(draftRef.current) !== savedRef.current) void flushRef.current(); }, []);

  // Adopt an EXTERNAL change to this same page (e.g. a folder move from the tree, which patches folder + rev
  // out from under us). If we have no unsaved local edits, take the server copy so the editor doesn't keep a
  // stale folder and then 409 its next autosave. With unsaved edits we leave the draft alone (our save wins).
  useEffect(() => {
    const incoming = serialize(draftOf(page));
    if (incoming !== savedRef.current && serialize(draftRef.current) === savedRef.current) {
      savedRef.current = incoming;
      revRef.current = page.rev;
      setDraft(draftOf(page));
      setStatus("idle");
    }
  }, [page]);

  const body = tab === "player" ? draft.playerBody : draft.gmBody;
  const setBody = (next: string) => setDraft((prev) => ({ ...prev, [tab === "player" ? "playerBody" : "gmBody"]: next }));
  const setField = (key: string, value: string) => setDraft((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  const typeDef = entityDef(draft.entityType);

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

  // Wiki-link autocomplete: while the caret sits inside an open `[[`, suggest existing page titles so a
  // typo can't silently fork a second page for the same place.
  const suggestions = useMemo(() => {
    if (!suggest) return [];
    const query = suggest.query.trim().toLowerCase();
    return pages.filter((candidate) => candidate.id !== page.id && candidate.title.toLowerCase().includes(query)).slice(0, 6);
  }, [suggest, pages, page.id]);
  const syncSuggest = (value: string, caret: number) => {
    const context = wikiContext(value, caret);
    setSuggest(context ? { start: context.start, query: context.query, index: 0 } : null);
  };
  const insertWiki = (title: string) => {
    const textarea = textareaRef.current;
    if (!textarea || !suggest) return;
    const before = body.slice(0, suggest.start);
    const after = body.slice(textarea.selectionStart);
    const closing = after.startsWith("]]") ? "" : "]]";
    setBody(`${before}[[${title}${closing}${after}`);
    setSuggest(null);
    const caret = before.length + 2 + title.length + 2; // land just past the (existing or added) ]]
    requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(caret, caret); });
  };
  const onBodyKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggest || suggestions.length === 0) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setSuggest((prev) => prev && { ...prev, index: Math.min(prev.index + 1, suggestions.length - 1) }); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setSuggest((prev) => prev && { ...prev, index: Math.max(prev.index - 1, 0) }); }
    else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insertWiki(suggestions[Math.min(suggest.index, suggestions.length - 1)].title); }
    else if (event.key === "Escape") { event.preventDefault(); setSuggest(null); }
  };

  // Drop or paste an image straight into the body - how a GM actually collects reference art mid-prep.
  const onBodyDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const file = event.dataTransfer?.files?.[0];
    if (file && file.type.startsWith("image/")) { event.preventDefault(); void insertImage(file); }
  };
  const onBodyPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    for (let i = 0; items && i < items.length; i += 1) {
      if (items[i].type.startsWith("image/")) { const file = items[i].getAsFile(); if (file) { event.preventDefault(); void insertImage(file); return; } }
    }
  };

  const toggleReveal = async (next: boolean) => {
    setRevealed(next);
    // Flush any pending edit first, so revealing never briefly publishes the pre-edit body.
    try { await flush(); const updated = await codexApi.revealPage(gmToken, page.id, next); onChange(updated); }
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
    if (!(await confirm({ title: "Delete page", body: `Delete "${draft.title || "this page"}"? This cannot be undone.`, confirmLabel: "Delete", danger: true }))) return;
    try { await codexApi.deletePage(gmToken, page.id); onDeleted(); } catch { setStatus("error"); }
  };

  // Outline of the current body's markdown headings (Obsidian-style), clickable to jump the editor there.
  const outline = useMemo(() => {
    const items: { level: number; text: string; offset: number }[] = [];
    let offset = 0;
    for (const line of body.split("\n")) {
      const match = /^(#{1,3})\s+(.+)$/.exec(line);
      if (match) items.push({ level: match[1].length, text: match[2].trim(), offset });
      offset += line.length + 1;
    }
    return items;
  }, [body]);
  const jumpTo = (offset: number) => {
    setPreview(false);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(offset, offset);
      const lineIndex = body.slice(0, offset).split("\n").length - 1;
      const lineHeight = parseFloat(getComputedStyle(textarea).lineHeight) || 20;
      textarea.scrollTop = Math.max(0, lineIndex * lineHeight - 48);
    });
  };
  // Datalist hints from tags already used elsewhere in the notebook; free entry stays open.
  const tagSuggestions = useMemo(() => [...new Set(pages.flatMap((summary) => summary.tags))].sort(), [pages]);
  const folderCrumbs = draft.folder.split("/").map((segment) => segment.trim()).filter(Boolean);


  return (
    <div className="codex-editor">
      <div className="codex-editor-head">
        <div className="codex-editor-titlewrap">
          {folderCrumbs.length > 0 && <nav className="codex-crumbs" aria-label="Folder path">{folderCrumbs.map((crumb, index) => <span key={index} className="codex-crumb-seg">{index > 0 && <span className="codex-crumb-sep">/</span>}{crumb}</span>)}</nav>}
          <input className="codex-title-input" value={draft.title} placeholder="Untitled page" aria-label="Page title"
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} />
        </div>
        <div className="codex-editor-actions">
          <SaveState status={status} onRetry={() => void flush()} />
          <RevealSwitch revealed={revealed} onChange={toggleReveal} ariaLabel="Show this page to players" />
          <Button variant="ghost" size="sm" onClick={openRevisions}>History</Button>
          <Button variant="ghost" size="sm" onClick={remove}>Delete</Button>
        </div>
      </div>

      <div className="codex-editor-cols">
        <div className="codex-editor-center">
          {draft.bannerAssetId
            ? <div className="codex-banner"><CodexImage assetId={draft.bannerAssetId} token={gmToken} alt="Page banner" className="codex-banner-img" /><div className="codex-banner-actions"><Button variant="ghost" size="sm" onClick={() => bannerInputRef.current?.click()}>Change</Button><Button variant="ghost" size="sm" onClick={() => setDraft((prev) => ({ ...prev, bannerAssetId: null }))}>Remove banner</Button></div></div>
            : <button type="button" className="codex-banner-add" onClick={() => bannerInputRef.current?.click()}>+ Add banner image</button>}
          <input ref={bannerInputRef} type="file" accept="image/*" hidden onChange={(event) => { void uploadBanner(event.target.files?.[0]); event.target.value = ""; }} />

          <div className="codex-meta-row">
            <Field label="Entity type" htmlFor="codex-type">
              <Select id="codex-type" value={draft.entityType} onChange={(event) => setDraft((prev) => { const nextType = event.target.value as EntityType; const keep = new Set(entityDef(nextType).fields.map((field) => field.key)); return { ...prev, entityType: nextType, fields: Object.fromEntries(Object.entries(prev.fields).filter(([key]) => keep.has(key))) }; })}>
                {ENTITY_TYPE_LIST.map((type) => <option key={type} value={type}>{ENTITY_DEFS[type].label}</option>)}
              </Select>
            </Field>
            <Field label="Folder" htmlFor="codex-folder" help="Use / to nest, e.g. NPCs/Villains"><Input id="codex-folder" value={draft.folder} placeholder="Unfiled" onChange={(event) => setDraft((prev) => ({ ...prev, folder: event.target.value }))} /></Field>
            <Field label="Tags" htmlFor="codex-tags">
              <TagInput id="codex-tags" ariaLabel="Tags" placeholder="town, npc" values={parseTags(draft.tagsText)}
                onChange={(next: readonly string[]) => setDraft((prev) => ({ ...prev, tagsText: next.join(", ") }))}
                max={24} maxReachedReason="A page may carry at most 24 tags."
        suggestions={tagSuggestions}
                /* Uses TagInput's DEFAULT slugify on purpose. The server has always required slugs
                   (`codex-store.ts` tags(): /^[a-z0-9][a-z0-9-]*$/), but the old comma-field only
                   lowercased — so typing "sword coast" produced a tag the server rejected with a generic
                   save failure. The primitive's default is the server's contract; adopting it fixes that. */ />
            </Field>
          </div>

          {typeDef.fields.some((field) => !field.secret) && (
            <div className="codex-fields">
              {typeDef.fields.filter((field) => !field.secret).map((field) => (
                <Field key={field.key} label={field.label} htmlFor={`codex-field-${field.key}`} className={field.kind === "textarea" ? "codex-field-wide" : undefined}>
                  {field.kind === "textarea"
                    ? <Textarea id={`codex-field-${field.key}`} className="codex-field-area" value={draft.fields[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setField(field.key, event.target.value)} />
                    : <Input id={`codex-field-${field.key}`} value={draft.fields[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setField(field.key, event.target.value)} />}
                </Field>
              ))}
            </div>
          )}
          {typeDef.fields.some((field) => field.secret) && (
            <div className="codex-fields codex-fields-secret codex-gm-block">
              <span className="codex-fields-secret-tag"><GmOnlyTag /></span>
              {typeDef.fields.filter((field) => field.secret).map((field) => (
                <Field key={field.key} label={field.label} htmlFor={`codex-field-${field.key}`} className={field.kind === "textarea" ? "codex-field-wide" : undefined}>
                  {field.kind === "textarea"
                    ? <Textarea id={`codex-field-${field.key}`} className="codex-field-area" value={draft.fields[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setField(field.key, event.target.value)} />
                    : <Input id={`codex-field-${field.key}`} value={draft.fields[field.key] ?? ""} placeholder={field.placeholder} onChange={(event) => setField(field.key, event.target.value)} />}
                </Field>
              ))}
            </div>
          )}

          <div className="codex-body-bar">
            <SegmentedControl ariaLabel="Which body to edit" value={tab} onChange={(value) => setTab(value as BodyTab)}
              options={[{ value: "player", label: "Player-facing" }, { value: "gm", label: "GM only" }]} />
            <SegmentedControl ariaLabel="Edit or view the note" value={preview ? "view" : "edit"} onChange={(value) => setPreview(value === "view")}
              options={[{ value: "edit", label: "Edit" }, { value: "view", label: "View" }]} />
          </div>

          {!preview && (
            <div className="codex-toolbar" role="toolbar" aria-label="Formatting">
              {TOOLBAR.map((tool) => <IconButton key={tool.kind} label={tool.label} size="sm" onClick={() => format(tool.kind)}>{tool.icon ? <CodexIcon iconId={tool.icon} className="codex-tool-ic" /> : <span className="codex-tool-glyph">{tool.glyph}</span>}</IconButton>)}
              <IconButton label="Insert image" size="sm" onClick={() => imageInputRef.current?.click()}><CodexIcon iconId="image" className="codex-tool-ic" /></IconButton>
              <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={(event) => { void insertImage(event.target.files?.[0]); event.target.value = ""; }} />
            </div>
          )}

          {preview
            ? <div className={`codex-preview${tab === "gm" ? " is-gm" : ""}`}>{tab === "gm" && <GmOnlyTag floating />}{body.trim() ? <CodexMarkdown text={body} onNavigate={onNavigate} token={gmToken} /> : <p className="codex-preview-empty">Nothing to preview yet.</p>}</div>
            : <div className={`codex-editor-body${tab === "gm" ? " is-gm" : ""}`} onDrop={onBodyDrop} onDragOver={(event) => event.preventDefault()} onPaste={onBodyPaste}>
                <Textarea ref={textareaRef} className="codex-body-input" value={body} aria-label={tab === "player" ? "Player-facing body" : "GM secret body"}
                  placeholder={tab === "player" ? "Player-facing description…" : "GM-only notes: secrets, hooks, stats…"}
                  onChange={(event) => { setBody(event.target.value); syncSuggest(event.target.value, event.target.selectionStart ?? 0); }}
                  onKeyDown={onBodyKeyDown}
                  onKeyUp={(event) => { if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) syncSuggest(event.currentTarget.value, event.currentTarget.selectionStart ?? 0); }}
                  onClick={(event) => syncSuggest(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
                  onBlur={() => window.setTimeout(() => setSuggest(null), 150)} />
                {tab === "gm" && <GmOnlyTag floating />}
                {suggest && suggestions.length > 0 && (
                  <ul className="codex-wiki-suggest" role="listbox" aria-label="Link to page">
                    {suggestions.map((candidate, index) => (
                      <li key={candidate.id} role="option" aria-selected={index === suggest.index}>
                        <button type="button" className={`codex-wiki-suggest-item${index === suggest.index ? " is-active" : ""}`} onMouseDown={(event) => event.preventDefault()} onClick={() => insertWiki(candidate.title)}>{candidate.title}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>}
        </div>

        <aside className="codex-editor-context" aria-label="Note details">
          {outline.length > 0 && (
            <div className="codex-outline">
              <h4 className="codex-backlinks-title">Outline</h4>
              <ul className="codex-outline-list">
                {outline.map((heading, index) => (
                  <li key={index}><button type="button" className="codex-outline-item" style={{ paddingInlineStart: `${(heading.level - 1) * 12}px` }} onClick={() => jumpTo(heading.offset)}>{heading.text}</button></li>
                ))}
              </ul>
            </div>
          )}
          <RelationshipsPanel gmToken={gmToken} pageId={page.id} relationships={relationships} pages={pages} onChanged={onRelationshipsChanged} onOpen={onNavigate} />
          {/**
            * CI-3 / CI-4 / CI-5: the page's return edges, in ONE place.
            *
            * The assessment's "star topology" is that every surface points into Pages and nothing points
            * back out. Three separate buttons scattered down this rail would fix the topology and still
            * read as three unrelated features; grouped, they read as the answer to a single question a
            * GM actually asks — *where else does this entity appear?* — with one sub-heading per place
            * it can appear: other pages, the atlas, the journal, the graph.
            *
            * Every row is a jump that prepares its destination (R1); the destinations themselves are
            * owned by the workspace above, so each edge hands an id up rather than reaching into
            * another mode. Each block states its own emptiness, so "nothing here" is a fact about the
            * campaign rather than a gap in the panel.
            */}
          <section className="codex-connections" aria-labelledby="codex-connections-h">
            <div className="codex-connections-head">
              <h4 className="codex-backlinks-title" id="codex-connections-h">Connections</h4>
              {/* CI-5. §4: composed from the `@vtt/ui` `Button` primitive, so the 44px floor arrives
                  with it (route 2, `.nh-btn--sm` + `.tap-target`) — no new floor to argue about. */}
              {onShowInGraph && <Button variant="ghost" size="sm" onClick={() => onShowInGraph(page.id)}>Show in graph</Button>}
            </div>
            <div className="codex-connections-block">
              <h5 className="codex-connections-sub">Linked from</h5>
              {backlinks.length === 0
                ? <p className="codex-page-timeline-empty">No other page links here yet.</p>
                : <div className="codex-backlinks-list">
                    {backlinks.map((link) => <button key={link.sourcePageId} type="button" className="codex-md-link" onClick={() => onNavigate(link.sourceTitle)}>{link.sourceTitle}</button>)}
                  </div>}
            </div>
            <PageMarkers gmToken={gmToken} pageId={page.id} onOpenMarker={onOpenMarker} />
            <PageTimeline gmToken={gmToken} pageId={page.id} onOpenReplay={onOpenReplay} onOpenEntry={onOpenEntry} />
          </section>
        </aside>
      </div>

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

      {confirmDialog}
    </div>
  );
}
