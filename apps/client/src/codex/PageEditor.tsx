import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Field,
  GmOnlyTag,
  IconButton,
  IconX,
  Input,
  Modal,
  RevealSwitch,
  SaveState,
  Select,
  TagInput,
  Textarea
} from "@vtt/ui";
import type { CodexAutosaveSettings, CodexPage, CodexPageConnection, CodexPageSummary } from "@vtt/domain";
import { calendarApi, codexApi, uploadCodexAsset } from "./api";
import { CodexImage } from "./CodexImage";
import { CodexEditor } from "./CodexEditor";
import { BODY_LAYER, TwoLayerBodyTabs, type BodyLayer } from "./TwoLayerBodyTabs";
import { PageTimeline } from "./PageTimeline";
import { PageMarkers } from "./PageMarkers";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { useCodexAutosave } from "./autosave";
import { useConfirm } from "../components/feedback";
import { useCodexQuery } from "./useCodexQuery";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityDef, splitEntityFields, type EntityType } from "./entities";

/**
 * The page editor. The centre column holds only the body being written; properties and connections live
 * in a summoned overlay panel (not a `Drawer`, which would fight the shell's Session prep drawer).
 * The panel's open state is remembered per browser and starts closed.
 */
const DETAILS_KEY = "codex-page-details";
const DETAILS_ID = "codex-page-details";

/** In-world date parts are strings, as in the journal composer, so a half-typed year isn't coerced and saved. */
type Draft = {
  title: string;
  entityType: EntityType;
  fields: Record<string, string>;
  folder: string;
  tags: readonly string[];
  playerBody: string;
  gmBody: string;
  bannerAssetId: string | null;
  dateYear: string;
  dateMonth: string;
  dateDay: string;
};

function draftOf(page: CodexPage): Draft {
  const date = page.inWorldDate; // the raw date the GM typed, still valid if the calendar changed
  return {
    title: page.title,
    entityType: page.entityType,
    fields: { ...page.fields, ...page.gmFields },
    folder: page.folder ?? "",
    tags: page.tags,
    playerBody: page.playerBody,
    gmBody: page.gmBody,
    bannerAssetId: page.bannerAssetId,
    dateYear: date ? String(date.year) : "",
    dateMonth: date ? String(date.month) : "0",
    dateDay: date ? String(date.day) : ""
  };
}

export type PageEditorProps = Readonly<{
  gmToken: string;
  page: CodexPage;
  pages: readonly CodexPageSummary[];
  /** One list, both directions, both origins. */
  connections: readonly CodexPageConnection[];
  autosave: CodexAutosaveSettings;
  onChange: (page: CodexPage) => void;
  onDeleted: () => void;
  /** Follow a `[[link]]`. Unresolved targets open quick-create rather than creating silently. */
  onNavigate: (target: string) => void;
  /** Jump to the archived fight an auto-logged battle came from. GM-only: archives carry GM narration. */
  onOpenReplay?: (archiveId: number) => void;
  onConnectionsChanged: () => void;
  onOpenConnection: (kind: CodexPageConnection["otherKind"], id: string) => void;
  /** Open a pin on the Atlas (map, then pin). */
  onOpenMarker?: (markerId: string, mapId: string) => void;
  /** Land the Graph on this page's node. */
  onShowInGraph?: (pageId: string) => void;
  onPickTag?: (tag: string) => void;
}>;

export function PageEditor({
  gmToken,
  page,
  pages,
  connections,
  autosave,
  onChange,
  onDeleted,
  onNavigate,
  onOpenReplay,
  onConnectionsChanged,
  onOpenConnection,
  onOpenMarker,
  onShowInGraph,
  onPickTag
}: PageEditorProps) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [draft, setDraft] = useState<Draft>(() => draftOf(page));
  const [revealed, setRevealed] = useState(page.revealedToPlayers);
  const [tab, setTab] = useState<BodyLayer>("player");
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const revRef = useRef(page.rev);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const detailsRef = useRef<HTMLElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(() => {
    try {
      return localStorage.getItem(DETAILS_KEY) === "open";
    } catch {
      return false;
    }
  });
  const showDetails = useCallback((open: boolean) => {
    setDetailsOpen(open);
    try {
      localStorage.setItem(DETAILS_KEY, open ? "open" : "closed");
    } catch {
      /* private mode - fine */
    }
  }, []);
  // Focus the summoned panel itself, so keyboard users land on its heading.
  useEffect(() => {
    if (detailsOpen) detailsRef.current?.focus();
  }, [detailsOpen]);

  /** Autosave at the GM's cadence; when off, the same hook drives Save, the dirty readout and the navigation guards. */
  const save = useCallback(
    async (next: Draft) => {
      const { fields, gmFields } = splitEntityFields(next.entityType, next.fields);
      const updated = await codexApi.updatePage(gmToken, page.id, {
        title: next.title.trim() || "Untitled",
        entityType: next.entityType,
        fields,
        gmFields,
        folder: next.folder.trim() || null,
        tags: next.tags,
        playerBody: next.playerBody,
        gmBody: next.gmBody,
        bannerAssetId: next.bannerAssetId,
        // Only `event` pages send a date. Omitting it leaves the stored date alone, so switching kinds is lossless.
        ...(next.entityType === "event"
          ? {
              inWorldDate: next.dateYear.trim()
                ? {
                    year: Math.trunc(Number(next.dateYear) || 0),
                    month: Number(next.dateMonth || 0),
                    day: Math.max(1, Math.trunc(Number(next.dateDay) || 1))
                  }
                : null
            }
          : {}),
        expectedRev: revRef.current
      });
      revRef.current = updated.rev;
      setSaveError(null);
      onChange(updated);
    },
    [gmToken, page.id, onChange]
  );

  const { status, dirty, flush, markSaved } = useCodexAutosave<Draft>({
    settings: autosave,
    draft,
    save,
    onConflict: async () => {
      try {
        revRef.current = (await codexApi.getPage(gmToken, page.id)).page.rev;
      } catch {
        /* keep stale rev; a later flush retries */
      }
    }
  });

  /**
   * Adopt an external change to this page (e.g. a folder move bumps rev). With no local edits take the
   * server copy so the next save doesn't 409; with unsaved edits the draft wins.
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
  const setBody = (next: string) =>
    setDraft((prev) => ({ ...prev, [tab === "player" ? "playerBody" : "gmBody"]: next }));
  const setField = (key: string, value: string) =>
    setDraft((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  const typeDef = entityDef(draft.entityType);

  const isEvent = draft.entityType === "event";
  const readCalendar = useCallback(() => calendarApi.get(gmToken), [gmToken]);
  const calendar = useCodexQuery(isEvent ? readCalendar : null, { live: false }).data ?? null;
  // The kind-change copy and the History hint name the history setting. A failed read hides the hint.
  const settingsQuery = useCodexQuery(
    useCallback(() => codexApi.getSettings(gmToken), [gmToken]),
    { live: false }
  );
  const settings = settingsQuery.error ? null : (settingsQuery.data ?? null);
  // Read each time History opens.
  const readRevisions = useCallback(() => codexApi.listRevisions(gmToken, page.id), [gmToken, page.id]);
  const revisionsQuery = useCodexQuery(revisionsOpen ? readRevisions : null, { live: false });
  const revisions = revisionsQuery.error ? [] : (revisionsQuery.data ?? []);

  /**
   * Changing a page's kind always confirms, since a conditional dialog gets dismissed unread. A
   * kind-changing save forces a revision server-side, so "restore them from History" is true unless the GM
   * has turned history off, in which case the copy says so.
   */
  const changeKind = async (nextType: EntityType) => {
    if (nextType === draft.entityType) return;
    const keep = new Set(entityDef(nextType).fields.map((field) => field.key));
    const lost = entityDef(draft.entityType)
      .fields.filter((field) => !keep.has(field.key) && (draft.fields[field.key] ?? "").trim())
      .map((field) => field.label);
    const historyOn = settings?.revisionHistory.enabled ?? true;
    const recovery = historyOn
      ? "They will be removed. You can restore them from History."
      : "They will be removed. Version history is off, so this cannot be undone.";
    const ok = await confirm({
      title: `Change kind to ${ENTITY_DEFS[nextType].label}?`,
      body:
        lost.length > 0
          ? `These ${ENTITY_DEFS[draft.entityType].label} fields hold text that ${ENTITY_DEFS[nextType].label} does not use: ${lost.join(", ")}. ${recovery}`
          : `Its fields become ${ENTITY_DEFS[nextType].label} fields. Nothing you have written is lost.`,
      confirmLabel: "Change kind"
    });
    if (!ok) return;
    // Prune the draft the same way the server prunes on save, so the GM never sees a field the next save
    // deletes.
    setDraft((prev) => ({
      ...prev,
      entityType: nextType,
      fields: Object.fromEntries(Object.entries(prev.fields).filter(([key]) => keep.has(key)))
    }));
  };

  const toggleReveal = async (next: boolean) => {
    setRevealed(next);
    // Flush any pending edit first, so revealing never briefly publishes the pre-edit body.
    try {
      await flush();
      const updated = await codexApi.revealPage(gmToken, page.id, next);
      onChange(updated);
    } catch {
      setRevealed(!next);
      setSaveError("Couldn't change who can see this page.");
    }
  };

  const openRevisions = () => {
    setRevisionsOpen(true);
    void settingsQuery.reload();
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
    } catch {
      setSaveError("Couldn't restore that version.");
    }
  };
  const remove = async () => {
    if (
      !(await confirm({
        title: "Delete page",
        body: `Delete "${draft.title || "this page"}"? This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true
      }))
    )
      return;
    try {
      await codexApi.deletePage(gmToken, page.id);
      onDeleted();
    } catch {
      setSaveError("Couldn't delete that page.");
    }
  };
  const uploadBanner = async (file: File | undefined) => {
    if (!file) return;
    try {
      const asset = await uploadCodexAsset(gmToken, file);
      setDraft((prev) => ({ ...prev, bannerAssetId: asset.id }));
    } catch {
      setSaveError("Couldn't upload that image.");
    }
  };

  const tagSuggestions = useMemo(() => [...new Set(pages.flatMap((summary) => summary.tags))].sort(), [pages]);
  const folderCrumbs = draft.folder
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return (
    <div className="codex-editor">
      <div className="codex-editor-head">
        <div className="codex-editor-titlewrap">
          {folderCrumbs.length > 0 && (
            <nav className="codex-crumbs" aria-label="Folder path">
              {folderCrumbs.map((crumb, index) => (
                <span key={index} className="codex-crumb-seg">
                  {index > 0 && <span className="codex-crumb-sep">/</span>}
                  {crumb}
                </span>
              ))}
            </nav>
          )}
          <Input
            variant="title"
            className="codex-title-input"
            value={draft.title}
            placeholder="Untitled page"
            aria-label="Page title"
            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
          />
        </div>
        <div className="codex-editor-actions">
          <SaveState status={status} onRetry={() => void flush()} onReload={() => void flush()} />
          {/* With autosave off, saving is explicit and this view's one primary action. */}
          {!autosave.enabled && (
            <Button variant="primary" size="sm" disabled={!dirty} onClick={() => void flush()}>
              Save
            </Button>
          )}
          <RevealSwitch revealed={revealed} onChange={toggleReveal} ariaLabel="Show this page to players" />
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={detailsOpen}
            aria-controls={DETAILS_ID}
            onClick={() => showDetails(!detailsOpen)}
          >
            Details
          </Button>
          <Button variant="ghost" size="sm" onClick={openRevisions}>
            History
          </Button>
          <Button variant="ghost" size="sm" onClick={remove}>
            Delete
          </Button>
        </div>
      </div>
      {saveError && <Alert tone="danger">{saveError}</Alert>}

      <div className="codex-editor-cols">
        <div className="codex-editor-center">
          <TwoLayerBodyTabs value={tab} onChange={setTab} />

          {/* `fill` makes the editor take the frame's height instead of the primitive's 14rem floor. */}
          <CodexEditor
            token={gmToken}
            value={body}
            onChange={setBody}
            fill
            ariaLabel={BODY_LAYER[tab].label}
            placeholder={
              tab === "player"
                ? "What players can read about this page…"
                : "Hidden from players: hooks, stats, the twist…"
            }
            pages={pages}
            excludePageId={page.id}
            onNavigate={onNavigate}
            gmLayer={tab === "gm"}
          />
        </div>

        {detailsOpen && (
          <aside
            id={DETAILS_ID}
            className="codex-editor-context scroll-y"
            aria-label="Page details"
            tabIndex={-1}
            ref={detailsRef}
            /* Scoped: Escape closes the panel only for keypresses that started inside it. */
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                showDetails(false);
              }
            }}
          >
            <div className="codex-context-head">
              <h3 className="codex-backlinks-title">Page details</h3>
              <IconButton label="Close page details" size="sm" onClick={() => showDetails(false)}>
                <IconX />
              </IconButton>
            </div>
            {draft.bannerAssetId ? (
              <div className="codex-banner">
                <CodexImage
                  assetId={draft.bannerAssetId}
                  token={gmToken}
                  alt="Page banner"
                  className="codex-banner-img"
                />
                <div className="codex-banner-actions">
                  <Button variant="ghost" size="sm" onClick={() => bannerInputRef.current?.click()}>
                    Change
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDraft((prev) => ({ ...prev, bannerAssetId: null }))}
                  >
                    Remove banner
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="codex-banner-add"
                onClick={() => bannerInputRef.current?.click()}
              >
                Add banner image
              </Button>
            )}
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                void uploadBanner(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <div className="codex-meta-row">
              <Field label="Kind" htmlFor="codex-type">
                <Select
                  id="codex-type"
                  value={draft.entityType}
                  onChange={(event) => void changeKind(event.target.value as EntityType)}
                >
                  {ENTITY_TYPE_LIST.map((type) => (
                    <option key={type} value={type}>
                      {ENTITY_DEFS[type].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Folder" htmlFor="codex-folder" help="Use / to nest, e.g. NPCs/Villains">
                <Input
                  id="codex-folder"
                  value={draft.folder}
                  placeholder="Unfiled"
                  onChange={(event) => setDraft((prev) => ({ ...prev, folder: event.target.value }))}
                />
              </Field>
              <Field label="Tags" htmlFor="codex-tags">
                <TagInput
                  id="codex-tags"
                  ariaLabel="Tags"
                  placeholder="town, npc"
                  values={draft.tags}
                  onChange={(next: readonly string[]) => setDraft((prev) => ({ ...prev, tags: next }))}
                  max={24}
                  maxReachedReason="A page may carry at most 24 tags."
                  suggestions={tagSuggestions}
                />
              </Field>
            </div>
            {onPickTag && draft.tags.length > 0 && (
              <div className="codex-editor-tagjumps">
                {draft.tags.map((tag) => (
                  <button key={tag} type="button" className="codex-tag-chip tap-target" onClick={() => onPickTag(tag)}>
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {isEvent && (
              <div className="codex-meta-row codex-event-date">
                <Field label="Year" htmlFor="codex-date-year" help="Places this event on the Journal and the Calendar.">
                  <Input
                    id="codex-date-year"
                    type="number"
                    inputMode="numeric"
                    value={draft.dateYear}
                    placeholder="1492"
                    onChange={(event) => setDraft((prev) => ({ ...prev, dateYear: event.target.value }))}
                  />
                </Field>
                <Field label="Month" htmlFor="codex-date-month">
                  <Select
                    id="codex-date-month"
                    value={draft.dateMonth}
                    disabled={!draft.dateYear.trim()}
                    onChange={(event) => setDraft((prev) => ({ ...prev, dateMonth: event.target.value }))}
                  >
                    {(calendar?.months ?? []).map((month, index) => (
                      <option key={index} value={String(index)}>
                        {month.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Day" htmlFor="codex-date-day">
                  <Input
                    id="codex-date-day"
                    type="number"
                    inputMode="numeric"
                    value={draft.dateDay}
                    placeholder="1"
                    disabled={!draft.dateYear.trim()}
                    onChange={(event) => setDraft((prev) => ({ ...prev, dateDay: event.target.value }))}
                  />
                </Field>
              </div>
            )}

            {typeDef.fields.some((field) => !field.secret) && (
              <div className="codex-fields">
                {typeDef.fields
                  .filter((field) => !field.secret)
                  .map((field) => (
                    <Field
                      key={field.key}
                      label={field.label}
                      htmlFor={`codex-field-${field.key}`}
                      className={field.kind === "textarea" ? "codex-field-wide" : undefined}
                    >
                      {field.kind === "textarea" ? (
                        <Textarea
                          id={`codex-field-${field.key}`}
                          className="codex-field-area"
                          value={draft.fields[field.key] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) => setField(field.key, event.target.value)}
                        />
                      ) : (
                        <Input
                          id={`codex-field-${field.key}`}
                          value={draft.fields[field.key] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) => setField(field.key, event.target.value)}
                        />
                      )}
                    </Field>
                  ))}
              </div>
            )}
            {typeDef.fields.some((field) => field.secret) && (
              <div className="codex-fields codex-fields-secret codex-gm-block">
                <span className="codex-fields-secret-tag">
                  <GmOnlyTag />
                </span>
                {typeDef.fields
                  .filter((field) => field.secret)
                  .map((field) => (
                    <Field
                      key={field.key}
                      label={field.label}
                      htmlFor={`codex-field-${field.key}`}
                      className={field.kind === "textarea" ? "codex-field-wide" : undefined}
                    >
                      {field.kind === "textarea" ? (
                        <Textarea
                          id={`codex-field-${field.key}`}
                          className="codex-field-area"
                          value={draft.fields[field.key] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) => setField(field.key, event.target.value)}
                        />
                      ) : (
                        <Input
                          id={`codex-field-${field.key}`}
                          value={draft.fields[field.key] ?? ""}
                          placeholder={field.placeholder}
                          onChange={(event) => setField(field.key, event.target.value)}
                        />
                      )}
                    </Field>
                  ))}
              </div>
            )}

            {/* Where else does this entity appear: connections, atlas pins, journal and graph. */}
            <section className="codex-connections" aria-labelledby="codex-connections-h">
              <div className="codex-connections-head">
                <h4 className="codex-backlinks-title" id="codex-connections-h">
                  Connections
                </h4>
                {onShowInGraph && (
                  <Button variant="ghost" size="sm" onClick={() => onShowInGraph(page.id)}>
                    Show in graph
                  </Button>
                )}
              </div>
              <ConnectionsPanel
                standalone={false}
                connections={connections}
                onOpen={onOpenConnection}
                write={{ gmToken, pageId: page.id, pages, onChanged: onConnectionsChanged }}
              />
              <PageMarkers gmToken={gmToken} pageId={page.id} onOpenMarker={onOpenMarker} />
              <PageTimeline
                gmToken={gmToken}
                pageId={page.id}
                onOpenReplay={onOpenReplay}
                onOpenEntry={(entryId) => onOpenConnection("journal", entryId)}
              />
            </section>
          </aside>
        )}
      </div>

      {revisionsOpen && (
        <Modal
          open
          onClose={() => setRevisionsOpen(false)}
          title="Version history"
          size="md"
          ariaLabel="Version history"
        >
          {settings && (
            <p className="codex-composer-hint">
              {!settings.revisionHistory.enabled
                ? "Version history is off, so nothing new is being saved. These can still be restored. Change it in Settings."
                : settings.revisionHistory.windowMinutes > 0
                  ? `One version is saved per ${settings.revisionHistory.windowMinutes} minutes, so the newest below can be that far behind the page. Change it in Settings.`
                  : "Every save is kept as a version. Change it in Settings."}
            </p>
          )}
          {revisions.length === 0 ? (
            <p className="codex-preview-empty">No earlier versions.</p>
          ) : (
            <ul className="codex-revisions">
              {revisions.map((revision) => (
                <li key={revision.id} className="codex-revision">
                  <div>
                    <strong>v{revision.rev}</strong> ·{" "}
                    <span className="codex-revision-when">{new Date(revision.authoredAt).toLocaleString()}</span>
                  </div>
                  <div className="codex-revision-title">{revision.title}</div>
                  <Button variant="secondary" size="sm" onClick={() => restore(revision.id)}>
                    Restore
                  </Button>
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
