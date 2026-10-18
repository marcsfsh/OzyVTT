import { useMemo, useRef, useState } from "react";
import { Badge, Button, Field, IconPlus, Input, Modal, Select, Switch, TagInput } from "@vtt/ui";
import type { CodexMap, CodexMapKind } from "@vtt/domain";
import type { MapAsset } from "../api";
import { FieldAudienceToggle } from "../shared/WhoSeesIt";

const MAP_KINDS: ReadonlyArray<{ value: CodexMapKind; label: string }> = [
  { value: "world", label: "World" },
  { value: "regional", label: "Regional" },
  { value: "battlemap", label: "Battle map" }
];

/** One map's settings, in the atlas's Details: who sees it, its name, kind and place, its tags, and Delete. */
export function MapDetails({
  map,
  maps,
  tagSuggestions,
  placingPin,
  onReveal,
  onRename,
  onRetype,
  onReparent,
  onRetag,
  onAddPin,
  onAddMap,
  onDelete
}: Readonly<{
  map: CodexMap;
  maps: readonly CodexMap[];
  tagSuggestions: readonly string[];
  placingPin: boolean;
  onReveal: (revealed: boolean) => void;
  onRename: (name: string) => void;
  onRetype: (kind: CodexMapKind) => void;
  onReparent: (parentMapId: string | null) => void;
  onRetag: (tags: readonly string[]) => void;
  onAddPin: () => void;
  onAddMap: () => void;
  onDelete: () => void;
}>) {
  const [name, setName] = useState(map.name);
  const [shownFor, setShownFor] = useState(map.id);
  // Another map, or a rename from elsewhere, starts the box from the stored name.
  if (shownFor !== map.id) {
    setShownFor(map.id);
    setName(map.name);
  }
  const rename = () => {
    const next = name.trim();
    if (next && next !== map.name) onRename(next);
  };
  // Left out of Sits inside, so a map can't move into its own subtree; the server refuses it too.
  const descendantIds = useMemo(() => {
    const out = new Set<string>();
    const walk = (parentId: string) => {
      for (const each of maps)
        if (each.parentMapId === parentId && !out.has(each.id)) {
          out.add(each.id);
          walk(each.id);
        }
    };
    walk(map.id);
    return out;
  }, [maps, map.id]);

  return (
    <div className="atlas-details">
      <div className="atlas-field-inline">
        <Field label="Name" htmlFor="map-name">
          <Input
            id="map-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={rename}
            onKeyDown={(event) => {
              if (event.key === "Enter") rename();
            }}
          />
        </Field>
        <FieldAudienceToggle
          field="this map"
          hidden={!map.revealedToPlayers}
          onChange={(hidden) => onReveal(!hidden)}
        />
      </div>
      <Field label="Kind" htmlFor="map-kind">
        <Select id="map-kind" value={map.kind} onChange={(event) => onRetype(event.target.value as CodexMapKind)}>
          {MAP_KINDS.map((kind) => (
            <option key={kind.value} value={kind.value}>
              {kind.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Sits inside" htmlFor="map-parent" help="Maps nested under this one move with it.">
        <Select
          id="map-parent"
          value={map.parentMapId ?? ""}
          onChange={(event) => onReparent(event.target.value || null)}
        >
          <option value="">Top level</option>
          {maps
            .filter((each) => each.id !== map.id && !descendantIds.has(each.id))
            .map((each) => (
              <option key={each.id} value={each.id}>
                {each.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field label="Tags" htmlFor="map-tags">
        <TagInput
          id="map-tags"
          ariaLabel="Tags"
          placeholder="underdark, faerun"
          values={map.tags}
          onChange={onRetag}
          max={24}
          maxReachedReason="A map may carry at most 24 tags."
          suggestions={tagSuggestions}
        />
      </Field>
      <div className="atlas-details-actions">
        <Button variant="secondary" size="sm" aria-pressed={placingPin} onClick={onAddPin}>
          <IconPlus /> {placingPin ? "Placing a pin" : "Add a pin"}
        </Button>
        <Button variant="secondary" size="sm" onClick={onAddMap}>
          <IconPlus /> Add a map
        </Button>
      </div>
      <div className="atlas-details-danger">
        <Button variant="ghost" size="sm" onClick={onDelete}>
          Delete map
        </Button>
      </div>
    </div>
  );
}

/** Picks an image from the shared map library, the one Scenes uses, and adds it as a map. */
export function MapPicker({
  open,
  currentMap,
  nest,
  onNestChange,
  assets,
  uploading,
  onUpload,
  onPick,
  onClose
}: Readonly<{
  open: boolean;
  /** The open map, which a new map nests under by default. */
  currentMap: CodexMap | null;
  nest: boolean;
  onNestChange: (nest: boolean) => void;
  assets: readonly MapAsset[];
  uploading: boolean;
  onUpload: (file: File) => void;
  onPick: (asset: MapAsset) => void;
  onClose: () => void;
}>) {
  const uploadInputRef = useRef<HTMLInputElement>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={currentMap && nest ? `Add a map inside ${currentMap.name}` : "Add a map"}
      size="md"
      ariaLabel="Choose a map"
    >
      {currentMap && (
        <div className="atlas-nestrow">
          <Switch checked={nest} onChange={onNestChange} label={`Nest inside "${currentMap.name}"`} />
          <p className="atlas-hint">
            {nest ? (
              <>
                The new map sits inside <strong>{currentMap.name}</strong>, under its Maps inside.
              </>
            ) : (
              <>The new map is added at the top level.</>
            )}
          </p>
        </div>
      )}
      <div className="atlas-upload">
        <Button variant="secondary" size="sm" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
          <IconPlus /> {uploading ? "Uploading…" : "Upload a map image"}
        </Button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onUpload(file);
            event.target.value = "";
          }}
        />
      </div>
      {assets.length === 0 ? (
        <p className="atlas-empty">No map images yet. Upload one to start your atlas. Scenes uses the same images.</p>
      ) : (
        <div className="atlas-assetgrid">
          {assets.map((asset) => (
            <button key={asset.id} type="button" className="atlas-assetcard" onClick={() => onPick(asset)}>
              <span className="atlas-ellipsis">{asset.name}</span>
              <Badge tone="neutral">{asset.kind}</Badge>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
