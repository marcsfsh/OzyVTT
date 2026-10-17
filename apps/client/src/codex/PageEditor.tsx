import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input, RevealSwitch, SaveState } from "@vtt/ui";
import type { CodexAutosaveSettings, CodexPage, CodexPageConnection, CodexPageSummary } from "@vtt/domain";
import { calendarApi, codexApi, uploadCodexAsset } from "./api";
import { CodexEditor } from "./CodexEditor";
import { BODY_LAYER, TwoLayerBodyTabs, type BodyLayer } from "./TwoLayerBodyTabs";
import { dateDraftOf, dateOfDraft } from "./InWorldDateFields";
import { PageDetails, type PageDraft } from "./PageDetails";
import { RevisionHistory } from "./RevisionHistory";
import { useCodexAutosave } from "./autosave";
import { useConfirm } from "../components/feedback";
import { useCodexQuery } from "./useCodexQuery";
import { ENTITY_DEFS, entityDef, splitEntityFields, type EntityType } from "./entities";

/**
 * The page editor. The centre column holds only the body being written; properties and connections live
 * in a summoned overlay panel (not a `Drawer`, which would fight the shell's Session prep drawer).
 * The panel's open state is remembered per browser and starts closed.
 */
const DETAILS_KEY = "codex-page-details";
const DETAILS_ID = "codex-page-details";

function draftOf(page: CodexPage): PageDraft {
  return {
    title: page.title,
    entityType: page.entityType,
    fields: { ...page.fields, ...page.gmFields },
    folder: page.folder ?? "",
    tags: page.tags,
    playerBody: page.playerBody,
    gmBody: page.gmBody,
    bannerAssetId: page.bannerAssetId,
    // The raw date the GM typed, still valid if the calendar changed.
    ...dateDraftOf(page.inWorldDate)
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
  /** Follow a `[[link]]`. Unresolved targets open quick-create, and nothing is created silently. */
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
  const [draft, setDraft] = useState<PageDraft>(() => draftOf(page));
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
      /* private mode: fine */
    }
  }, []);
  // Focus the summoned panel itself, so keyboard users land on its heading.
  useEffect(() => {
    if (detailsOpen) detailsRef.current?.focus();
  }, [detailsOpen]);

  /** Autosave at the GM's cadence; when off, the same hook drives Save, the dirty readout and the navigation guards. */
  const save = useCallback(
    async (next: PageDraft) => {
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
        ...(next.entityType === "event" ? { inWorldDate: dateOfDraft(next) } : {}),
        expectedRev: revRef.current
      });
      revRef.current = updated.rev;
      setSaveError(null);
      onChange(updated);
    },
    [gmToken, page.id, onChange]
  );

  const { status, dirty, flush, markSaved } = useCodexAutosave<PageDraft>({
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
  const isEvent = draft.entityType === "event";
  const readCalendar = useCallback(() => calendarApi.get(gmToken), [gmToken]);
  const calendar = useCodexQuery(isEvent ? readCalendar : null, { live: false }).data ?? null;
  // The kind-change copy names the history setting, so read it once when the editor mounts.
  const settings = useCodexQuery(
    useCallback(() => codexApi.getSettings(gmToken), [gmToken]),
    { live: false }
  ).data;

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
  const uploadBanner = async (file: File) => {
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
          <RevealSwitch revealed={revealed} onChange={toggleReveal} ariaLabel="Show this page to players" labelled />
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={detailsOpen}
            aria-controls={DETAILS_ID}
            onClick={() => showDetails(!detailsOpen)}
          >
            Details
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRevisionsOpen(true)}>
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

          {/* `fill` makes the editor take the frame's height in place of the primitive's 14rem floor. */}
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
            /* The pages view's link handler opens quick-create for a title no page has. */
            onCreatePage={onNavigate}
            gmLayer={tab === "gm"}
          />
        </div>

        {detailsOpen && (
          <PageDetails
            id={DETAILS_ID}
            panelRef={detailsRef}
            gmToken={gmToken}
            pageId={page.id}
            draft={draft}
            pages={pages}
            connections={connections}
            months={calendar?.months ?? []}
            tagSuggestions={tagSuggestions}
            bannerInputRef={bannerInputRef}
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            onFieldChange={setField}
            onKindChange={(type) => void changeKind(type)}
            onUploadBanner={(file) => void uploadBanner(file)}
            onClose={() => showDetails(false)}
            onConnectionsChanged={onConnectionsChanged}
            onOpenConnection={onOpenConnection}
            onOpenMarker={onOpenMarker}
            onOpenReplay={onOpenReplay}
            onShowInGraph={onShowInGraph}
            onPickTag={onPickTag}
          />
        )}
      </div>

      {revisionsOpen && (
        <RevisionHistory
          gmToken={gmToken}
          pageId={page.id}
          onRestore={(revisionId) => void restore(revisionId)}
          onClose={() => setRevisionsOpen(false)}
        />
      )}

      {confirmDialog}
    </div>
  );
}
