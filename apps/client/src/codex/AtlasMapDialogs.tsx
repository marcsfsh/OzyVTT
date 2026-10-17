import { useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Field, IconPlus, Input, Modal, Select, Switch, TagInput } from "@vtt/ui";
import type { CodexMap, CodexMapKind } from "@vtt/domain";
import type { MapAsset } from "./api";

/** The Atlas's two dialogs: adding a map from the image library, and one map's settings. */

const MAP_KINDS: ReadonlyArray<{ value: CodexMapKind; label: string }> = [
  { value: "world", label: "World" },
  { value: "regional", label: "Regional" },
  { value: "battlemap", label: "Battle map" }
];

/** Picks an image from the shared map library (the one Scenes uses) and adds it as a map. */
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
      title={currentMap && nest ? `Add a sub-map under ${currentMap.name}` : "Add a map"}
      size="md"
      ariaLabel="Choose a map"
    >
      {currentMap && (
        <div className="codex-atlas-nestrow">
          <Switch checked={nest} onChange={onNestChange} label={`Nest inside "${currentMap.name}"`} />
          <p className="codex-inspector-hint">
            {nest ? (
              <>
                The new map sits inside <strong>{currentMap.name}</strong>, and you can drill into it from here.
              </>
            ) : (
              <>The new map is added at the top level.</>
            )}
          </p>
        </div>
      )}
      <div className="codex-atlas-upload">
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
        <p className="codex-list-empty">
          No map images yet. Upload one to start your atlas. Scenes uses the same image library.
        </p>
      ) : (
        <div className="codex-asset-grid">
          {assets.map((asset) => (
            <button key={asset.id} type="button" className="codex-asset-card" onClick={() => onPick(asset)}>
              <span className="codex-asset-name">{asset.name}</span>
              <Badge tone="neutral">{asset.kind}</Badge>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** One map's name, kind, place in the atlas and tags. Every write is immediate; the name saves on blur. */
export function MapSettings({
  open,
  map,
  maps,
  tagSuggestions,
  error,
  onRename,
  onRetype,
  onReparent,
  onRetag,
  onDelete,
  onClose
}: Readonly<{
  open: boolean;
  map: CodexMap | null;
  maps: readonly CodexMap[];
  tagSuggestions: readonly string[];
  /** The page's Alert is behind the overlay, so errors show here too. */
  error: string | null;
  onRename: (name: string) => void;
  onRetype: (kind: CodexMapKind) => void;
  onReparent: (parentMapId: string | null) => void;
  onRetag: (tags: readonly string[]) => void;
  onDelete: () => void;
  onClose: () => void;
}>) {
  const [name, setName] = useState(map?.name ?? "");
  // Each opening starts from the map's stored name.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && map) setName(map.name);
  }
  const rename = () => {
    const next = name.trim();
    if (map && next && next !== map.name) onRename(next);
  };
  // Excluded from "Sits inside" so a map can't be moved into its own subtree (the server also guards).
  const descendantIds = useMemo(() => {
    const out = new Set<string>();
    const walk = (parentId: string) => {
      for (const each of maps)
        if (each.parentMapId === parentId && !out.has(each.id)) {
          out.add(each.id);
          walk(each.id);
        }
    };
    if (map) walk(map.id);
    return out;
  }, [maps, map]);

  return (
    <Modal
      open={open && !!map}
      onClose={() => {
        rename();
        onClose();
      }}
      title="Map settings"
      size="sm"
      ariaLabel="Map settings"
    >
      {map && (
        <div className="codex-map-settings">
          {error && <Alert tone="danger">{error}</Alert>}
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
          <Field
            label="Kind"
            htmlFor="map-kind"
            help="Where this map sits in the atlas: a world, a region within a world, or a local place."
          >
            <Select id="map-kind" value={map.kind} onChange={(event) => onRetype(event.target.value as CodexMapKind)}>
              {MAP_KINDS.map((kind) => (
                <option key={kind.value} value={kind.value}>
                  {kind.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Sits inside"
            htmlFor="map-parent"
            help="Move this map elsewhere in the atlas. Any maps nested under it move with it."
          >
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
              /* Default slugify matches the server's tag rule. */
            />
          </Field>
          <div className="codex-inspector-foot">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onClose();
                onDelete();
              }}
            >
              Delete map
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
