import type { RefObject } from "react";
import { Button, Field, GmOnlyTag, IconButton, IconX, Input, Select, TagInput, Textarea } from "@vtt/ui";
import type { CodexCalendarMonth, CodexPageConnection, CodexPageSummary } from "@vtt/domain";
import { CodexImage } from "./CodexImage";
import { ConnectionsPanel } from "./ConnectionsPanel";
import { ENTITY_DEFS, ENTITY_TYPE_LIST, entityDef, type EntityType, type FieldDef } from "./entities";
import { InWorldDateFields, type DateDraft } from "./InWorldDateFields";
import { PageMarkers } from "./PageMarkers";
import { PageTimeline } from "./PageTimeline";

/** What the page editor holds while the GM writes. Secret field values sit in `fields` until a save splits them. */
export type PageDraft = DateDraft & {
  title: string;
  entityType: EntityType;
  fields: Record<string, string>;
  folder: string;
  tags: readonly string[];
  playerBody: string;
  gmBody: string;
  bannerAssetId: string | null;
};

/** One input per field, a textarea for the long ones. */
function EntityFieldInputs({
  fields,
  values,
  onChange
}: Readonly<{
  fields: readonly FieldDef[];
  values: Readonly<Record<string, string>>;
  onChange: (key: string, value: string) => void;
}>) {
  return fields.map((field) => (
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
          value={values[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      ) : (
        <Input
          id={`codex-field-${field.key}`}
          value={values[field.key] ?? ""}
          placeholder={field.placeholder}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}
    </Field>
  ));
}

/**
 * The page editor's summoned panel: banner, kind, folder, tags, the event date, the structured fields
 * (secret ones in the GM block) and where else the page appears.
 */
export function PageDetails({
  id,
  panelRef,
  gmToken,
  pageId,
  draft,
  pages,
  connections,
  months,
  tagSuggestions,
  bannerInputRef,
  onChange,
  onFieldChange,
  onKindChange,
  onUploadBanner,
  onClose,
  onConnectionsChanged,
  onOpenConnection,
  onOpenMarker,
  onOpenReplay,
  onShowInGraph,
  onPickTag
}: Readonly<{
  id: string;
  panelRef: RefObject<HTMLElement | null>;
  gmToken: string;
  pageId: string;
  draft: PageDraft;
  pages: readonly CodexPageSummary[];
  connections: readonly CodexPageConnection[];
  /** The calendar's months, for an event's date. */
  months: readonly CodexCalendarMonth[];
  tagSuggestions: readonly string[];
  bannerInputRef: RefObject<HTMLInputElement | null>;
  onChange: (patch: Partial<PageDraft>) => void;
  onFieldChange: (key: string, value: string) => void;
  onKindChange: (type: EntityType) => void;
  onUploadBanner: (file: File) => void;
  onClose: () => void;
  onConnectionsChanged: () => void;
  onOpenConnection: (kind: CodexPageConnection["otherKind"], id: string) => void;
  onOpenMarker?: (markerId: string, mapId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  onShowInGraph?: (pageId: string) => void;
  onPickTag?: (tag: string) => void;
}>) {
  const typeFields = entityDef(draft.entityType).fields;
  const publicFields = typeFields.filter((field) => !field.secret);
  const secretFields = typeFields.filter((field) => field.secret);
  return (
    <aside
      id={id}
      className="codex-editor-context scroll-y"
      aria-label="Page details"
      tabIndex={-1}
      ref={panelRef}
      /* Scoped: Escape closes the panel only for keypresses that started inside it. */
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="codex-context-head">
        <h3 className="codex-backlinks-title">Page details</h3>
        <IconButton label="Close page details" size="sm" onClick={onClose}>
          <IconX />
        </IconButton>
      </div>
      {draft.bannerAssetId ? (
        <div className="codex-banner">
          <CodexImage assetId={draft.bannerAssetId} token={gmToken} alt="Page banner" className="codex-banner-img" />
          <div className="codex-banner-actions">
            <Button variant="ghost" size="sm" onClick={() => bannerInputRef.current?.click()}>
              Change
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onChange({ bannerAssetId: null })}>
              Remove banner
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" size="sm" className="codex-banner-add" onClick={() => bannerInputRef.current?.click()}>
          Add banner image
        </Button>
      )}
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onUploadBanner(file);
          event.target.value = "";
        }}
      />

      <div className="codex-meta-row">
        <Field label="Kind" htmlFor="codex-type">
          <Select
            id="codex-type"
            value={draft.entityType}
            onChange={(event) => onKindChange(event.target.value as EntityType)}
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
            onChange={(event) => onChange({ folder: event.target.value })}
          />
        </Field>
        <Field label="Tags" htmlFor="codex-tags">
          <TagInput
            id="codex-tags"
            ariaLabel="Tags"
            placeholder="town, npc"
            values={draft.tags}
            onChange={(next: readonly string[]) => onChange({ tags: next })}
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

      {draft.entityType === "event" && (
        <div className="codex-meta-row codex-event-date">
          <InWorldDateFields
            idPrefix="codex-date"
            draft={draft}
            months={months}
            onChange={onChange}
            yearHelp="Places this event on the Journal and the Calendar."
          />
        </div>
      )}

      {publicFields.length > 0 && (
        <div className="codex-fields">
          <EntityFieldInputs fields={publicFields} values={draft.fields} onChange={onFieldChange} />
        </div>
      )}
      {secretFields.length > 0 && (
        <div className="codex-fields codex-fields-secret codex-gm-block">
          <span className="codex-fields-secret-tag">
            <GmOnlyTag />
          </span>
          <EntityFieldInputs fields={secretFields} values={draft.fields} onChange={onFieldChange} />
        </div>
      )}

      {/* Where else does this entity appear: connections, atlas pins, journal and graph. */}
      <section className="codex-connections" aria-labelledby="codex-connections-h">
        <div className="codex-connections-head">
          <h4 className="codex-backlinks-title" id="codex-connections-h">
            Connections
          </h4>
          {onShowInGraph && (
            <Button variant="ghost" size="sm" onClick={() => onShowInGraph(pageId)}>
              Show in graph
            </Button>
          )}
        </div>
        <ConnectionsPanel
          standalone={false}
          connections={connections}
          onOpen={onOpenConnection}
          write={{ gmToken, pageId, pages, onChanged: onConnectionsChanged }}
        />
        <PageMarkers gmToken={gmToken} pageId={pageId} onOpenMarker={onOpenMarker} />
        <PageTimeline
          gmToken={gmToken}
          pageId={pageId}
          onOpenReplay={onOpenReplay}
          onOpenEntry={(entryId) => onOpenConnection("journal", entryId)}
        />
      </section>
    </aside>
  );
}
