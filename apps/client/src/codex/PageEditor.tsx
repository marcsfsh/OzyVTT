import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Field, Input, Modal, SaveState, SegmentedControl, Select, TagInput, Textarea } from "@vtt/ui";
import { calendarApi, codexApi, uploadCodexAsset, type CodexAutosaveSettings, type CodexCalendar, type CodexPage, type CodexPageConnection, type CodexPageRevision, type CodexPageSummary, type CodexSettings } from "./api";
import { CodexImage } from "./CodexImage";
import { CodexEditor } from "./CodexEditor";
import { PageTimeline } from "./PageTimeline";
import { PageMarkers } from "./PageMarkers";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { RevealSwitch, GmOnlyTag } from "./SecretMarkers";
import { useCodexAutosave } from "./autosave";
import { useConfirm } from "../components/feedback";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityDef, splitEntityFields, type EntityType } from "./entities";

type BodyTab = "player" | "gm";

/**
 * `dateYear`/`dateMonth`/`dateDay` are the in-world date that puts an `event` page on the chronicle.
 * They are STRINGS here, exactly as the journal composer holds them, because a half-typed year is a
 * normal state of an input and coercing it every keystroke is how "1" becomes a saved year of 1.
 */
type Draft = { title: string; entityType: EntityType; fields: Record<string, string>; folder: string; tags: readonly string[]; playerBody: string; gmBody: string; bannerAssetId: string | null; dateYear: string; dateMonth: string; dateDay: string };

function draftOf(page: CodexPage): Draft {
  const date = page.inWorldDate; // the RAW date the GM typed - correct even if the calendar has since changed
  return {
    title: page.title, entityType: page.entityType, fields: { ...page.fields, ...page.gmFields }, folder: page.folder ?? "",
    tags: page.tags, playerBody: page.playerBody, gmBody: page.gmBody, bannerAssetId: page.bannerAssetId,
    dateYear: date ? String(date.year) : "", dateMonth: date ? String(date.month) : "0", dateDay: date ? String(date.day) : ""
  };
}

export type PageEditorProps = Readonly<{
  gmToken: string;
  page: CodexPage;
  pages: readonly CodexPageSummary[];
  /** D8: one list, both directions, both origins. Replaces `backlinks` + `relationships`. */
  connections: readonly CodexPageConnection[];
  autosave: CodexAutosaveSettings;
  onChange: (page: CodexPage) => void;
  onDeleted: () => void;
  /** Follow a `[[link]]`. Unresolved targets open quick-create rather than creating silently (D7). */
  onNavigate: (target: string) => void;
  /** Jump to the archived fight an auto-logged battle came from. GM-only: archives carry GM narration. */
  onOpenReplay?: (archiveId: number) => void;
  onConnectionsChanged: () => void;
  onOpenConnection: (kind: CodexPageConnection["otherKind"], id: string) => void;
  /** Open a pin on the Atlas — the page's "elsewhere" edge. Both halves travel (map, then pin). */
  onOpenMarker?: (markerId: string, mapId: string) => void;
  onPickTag?: (tag: string) => void;
}>;

export function PageEditor({ gmToken, page, pages, connections, autosave, onChange, onDeleted, onNavigate, onOpenReplay, onConnectionsChanged, onOpenConnection, onOpenMarker, onPickTag }: PageEditorProps) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => draftOf(page));
  const [revealed, setRevealed] = useState(page.revealedToPlayers);
  const [tab, setTab] = useState<BodyTab>("player");
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisions, setRevisions] = useState<CodexPageRevision[]>([]);
  const [settings, setSettings] = useState<CodexSettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const revRef = useRef(page.rev);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  /**
   * D6 — one autosave, the GM's cadence. Identical to the old hand-rolled behaviour when the setting is
   * on; when it is off the same hook drives an explicit Save, an "Unsaved changes" readout, a navigation
   * guard and a `beforeunload` handler.
   */
  const save = useCallback(async (next: Draft) => {
    const { fields, gmFields } = splitEntityFields(next.entityType, next.fields);
    const updated = await codexApi.updatePage(gmToken, page.id, {
      title: next.title.trim() || "Untitled", entityType: next.entityType, fields, gmFields,
      folder: next.folder.trim() || null, tags: next.tags,
      playerBody: next.playerBody, gmBody: next.gmBody, bannerAssetId: next.bannerAssetId,
      // Only an `event` page has a date control, so only an `event` page states a date. On any other
      // kind the key is OMITTED, and an omitted date leaves the stored one alone — which is what makes
      // switching an event to a note and back lossless rather than a silent erase.
      ...(next.entityType === "event"
        ? { inWorldDate: next.dateYear.trim() ? { year: Math.trunc(Number(next.dateYear) || 0), month: Number(next.dateMonth || 0), day: Math.max(1, Math.trunc(Number(next.dateDay) || 1)) } : null }
        : {}),
      expectedRev: revRef.current
    });
    revRef.current = updated.rev;
    setSaveError(null);
    onChange(updated);
  }, [gmToken, page.id, onChange]);

  const { status, dirty, flush, markSaved } = useCodexAutosave<Draft>({
    settings: autosave,
    draft,
    save,
    onConflict: async () => {
      try { revRef.current = (await codexApi.getPage(gmToken, page.id)).page.rev; } catch { /* keep stale rev; a later flush retries */ }
    }
  });

  /**
   * Adopt an EXTERNAL change to this same page (a folder move from the tree patches folder + rev out
   * from under us). With no unsaved local edits we take the server copy, so the editor does not keep a
   * stale folder and then 409 its next save. With unsaved edits the draft wins and our save lands.
   */
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    if (dirtyRef.current) return;
    revRef.current = page.rev;
    const next = draftOf(page);
    setDraft(next);
    markSaved(next);
  }, [page, markSaved]);

  const body = tab === "player" ? draft.playerBody : draft.gmBody;
  const setBody = (next: string) => setDraft((prev) => ({ ...prev, [tab === "player" ? "playerBody" : "gmBody"]: next }));
  const setField = (key: string, value: string) => setDraft((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  const typeDef = entityDef(draft.entityType);

  const isEvent = draft.entityType === "event";
  const [calendar, setCalendar] = useState<CodexCalendar | null>(null);
  useEffect(() => {
    if (!isEvent || calendar) return;
    let live = true;
    void calendarApi.get(gmToken).then((next) => { if (live) setCalendar(next); }).catch(() => undefined);
    return () => { live = false; };
  }, [isEvent, calendar, gmToken]);
  // The kind-change copy names the history setting, so read it once when the editor mounts.
  useEffect(() => { void codexApi.getSettings(gmToken).then(setSettings).catch(() => undefined); }, [gmToken]);

  /**
   * D7 / director ruling R7 — **changing a page's kind always confirms.**
   *
   * Unconditional, not "only when fields would be lost": the two cases read the same to a GM mid-flow,
   * and a conditional dialog is exactly the kind you learn to dismiss unread before the destructive one
   * arrives. What differs is the copy — with populated foreign fields it names them.
   *
   * Recovery is a **hard guarantee**: a type-changing save forces a revision snapshot server-side,
   * bypassing the coalescing window, so "restore them from History" is literally true. Unless the GM has
   * switched version history off, in which case the copy softens rather than lying.
   */
  const changeKind = async (nextType: EntityType) => {
    if (nextType === draft.entityType) return;
    const keep = new Set(entityDef(nextType).fields.map((field) => field.key));
    const lost = entityDef(draft.entityType).fields
      .filter((field) => !keep.has(field.key) && (draft.fields[field.key] ?? "").trim())
      .map((field) => field.label);
    const historyOn = settings?.revisionHistory.enabled ?? true;
    const recovery = historyOn
      ? "They'll be removed — you can restore them from History."
      : "They'll be removed, and version history is off, so this can't be undone.";
    const ok = await confirm({
      title: `Change kind to ${ENTITY_DEFS[nextType].label}?`,
      body: lost.length > 0
        ? `These ${ENTITY_DEFS[draft.entityType].label} fields have text that ${ENTITY_DEFS[nextType].label} doesn't use: ${lost.join(", ")}. ${recovery}`
        : `Its fields become ${ENTITY_DEFS[nextType].label}'s. Nothing you've written is lost.`,
      confirmLabel: "Change kind"
    });
    if (!ok) return;
    // Client and server prune identically. Leaving stripped values in the draft would show the GM a
    // field the very next save deletes — the server prunes to the effective kind on every save that
    // touches fields or the kind (the CD-2 viewer-safety decision), so the draft must agree.
    setDraft((prev) => ({ ...prev, entityType: nextType, fields: Object.fromEntries(Object.entries(prev.fields).filter(([key]) => keep.has(key))) }));
  };

  const toggleReveal = async (next: boolean) => {
    setRevealed(next);
    // Flush any pending edit first, so revealing never briefly publishes the pre-edit body.
    try { await flush(); const updated = await codexApi.revealPage(gmToken, page.id, next); onChange(updated); }
    catch { setRevealed(!next); setSaveError("Couldn't change who can see this page."); }
  };

  const openRevisions = async () => {
    setRevisionsOpen(true);
    try { setRevisions(await codexApi.listRevisions(gmToken, page.id)); } catch { setRevisions([]); }
    try { setSettings(await codexApi.getSettings(gmToken)); } catch { setSettings(null); }
  };
  const restore = async (revisionId: number) => {
    try {
      const updated = await codexApi.restoreRevision(gmToken, page.id, revisionId);
      revRef.current = updated.rev;
      const next = draftOf(updated);
      setDraft(next);
      markSaved(next);
      setRevisionsOpen(false);
      onChange(updated);
    } catch { setSaveError("Couldn't restore that version."); }
  };
  const remove = async () => {
    if (!(await confirm({ title: "Delete page", body: `Delete "${draft.title || "this page"}"? This cannot be undone.`, confirmLabel: "Delete", danger: true }))) return;
    try { await codexApi.deletePage(gmToken, page.id); onDeleted(); } catch { setSaveError("Couldn't delete that page."); }
  };
  const uploadBanner = async (file: File | undefined) => {
    if (!file) return;
    try { const asset = await uploadCodexAsset(gmToken, file); setDraft((prev) => ({ ...prev, bannerAssetId: asset.id })); }
    catch { setSaveError("Couldn't upload that image."); }
  };

  const tagSuggestions = useMemo(() => [...new Set(pages.flatMap((summary) => summary.tags))].sort(), [pages]);
  const folderCrumbs = draft.folder.split("/").map((segment) => segment.trim()).filter(Boolean);

  return (
    <div className="codex-editor">
      <div className="codex-editor-head">
        <div className="codex-editor-titlewrap">
          {folderCrumbs.length > 0 && <nav className="codex-crumbs" aria-label="Folder path">{folderCrumbs.map((crumb, index) => <span key={index} className="codex-crumb-seg">{index > 0 && <span className="codex-crumb-sep">/</span>}{crumb}</span>)}</nav>}
          {/* D25: the bespoke `.codex-title-input` becomes the primitive's title variant. */}
          <Input variant="title" className="codex-title-input" value={draft.title} placeholder="Untitled page" aria-label="Page title"
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))} />
        </div>
        <div className="codex-editor-actions">
          <SaveState status={status} onRetry={() => void flush()} onReload={() => void flush()} />
          {/* D6: with autosave off, saving is an explicit act — and this view's one primary action. */}
          {!autosave.enabled && <Button variant="primary" size="sm" disabled={!dirty} onClick={() => void flush()}>Save</Button>}
          <RevealSwitch revealed={revealed} onChange={toggleReveal} ariaLabel="Show this page to players" />
          <Button variant="ghost" size="sm" onClick={openRevisions}>History</Button>
          <Button variant="ghost" size="sm" onClick={remove}>Delete</Button>
        </div>
      </div>
      {saveError && <Alert tone="danger">{saveError}</Alert>}

      <div className="codex-editor-cols">
        <div className="codex-editor-center">
          {draft.bannerAssetId
            ? <div className="codex-banner"><CodexImage assetId={draft.bannerAssetId} token={gmToken} alt="Page banner" className="codex-banner-img" /><div className="codex-banner-actions"><Button variant="ghost" size="sm" onClick={() => bannerInputRef.current?.click()}>Change</Button><Button variant="ghost" size="sm" onClick={() => setDraft((prev) => ({ ...prev, bannerAssetId: null }))}>Remove banner</Button></div></div>
            : <Button variant="ghost" size="sm" className="codex-banner-add" onClick={() => bannerInputRef.current?.click()}>Add banner image</Button>}
          <input ref={bannerInputRef} type="file" accept="image/*" hidden onChange={(event) => { void uploadBanner(event.target.files?.[0]); event.target.value = ""; }} />

          <div className="codex-meta-row">
            <Field label="Kind" htmlFor="codex-type">
              <Select id="codex-type" value={draft.entityType} onChange={(event) => void changeKind(event.target.value as EntityType)}>
                {ENTITY_TYPE_LIST.map((type) => <option key={type} value={type}>{ENTITY_DEFS[type].label}</option>)}
              </Select>
            </Field>
            <Field label="Folder" htmlFor="codex-folder" help="Use / to nest, e.g. NPCs/Villains"><Input id="codex-folder" value={draft.folder} placeholder="Unfiled" onChange={(event) => setDraft((prev) => ({ ...prev, folder: event.target.value }))} /></Field>
            <Field label="Tags" htmlFor="codex-tags">
              <TagInput id="codex-tags" ariaLabel="Tags" placeholder="town, npc" values={draft.tags}
                onChange={(next: readonly string[]) => setDraft((prev) => ({ ...prev, tags: next }))}
                max={24} maxReachedReason="A page may carry at most 24 tags."
                suggestions={tagSuggestions} />
            </Field>
          </div>
          {onPickTag && draft.tags.length > 0 && (
            /* D10: a tag is a cross-type view, everywhere it appears. */
            <div className="codex-editor-tagjumps">
              {draft.tags.map((tag) => <button key={tag} type="button" className="codex-tag-chip tap-target" onClick={() => onPickTag(tag)}>{tag}</button>)}
            </div>
          )}

          {isEvent && (
            <div className="codex-meta-row codex-event-date">
              <Field label="Year" htmlFor="codex-date-year" help="Places this event on the Journal and the Calendar."><Input id="codex-date-year" type="number" inputMode="numeric" value={draft.dateYear} placeholder="1492" onChange={(event) => setDraft((prev) => ({ ...prev, dateYear: event.target.value }))} /></Field>
              <Field label="Month" htmlFor="codex-date-month"><Select id="codex-date-month" value={draft.dateMonth} disabled={!draft.dateYear.trim()} onChange={(event) => setDraft((prev) => ({ ...prev, dateMonth: event.target.value }))}>{(calendar?.months ?? []).map((month, index) => <option key={index} value={String(index)}>{month.name}</option>)}</Select></Field>
              <Field label="Day" htmlFor="codex-date-day"><Input id="codex-date-day" type="number" inputMode="numeric" value={draft.dateDay} placeholder="1" disabled={!draft.dateYear.trim()} onChange={(event) => setDraft((prev) => ({ ...prev, dateDay: event.target.value }))} /></Field>
            </div>
          )}

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
          </div>

          {/* D13: the ONE editor. Toolbar, `[[` autocomplete, image drop/paste and the Edit/View switch
              are the primitive's; the Codex supplies its reader, its page list and its violet chrome. */}
          <CodexEditor token={gmToken} value={body} onChange={setBody}
            ariaLabel={tab === "player" ? "Player-facing body" : "GM secret body"}
            placeholder={tab === "player" ? "Player-facing description…" : "GM-only notes: secrets, hooks, stats…"}
            pages={pages} excludePageId={page.id} onNavigate={onNavigate} gmLayer={tab === "gm"} />
        </div>

        <aside className="codex-editor-context" aria-label="Page details">
          {/* ≤560 the rail sits below a tall editor, so an anchor row keeps the interconnectivity tools
              reachable instead of buried under half a viewport of textarea. */}
          <nav className="codex-context-jump" aria-label="Jump to">
            <span className="codex-context-jumplabel">Jump to:</span>
            <a href="#codex-connections-h">Connections</a>
          </nav>
          {/* D8: ONE panel, both directions, both origins — this replaces the separate Relationships
              panel and the "Linked from" backlink block that used to sit below it. */}
          <ConnectionsPanel connections={connections} onOpen={onOpenConnection}
            write={{ gmToken, pageId: page.id, pages, onChanged: onConnectionsChanged }} />
          <section className="codex-connections" aria-labelledby="codex-elsewhere-h">
            <h4 className="codex-backlinks-title" id="codex-elsewhere-h">Elsewhere</h4>
            <PageMarkers gmToken={gmToken} pageId={page.id} onOpenMarker={onOpenMarker} />
            <PageTimeline gmToken={gmToken} pageId={page.id} onOpenReplay={onOpenReplay} onOpenEntry={(entryId) => onOpenConnection("journal", entryId)} />
          </section>
        </aside>
      </div>

      {revisionsOpen && (
        <Modal open onClose={() => setRevisionsOpen(false)} title="Version history" size="md" ariaLabel="Version history">
          {settings && (
            <p className="codex-composer-hint">
              {!settings.revisionHistory.enabled
                ? "Version history is off, so nothing new is being saved. These can still be restored. Change it in Settings."
                : settings.revisionHistory.windowMinutes > 0
                ? `One version is saved per ${settings.revisionHistory.windowMinutes} minutes, so the newest below can be that far behind the page. Change it in Settings.`
                : "Every save is kept as a version. Change it in Settings."}
            </p>
          )}
          {revisions.length === 0 ? <p className="codex-preview-empty">No earlier versions.</p> : (
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
