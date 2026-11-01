import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  Eyebrow,
  Field,
  IconMore,
  IconPlus,
  Input,
  Menu,
  MenuItem,
  SaveState,
  Select,
  TagInput,
  Textarea,
  cx,
  AudienceChip,
  EVERYONE,
  Group,
  IconEye,
  SegmentedControl,
  HIDDEN,
  type Audience,
  TitleLine
} from "@vtt/ui";
import { useConfirm } from "../../components/feedback";
import { calendarApi, codexApi, uploadCodexAsset } from "../api";
import { pageRecordApi } from "../api-records";
import type { CodexBlock, CodexPage, CodexPageConnection } from "@vtt/domain";
import { CodexImage } from "../CodexImage";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityDef, type EntityType } from "../entities";
import { dateDraftOf, dateOfDraft, InWorldDateFields, type DateDraft } from "../InWorldDateFields";
import { PageTimeline } from "../PageTimeline";
import { RevisionHistory } from "../RevisionHistory";
import { useCodexAutosave } from "../autosave";
import { atlasPath, journalEntryPath, relationshipsPath } from "../routes";
import { CodexPhoneBar } from "../shell/PhoneBar";
import { useCodexShell, useGmCodex } from "../shell/context";
import { useCodexQuery } from "../useCodexQuery";
import { DocEditor } from "./DocEditor";
import { draftDocument, saveShape, type DraftItem } from "./document";
import { KindChip, PageCrumb } from "./pageParts";
import { PlayerPageBody } from "./PlayerPage";
import { SeeAsControl, usePreviewToken, type SeeAsViewer } from "./SeeAs";
import type { AnyPageConnection } from "./MetaPanel";
import { RelationshipEditor } from "./RelationshipEditor";

type WriterDraft = DateDraft &
  Readonly<{
    title: string;
    entityType: EntityType;
    fields: Readonly<Record<string, string>>;
    folder: string;
    tags: readonly string[];
    bannerAssetId: string | null;
    items: readonly DraftItem[];
  }>;

function draftOf(page: CodexPage): WriterDraft {
  return {
    title: page.title,
    entityType: page.entityType,
    fields: page.fields,
    folder: page.folder ?? "",
    tags: page.tags,
    bannerAssetId: page.bannerAssetId,
    items: draftDocument(page.playerBody, page.blocks),
    ...dateDraftOf(page.inWorldDate)
  };
}

/** What makes a draft dirty: its content, never the ids the server hands back for new blocks. */
function serialize(draft: WriterDraft): string {
  const shape = saveShape(draft.items);
  return JSON.stringify({
    ...draft,
    items: undefined,
    body: shape.playerBody,
    blocks: shape.blocks.map((block) => [block.key, block.title.trim(), block.text.trim(), block.anchor])
  });
}

/**
 * The page in writing: the document with its hidden blocks in place, and beside it the fields, each with Who sees it
 * on the same line, the relationships and the page's details. It saves at the GM's autosave cadence; a reveal is its
 * own write and never waits on a save.
 */
export function PageWriter({
  page,
  connections,
  onSaved,
  onConnectionsChanged,
  onDone,
  onReloadPage,
  onRevealBlock,
  onBlockAudience,
  onOpenConnection,
  onOpenPin
}: Readonly<{
  page: CodexPage;
  connections: readonly CodexPageConnection[];
  onSaved: (page: CodexPage) => void;
  onConnectionsChanged: () => void;
  onDone: () => void;
  onReloadPage: () => Promise<void>;
  onRevealBlock: (block: CodexBlock) => void;
  onBlockAudience: (block: CodexBlock, next: Audience) => void;
  onOpenConnection: (kind: AnyPageConnection["otherKind"], id: string) => void;
  onOpenPin: (markerId: string, mapId: string) => void;
}>) {
  const { token, phone, go } = useCodexShell();
  const gm = useGmCodex();
  const { party, feeds } = gm;
  const { confirm, dialog } = useConfirm();
  const [draft, setDraft] = useState<WriterDraft>(() => draftOf(page));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [shownKeys, setShownKeys] = useState<readonly string[]>([]);
  // Preview shows the page as players get it, through the same read See as players uses (Codex frame 2.3).
  const [preview, setPreview] = useState<{ on: boolean; viewer: SeeAsViewer }>({
    on: false,
    viewer: { characterId: null }
  });
  const previewToken = usePreviewToken(token, preview.on, preview.viewer);
  /** Where the caret was when Preview came on, so turning it off goes back there. */
  const caret = useRef<HTMLElement | null>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  /** The page as the server last answered, so each write in a save carries the newest `rev`. */
  const latest = useRef(page);
  latest.current = page.rev >= latest.current.rev ? page : latest.current;
  /** The ids the server gave blocks written in this sitting, by their editor key. */
  const created = useRef(new Map<string, string>());

  const save = useCallback(
    async (next: WriterDraft) => {
      const shape = saveShape(next.items);
      let current = latest.current;
      const idOf = (block: (typeof shape.blocks)[number]) => block.id ?? created.current.get(block.key) ?? null;
      const keep = new Set(shape.blocks.map(idOf).filter((id): id is string => id !== null));
      for (const block of current.blocks)
        if (!keep.has(block.id)) current = await pageRecordApi.blocks.remove(token, page.id, block.id);
      for (const block of shape.blocks) {
        const id = idOf(block);
        const title = block.title.trim() || null;
        if (!id) {
          const added = await pageRecordApi.blocks.add(token, page.id, {
            anchor: block.anchor,
            title,
            text: block.text,
            expectedRev: current.rev
          });
          current = added.record;
          created.current.set(block.key, added.blockId);
          continue;
        }
        const server = current.blocks.find((candidate) => candidate.id === id);
        if (server && ((server.title ?? null) !== title || server.text !== block.text))
          current = await pageRecordApi.blocks.update(token, page.id, id, {
            title,
            text: block.text,
            expectedRev: current.rev
          });
      }
      current = await pageRecordApi.update(token, page.id, {
        title: next.title.trim() || "Untitled",
        entityType: next.entityType,
        fields: next.fields,
        folder: next.folder.trim() || null,
        tags: next.tags,
        playerBody: shape.playerBody,
        layout: shape.blocks.map((block) => ({ id: idOf(block) ?? "", anchor: block.anchor })),
        bannerAssetId: next.bannerAssetId,
        // Only an event sends a date; leaving it out keeps the stored one, so changing the kind loses nothing.
        ...(next.entityType === "event" ? { inWorldDate: dateOfDraft(next) } : {}),
        expectedRev: current.rev
      });
      latest.current = current;
      setError(null);
      onSaved(current);
    },
    [token, page.id, onSaved]
  );
  const autosave = useCodexAutosave<WriterDraft>({
    settings: gm.autosave,
    draft,
    serialize,
    save,
    onConflict: async () => {
      await onReloadPage();
      setError("Someone else changed this page. Your text is kept; it saves again with your next change.");
    }
  });

  const isEvent = draft.entityType === "event";
  const readCalendar = useCallback(() => calendarApi.get(token), [token]);
  const calendar = useCodexQuery(isEvent ? readCalendar : null, { live: false }).data ?? null;
  const tagSuggestions = useMemo(
    () => [...new Set(feeds.pages.flatMap((summary) => summary.tags))].sort(),
    [feeds.pages]
  );
  const pages = useMemo(
    () => feeds.pages.map((summary) => ({ id: summary.id, title: summary.title, entityType: summary.entityType })),
    [feeds.pages]
  );
  const serverBlocks = useMemo(() => new Map(page.blocks.map((block) => [block.id, block])), [page.blocks]);

  const setField = (key: string, value: string) =>
    setDraft((prev) => ({ ...prev, fields: { ...prev.fields, [key]: value } }));
  const setFieldHidden = async (key: string, hidden: boolean) => {
    try {
      // A value not yet saved goes first, so the audience lands on a field the server has.
      await autosave.flush();
      onSaved(await pageRecordApi.setFieldAudience(token, page.id, key, hidden ? "hidden" : "everyone"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't change who sees that field.");
    }
  };

  /** Changing a page's kind always confirms, and says which written fields the new kind has no place for. */
  const changeKind = async (nextType: EntityType) => {
    if (nextType === draft.entityType) return;
    const keepKeys = new Set(entityDef(nextType).fields.map((field) => field.key));
    const lost = entityDef(draft.entityType)
      .fields.filter((field) => !keepKeys.has(field.key) && (draft.fields[field.key] ?? "").trim())
      .map((field) => field.label);
    // A kind-changing save keeps a version on the server, so the promise holds unless the GM turned history off.
    const historyOn = feeds.settingsFeed.data?.revisionHistory.enabled ?? true;
    const recovery = historyOn
      ? "they will be removed, and Version history can restore them."
      : "they will be removed for good, since Version history is off.";
    const ok = await confirm({
      title: `Change kind to ${ENTITY_DEFS[nextType].label}?`,
      body:
        lost.length > 0
          ? `These ${ENTITY_DEFS[draft.entityType].label} fields hold text that ${ENTITY_DEFS[nextType].label} does not use, ${lost.join(", ")}, and ${recovery}`
          : `Its fields become ${ENTITY_DEFS[nextType].label} fields, and nothing you have written is lost.`,
      confirmLabel: "Change kind"
    });
    if (!ok) return;
    setDraft((prev) => ({
      ...prev,
      entityType: nextType,
      fields: Object.fromEntries(Object.entries(prev.fields).filter(([key]) => keepKeys.has(key)))
    }));
  };

  const uploadBanner = async (file: File) => {
    try {
      const asset = await uploadCodexAsset(token, file);
      setDraft((prev) => ({ ...prev, bannerAssetId: asset.id }));
    } catch {
      setError("Couldn't upload that image.");
    }
  };

  const restore = async (revisionId: number) => {
    try {
      await autosave.flush();
      const restored = await codexApi.restoreRevision(token, page.id, revisionId);
      const next = draftOf(restored as unknown as CodexPage);
      setDraft(next);
      autosave.markSaved(next);
      setHistoryOpen(false);
      await onReloadPage();
    } catch {
      setError("Couldn't restore that version.");
    }
  };

  const done = async () => {
    setBusy(true);
    await autosave.flush();
    setBusy(false);
    onDone();
  };
  /** Preview saves what is written first, as autosave does; a save that fails or conflicts keeps the writer. */
  const showPreview = async (on: boolean, viewer: SeeAsViewer) => {
    if (!on) {
      setPreview({ on: false, viewer });
      const back = caret.current;
      requestAnimationFrame(() => back?.isConnected && back.focus());
      return;
    }
    if (!preview.on) {
      const active = document.activeElement;
      caret.current = active instanceof HTMLElement && active.closest(".cx-doc") ? active : null;
      setBusy(true);
      const ok = await autosave.flush();
      setBusy(false);
      if (!ok) return;
    }
    setPreview({ on: true, viewer });
  };
  const viewerName = preview.viewer.characterId
    ? (party.find((character) => character.id === preview.viewer.characterId)?.name ?? "a character")
    : null;
  const previewSwitch = (
    <SeeAsControl
      label="Preview"
      on={preview.on}
      viewer={preview.viewer}
      party={party}
      onChange={(on, viewer) => void showPreview(on, viewer)}
    />
  );
  const previewLine = preview.on && (
    <p className="cx-preview-line" role="status">
      <IconEye />
      Preview: the page as players get it. Hidden blocks and hidden fields are left out. Turn Preview off to keep
      writing.
    </p>
  );
  const previewBody = preview.on && (
    <PlayerPageBody
      key={previewToken.token ?? "waiting"}
      token={previewToken.token}
      tokenError={previewToken.error}
      pageId={page.id}
      viewerName={viewerName}
      phone={phone}
      onOpenConnection={onOpenConnection}
      onOpenPin={onOpenPin}
    />
  );

  const kindFields = entityDef(draft.entityType).fields;
  const shown = kindFields.filter(
    (field) => (draft.fields[field.key] ?? "").trim() !== "" || shownKeys.includes(field.key)
  );
  const unshown = kindFields.filter((field) => !shown.includes(field));

  const fieldsPanel = (
    <Group title="Fields · who sees each" className="cx-writefields">
      {shown.map((field) => {
        const hidden = page.hiddenFields.includes(field.key);
        const id = `cx-field-${field.key}`;
        return (
          <div key={field.key} className={cx("cx-writefield", hidden && "is-hidden")}>
            <label className="cx-writefield-label" htmlFor={id}>
              {field.label}
            </label>
            {field.kind === "textarea" ? (
              <Textarea
                id={id}
                rows={2}
                value={draft.fields[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) => setField(field.key, event.target.value)}
              />
            ) : (
              <Input
                id={id}
                value={draft.fields[field.key] ?? ""}
                placeholder={field.placeholder}
                onChange={(event) => setField(field.key, event.target.value)}
              />
            )}
            <WhoSeesField
              field={field.label}
              hidden={hidden}
              onChange={(next) => void setFieldHidden(field.key, next)}
            />
          </div>
        );
      })}
      {unshown.length > 0 && (
        <Menu
          label="Add a field"
          triggerClassName="cx-writefields-add"
          trigger={
            <>
              <IconPlus /> Add a field
            </>
          }
        >
          {unshown.map((field) => (
            <MenuItem key={field.key} onClick={() => setShownKeys((keys) => [...keys, field.key])}>
              {field.label}
            </MenuItem>
          ))}
        </Menu>
      )}
    </Group>
  );

  const details = (
    <section className="cx-writedetails" aria-label="Details">
      <Eyebrow>Details</Eyebrow>
      <Field label="Kind" htmlFor="cx-write-kind">
        <Select
          id="cx-write-kind"
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
      <Field label="Folder" htmlFor="cx-write-folder" help="Your own filing. Players never see it. Use / to nest.">
        <Input
          id="cx-write-folder"
          value={draft.folder}
          placeholder="Unfiled"
          onChange={(event) => setDraft((prev) => ({ ...prev, folder: event.target.value }))}
        />
      </Field>
      <Field label="Tags" htmlFor="cx-write-tags">
        <TagInput
          id="cx-write-tags"
          ariaLabel="Tags"
          placeholder="harbour, npc"
          values={draft.tags}
          onChange={(next: readonly string[]) => setDraft((prev) => ({ ...prev, tags: next }))}
          max={24}
          maxReachedReason="A page may carry at most 24 tags."
          suggestions={tagSuggestions}
        />
      </Field>
      {isEvent && (
        <div className="cx-writedetails-date">
          <InWorldDateFields
            idPrefix="cx-write-date"
            draft={draft}
            months={calendar?.months ?? []}
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
            yearHelp="Places this event on the timeline and the calendar."
          />
        </div>
      )}
      {draft.bannerAssetId ? (
        <div className="cx-writedetails-banner">
          <CodexImage assetId={draft.bannerAssetId} token={token} alt="Page banner" className="cx-banner-img" />
          <div className="cx-writedetails-row">
            <Button size="sm" onClick={() => bannerInput.current?.click()}>
              Change banner
            </Button>
            <Button size="sm" onClick={() => setDraft((prev) => ({ ...prev, bannerAssetId: null }))}>
              Remove banner
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => bannerInput.current?.click()}>
          Add a banner image
        </Button>
      )}
      <input
        ref={bannerInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadBanner(file);
          event.target.value = "";
        }}
      />
    </section>
  );

  const side = (
    <>
      {fieldsPanel}
      <RelationshipEditor
        pageId={page.id}
        pageTitle={draft.title || page.title}
        connections={connections}
        pages={pages}
        onChanged={onConnectionsChanged}
        onOpen={onOpenConnection}
      />
      {details}
      <PageTimeline
        gmToken={token}
        pageId={page.id}
        onOpenReplay={gm.onOpenReplay}
        onOpenEntry={(entryId) => go(journalEntryPath(entryId))}
      />
    </>
  );

  const editor = (
    <DocEditor
      items={draft.items}
      onChange={(items) => setDraft((prev) => ({ ...prev, items }))}
      serverBlocks={serverBlocks}
      party={party}
      phone={phone}
      pages={pages}
      excludePageId={page.id}
      busy={busy}
      onCreatePage={(title) => gm.quickCreate({ title, stay: true })}
      onReveal={onRevealBlock}
      onAudience={onBlockAudience}
      onOpenMap={() => go(atlasPath(null))}
    />
  );

  const saveState = (
    <>
      <SaveState
        className="cx-write-saved"
        status={autosave.status}
        onRetry={() => void autosave.flush()}
        onReload={() => void onReloadPage()}
      />
      {!gm.autosave.enabled && (
        <Button size="sm" disabled={!autosave.dirty} onClick={() => void autosave.flush()}>
          Save
        </Button>
      )}
    </>
  );
  const doneButton = (
    <Button variant="primary" size="sm" disabled={busy} onClick={() => void done()}>
      Done
    </Button>
  );
  const more = (
    <Menu icon align="end" label="More" trigger={<IconMore />}>
      <MenuItem onClick={() => setHistoryOpen(true)}>Version history</MenuItem>
      <MenuItem onClick={() => go(relationshipsPath(page.id))}>Show in Relationships</MenuItem>
    </Menu>
  );
  const overlays = (
    <>
      {historyOpen && (
        <RevisionHistory
          gmToken={token}
          pageId={page.id}
          onRestore={(revisionId) => void restore(revisionId)}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {dialog}
    </>
  );

  if (phone)
    return (
      <div className="cx-page is-phone is-writing">
        <CodexPhoneBar title={`Editing ${draft.title || "Untitled page"}`} actions={saveState} />
        <SegmentedControl
          ariaLabel="Write or preview"
          className="cx-write-seg"
          value={preview.on ? "preview" : "write"}
          onChange={(value) => void showPreview(value === "preview", preview.viewer)}
          options={[
            { value: "write", label: "Write" },
            { value: "preview", label: "Preview" }
          ]}
        />
        {previewLine}
        <div className="cx-page-phonebody scroll-y">
          {error && <Alert tone="danger">{error}</Alert>}
          {previewBody}
          <div className="cx-write-body" hidden={preview.on}>
            <Input
              variant="title"
              className="cx-write-title"
              aria-label="Page title"
              value={draft.title}
              placeholder="Untitled page"
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            />
            {editor}
            {side}
          </div>
        </div>
        {/* Done stays at the foot on a phone (rule 3.9). */}
        <div className="cx-write-foot">{doneButton}</div>
        {overlays}
      </div>
    );

  return (
    <div className="cx-page is-writing">
      <header className="cx-page-head">
        <div className="cx-page-headmain">
          <TitleLine className="cx-page-titlerow" crumb={<PageCrumb entityType={draft.entityType} go={go} />}>
            <Input
              variant="title"
              className="cx-write-title"
              aria-label="Page title"
              value={draft.title}
              placeholder="Untitled page"
              onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
            />
          </TitleLine>
          <div className="cx-visline">
            <KindChip type={draft.entityType} />
            <AudienceChip value={page.revealedToPlayers ? EVERYONE : HIDDEN} party={party} />
          </div>
        </div>
        <div className="cx-page-actions">
          {previewSwitch}
          {saveState}
          {doneButton}
          {more}
        </div>
      </header>
      {previewLine}
      {error && (
        <div className="cx-page-notice">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {previewBody}
      {/* The writer stays mounted under Preview, so turning it off returns to the same text and caret. */}
      <div className="cx-page-cols is-writing" hidden={preview.on}>
        <div className="cx-page-docscroll scroll-y">
          <div className="cx-doc">{editor}</div>
        </div>
        <aside className="cx-page-meta scroll-y" aria-label="Fields and relationships">
          {side}
        </aside>
      </div>
      {overlays}
    </div>
  );
}

/** A field's audience as a pair of Base line options, Everyone and Hidden, Hidden in violet (Codex frame 2.3). */
function WhoSeesField({
  field,
  hidden,
  onChange
}: Readonly<{ field: string; hidden: boolean; onChange: (hidden: boolean) => void }>) {
  return (
    <span className="cx-whopair" role="radiogroup" aria-label={`Who sees ${field}`}>
      <button
        type="button"
        role="radio"
        aria-checked={!hidden}
        className={cx("cx-whopair-option", !hidden && "is-on")}
        onClick={() => hidden && onChange(false)}
      >
        Everyone
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={hidden}
        className={cx("cx-whopair-option", "is-hidden", hidden && "is-on")}
        onClick={() => !hidden && onChange(true)}
      >
        Hidden
      </button>
    </span>
  );
}
