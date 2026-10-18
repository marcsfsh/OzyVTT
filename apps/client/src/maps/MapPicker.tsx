import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, IconPlus, Input, useToast } from "@vtt/ui";
import { useCachedMapThumbnail } from "../scene/mapImage";
import type { MapSelection } from "./map-catalog";
import { uploadMap, useMapCatalog, type PickerMap } from "./map-catalog";
import "./map-picker.css";

export type { PickerMap } from "./map-catalog";

/**
 * The map collection, embedded in both prep doors (the table's quick-start panel and the scene-prep
 * workspace). Tiles show the real art (`useCachedMapThumbnail`, shared with scene cards); folders
 * are a chip row before the grid; and the first tile is an upload that refreshes the library and
 * selects the new map in place, without leaving the panel.
 */

const KIND_LABEL: Record<MapSelection["kind"], string> = {
  battlemap: "Battle map",
  regional: "Regional map",
  world: "World map"
};

/** One tile: the map's art, its name, and what it still needs before tokens snap. Exported because
    the Maps library renders the same tile. */
export function MapTile({
  map,
  token,
  selected,
  onSelect,
  meta
}: Readonly<{ map: PickerMap; token: string | null; selected: boolean; onSelect: () => void; meta?: string }>) {
  const url = useCachedMapThumbnail(map.id, token);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const note = map.calibration ? "Grid set" : map.scale ? "Gridless" : "No grid yet";
  return (
    <li>
      <button
        type="button"
        className={`map-tile${selected ? " is-selected" : ""}`}
        aria-pressed={selected}
        onClick={onSelect}
      >
        <span className="map-tile-art">
          {url && !failed ? (
            <img src={url} alt="" onError={() => setFailed(true)} />
          ) : (
            <span className="map-tile-art-empty" aria-hidden="true" />
          )}
        </span>
        <span className="map-tile-name">{map.name}</span>
        <span className="map-tile-meta">{meta ?? (map.kind === "battlemap" ? note : KIND_LABEL[map.kind])}</span>
      </button>
    </li>
  );
}

export function MapPicker({
  token,
  kind = "battlemap",
  selectedId,
  onSelect,
  fallback,
  onSetGrid,
  onUploaded
}: Readonly<{
  /** Bearer token for the map endpoints. Falls back to the live socket session (see `sessionToken`). */
  token?: string | null;
  /** Which kind the flow needs; scenes require a battle map, so that is the default. */
  kind?: MapSelection["kind"] | "all";
  selectedId: string | null;
  /** `fromUpload` lets a caller keep the picker open after an upload (so the "no grid yet" line is
      readable) while still closing it on an ordinary tile tap. */
  onSelect: (map: PickerMap, meta?: { fromUpload: boolean }) => void;
  /** Maps the caller already has (the shell's library). Used until the picker's own fetch lands, and as
      the whole list when there is no token to fetch with. */
  fallback?: readonly MapSelection[];
  /** Offered as a quiet line after an upload; omitted when the caller has nowhere to send them. */
  onSetGrid?: (mapId: string) => void;
  /** The library changed (an upload landed); the shell can refresh its own copy. */
  onUploaded?: (map: PickerMap) => void;
}>) {
  const { maps, reload, token: bearer, error } = useMapCatalog(token);
  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [justUploaded, setJustUploaded] = useState<PickerMap | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  useEffect(() => {
    if (error) toast(error, { tone: "error" });
  }, [error, toast]);

  const known: readonly PickerMap[] = maps ?? (fallback ?? []).map((map) => ({ ...map, folder: null }));
  const ofKind = useMemo(() => known.filter((map) => kind === "all" || map.kind === kind), [known, kind]);
  const folders = useMemo(
    () =>
      [...new Set(ofKind.map((map) => map.folder).filter((name): name is string => name !== null))].sort((a, b) =>
        a.localeCompare(b)
      ),
    [ofKind]
  );
  const needle = search.trim().toLowerCase();
  const shown = ofKind.filter(
    (map) => (folder === null || map.folder === folder) && (needle === "" || map.name.toLowerCase().includes(needle))
  );

  const upload = async (file: File) => {
    if (!bearer) {
      toast("Sign in as the GM to upload a map.", { tone: "error" });
      return;
    }
    setBusy(true);
    try {
      const { asset, duplicate } = await uploadMap(bearer, file, kind === "all" ? "battlemap" : kind);
      const picked = (await reload(asset.id)) ?? asset;
      setJustUploaded(picked);
      onSelect(picked, { fromUpload: true });
      onUploaded?.(picked);
      toast(duplicate ? "That image was already here, so the existing map is selected." : "Map uploaded.", {
        tone: "success"
      });
    } catch (failure) {
      toast((failure as Error).message, { tone: "error" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="map-picker" role="group" aria-label="Choose a map">
      <div className="map-picker-folders" role="group" aria-label="Folders">
        <Chip pressed={folder === null} onClick={() => setFolder(null)}>
          All
        </Chip>
        {folders.map((name) => (
          <Chip key={name} pressed={folder === name} onClick={() => setFolder(name)}>
            {name}
          </Chip>
        ))}
      </div>
      <Input
        type="search"
        className="map-picker-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search maps"
        aria-label="Search maps"
      />
      {/* The grid caps itself at 21rem and scrolls (map-picker.css). The maps rail lifts the cap and
        scrolls its own wrapper instead. */}
      <ul className="map-picker-grid scroll-y">
        <li>
          <button
            type="button"
            className="map-tile map-tile--upload"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            <span className="map-tile-art">
              <IconPlus />
            </span>
            <span className="map-tile-name">{busy ? "Uploading…" : "Upload a map"}</span>
            <span className="map-tile-meta">An image file</span>
          </button>
          <input
            ref={fileRef}
            className="map-picker-file"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </li>
        {shown.map((map) => (
          <MapTile
            key={map.id}
            map={map}
            token={bearer}
            selected={map.id === selectedId}
            onSelect={() => onSelect(map)}
          />
        ))}
      </ul>
      {shown.length === 0 && (
        <p className="map-picker-empty">
          {needle || folder ? "No maps match that." : "No maps yet. Upload one above."}
        </p>
      )}
      {justUploaded && !justUploaded.calibration && !justUploaded.scale && (
        <p className="map-picker-note">
          <strong>{justUploaded.name}</strong> has no grid yet. Tokens still go on it but won't snap to squares.
          {onSetGrid && (
            <>
              {" "}
              <Button variant="ghost" size="sm" onClick={() => onSetGrid(justUploaded.id)}>
                Set the grid
              </Button>
            </>
          )}
        </p>
      )}
    </div>
  );
}
