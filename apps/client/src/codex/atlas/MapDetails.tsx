import { useMemo, useState } from "react";
import { Button, Field, IconPlus, Input, Modal, Select, TagInput, FieldAudienceToggle } from "@vtt/ui";
import type { CodexMap, CodexMapKind } from "@vtt/domain";
import { MapPicker as LibraryPicker, type PickerMap } from "../../maps/MapPicker";

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
        <Button variant="destructive" size="sm" onClick={onDelete}>
          Delete map
        </Button>
      </div>
    </div>
  );
}

const KIND_WORD: Readonly<Record<CodexMapKind, string>> = {
  world: "World map",
  regional: "Regional map",
  battlemap: "Battle map"
};

/**
 * Add a map (F3 atlas spec 2.4): E2's map picker (folders, the library and its upload) for the picture, then its name,
 * its kind and where it sits, as Details asks them.
 */
export function MapPicker({
  open,
  token,
  maps,
  defaultParentId,
  onCreate,
  onClose
}: Readonly<{
  open: boolean;
  token: string;
  maps: readonly CodexMap[];
  /** Where a new map sits at first: inside the open map for Add a map inside, else the top level. */
  defaultParentId: string | null;
  onCreate: (
    input: Readonly<{ assetId: string; name: string; kind: CodexMapKind; parentMapId: string | null }>
  ) => void;
  onClose: () => void;
}>) {
  const [picked, setPicked] = useState<PickerMap | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CodexMapKind>("regional");
  const [parent, setParent] = useState<string>(defaultParentId ?? "");
  const [shownFor, setShownFor] = useState(false);
  // Each opening starts at the picture, inside the map it was asked from.
  if (open !== shownFor) {
    setShownFor(open);
    if (open) {
      setPicked(null);
      setParent(defaultParentId ?? "");
    }
  }
  const choose = (map: PickerMap) => {
    setPicked(map);
    setName(map.name);
    setKind((map.kind as CodexMapKind) in KIND_WORD ? (map.kind as CodexMapKind) : "regional");
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={picked ? "Name the map" : "Add a map"}
      size={picked ? "sm" : "lg"}
      ariaLabel={picked ? "Name the map" : "Choose a map"}
      footer={
        picked ? (
          <>
            <Button variant="ghost" onClick={() => setPicked(null)}>
              Back
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={() => onCreate({ assetId: picked.id, name: name.trim(), kind, parentMapId: parent || null })}
            >
              Add map
            </Button>
          </>
        ) : undefined
      }
    >
      {picked ? (
        <div className="atlas-newmap">
          <Field label="Name" htmlFor="atlas-newmap-name">
            <Input id="atlas-newmap-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Kind" htmlFor="atlas-newmap-kind">
            <Select
              id="atlas-newmap-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as CodexMapKind)}
            >
              {(Object.keys(KIND_WORD) as CodexMapKind[]).map((value) => (
                <option key={value} value={value}>
                  {KIND_WORD[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sits inside" htmlFor="atlas-newmap-parent">
            <Select id="atlas-newmap-parent" value={parent} onChange={(event) => setParent(event.target.value)}>
              <option value="">The top level</option>
              {maps.map((map) => (
                <option key={map.id} value={map.id}>
                  {map.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      ) : (
        <LibraryPicker token={token} kind="all" selectedId={null} onSelect={choose} />
      )}
    </Modal>
  );
}
