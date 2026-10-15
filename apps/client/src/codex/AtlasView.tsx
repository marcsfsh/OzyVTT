import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Combobox,
  Field,
  IconEyeOff,
  IconPlus,
  Input,
  Modal,
  RevealSwitch,
  Select,
  Skeleton,
  Switch,
  TagInput,
  useToast
} from "@vtt/ui";
import { socket } from "../socket";
import type { CodexAutosaveSettings, CodexMap, CodexMapKind, CodexMarker, CodexPageSummary } from "@vtt/domain";
import { atlasApi, codexApi, type MapAsset } from "./api";
import { MapSurface } from "./MapSurface";
import { MarkerInspector } from "./MarkerInspector";
import { useConfirm } from "../components/feedback";
import { DEFAULT_COLOR, DEFAULT_ICON } from "./icons";
import { CODEX_ROOT, atlasPath } from "./routes";
import { withQuery } from "../router";
import type { QuickCreateRequest } from "./QuickCreate";

/**
 * The atlas: a navigable forest of maps (world, region, local) with markers that link to pages and
 * sub-maps. All state is server-owned and refreshed on `codex:changed`.
 */
type AtlasScene = Readonly<{ id: string; name: string }>;
type AtlasActor = Readonly<{ id: string; name: string }>;
const MAP_KINDS: ReadonlyArray<{ value: CodexMapKind; label: string }> = [
  { value: "world", label: "World" },
  { value: "regional", label: "Regional" },
  { value: "battlemap", label: "Battle map" }
];
/**
 * A request to land somewhere in the atlas. Opening a pin means opening its map first, then selecting the
 * pin. `mapId` may be null (a journal entry only stores the marker); the atlas resolves the map itself.
 */
export type AtlasTarget = Readonly<{ mapId: string | null; markerId: string | null }>;

/** "Players can't see this map yet" on a drill chip: the design system's GM-only glyph, not an emoji. */
function GmOnlyMark() {
  return (
    <span className="codex-descend-lock" role="img" aria-label="GM only" title="GM only. Players cannot see this map.">
      <IconEyeOff />
    </span>
  );
}

export function AtlasView({
  gmToken,
  scenes,
  actors = [],
  activeSceneId,
  onActivateScene,
  onOpenReplay,
  mapId,
  pinId,
  filter = "",
  tagFilter,
  autosave,
  onQuickCreate,
  onNavigate,
  onReplaceQuery
}: Readonly<{
  gmToken: string;
  scenes: readonly AtlasScene[];
  actors?: readonly AtlasActor[];
  activeSceneId: string | null;
  onActivateScene: (sceneId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  /** From `/codex/atlas/:mapId`. Null opens the first root map. */
  mapId: string | null;
  /** From `?pin=`. Resolves its own map through `GET /codex/markers/{id}` when `mapId` is absent. */
  pinId: string | null;
  /** Pin filters, in the URL so a tag chip can deep-link. */
  filter?: string;
  tagFilter?: string | null;
  autosave: CodexAutosaveSettings;
  onQuickCreate: (request: QuickCreateRequest) => void;
  onNavigate: (path: string) => void;
  onReplaceQuery: (mutate: (query: URLSearchParams) => void) => void;
}>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const { toast } = useToast();
  const [maps, setMaps] = useState<CodexMap[]>([]);
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  /**
   * The URL is the source of truth; this mirror covers the first load (picking the first root map) and a
   * `?pin=` link whose map must be resolved first.
   */
  const [currentMapId, setCurrentMapId] = useState<string | null>(mapId);
  useEffect(() => {
    if (mapId) setCurrentMapId(mapId);
  }, [mapId]);
  const [markers, setMarkers] = useState<CodexMarker[]>([]);
  /**
   * The selected pin is the `?pin=` address, so selection survives a refresh and every change goes through
   * `onNavigate`, which runs the unsaved-changes guard for the inspector's draft.
   */
  const selectedMarkerId = pinId;
  /** This atlas address with a pin selected (or none), keeping the `?q=`/`?tag=` filters. */
  const pinHref = useCallback(
    (markerId: string | null) =>
      withQuery(currentMapId ? `${CODEX_ROOT}/atlas/${currentMapId}` : `${CODEX_ROOT}/atlas`, {
        q: filter || null,
        tag: tagFilter ?? null,
        pin: markerId
      }),
    [currentMapId, filter, tagFilter]
  );
  const selectPin = useCallback((markerId: string) => onNavigate(pinHref(markerId)), [onNavigate, pinHref]);
  /** Closing the inspector is a departure too, so it is guarded. */
  const deselectPin = useCallback(() => {
    if (selectedMarkerId) onNavigate(pinHref(null));
  }, [onNavigate, pinHref, selectedMarkerId]);
  /** Clears the selection without the guard, for a just-deleted pin with nothing left to save. */
  const clearDeletedPin = useCallback(() => onReplaceQuery((query) => query.delete("pin")), [onReplaceQuery]);
  /** "Show the pin" selects it, asks the surface to centre on it, and scrolls the map into view (on a phone it is often below the fold). */
  const [centerOnMarkerId, setCenterOnMarkerId] = useState<string | null>(null);
  const mapBodyRef = useRef<HTMLDivElement>(null);
  /** At <=760px the inspector sits below the map, so selecting a pin scrolls it into view. */
  const inspectorRef = useRef<HTMLDivElement>(null);
  const showPin = (markerId: string) => {
    selectPin(markerId);
    setCenterOnMarkerId(markerId);
    mapBodyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const [placing, setPlacing] = useState(false);
  const [picking, setPicking] = useState(false);
  // A new map nests under the current one by default; off creates another root map.
  const [nestNew, setNestNew] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Don't show the "first map" invitation before the fetch settles.
  const [loading, setLoading] = useState(true);

  const loadMeta = useCallback(async () => {
    try {
      const [nextMaps, nextPages, nextAssets] = await Promise.all([
        atlasApi.listMaps(gmToken),
        codexApi.listPages(gmToken),
        atlasApi.listAssets(gmToken).catch(() => [])
      ]);
      setMaps(nextMaps);
      setPages(nextPages);
      setAssets(nextAssets);
      setError(null);
      setCurrentMapId(
        (current) => current ?? nextMaps.find((map) => map.parentMapId === null)?.id ?? nextMaps[0]?.id ?? null
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load the atlas.");
    } finally {
      setLoading(false);
    }
  }, [gmToken]);

  const loadMarkers = useCallback(
    async (mapId: string) => {
      try {
        setMarkers(await atlasApi.listMarkers(gmToken, mapId));
      } catch {
        setMarkers([]);
      }
    },
    [gmToken]
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);
  useEffect(() => {
    if (currentMapId) void loadMarkers(currentMapId);
    else setMarkers([]);
  }, [currentMapId, loadMarkers]);
  useEffect(() => {
    const onChanged = () => {
      void loadMeta();
      if (currentMapId) void loadMarkers(currentMapId);
    };
    socket.on("codex:changed", onChanged);
    return () => {
      socket.off("codex:changed", onChanged);
    };
  }, [loadMeta, loadMarkers, currentMapId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPlacing(false);
        setPicking(false);
        deselectPin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deselectPin]);

  /** A `?pin=` link with no `:mapId` (journal entries and some search hits): resolve the map from the marker. */
  const resolvedPinRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pinId || mapId || loading) return;
    if (resolvedPinRef.current === pinId) return;
    resolvedPinRef.current = pinId;
    let live = true;
    void codexApi
      .marker(gmToken, pinId)
      .then((marker) => {
        if (!live) return;
        setError(null);
        setCurrentMapId(marker.mapId);
        // Put the map in the URL so a refresh lands in the same place.
        onNavigate(atlasPath(marker.mapId, pinId));
      })
      // Say what happened, and clear the selection: a `?pin=` naming nothing must not look selected.
      .catch(() => {
        if (!live) return;
        setError("That pin is no longer in the atlas.");
        clearDeletedPin();
      });
    return () => {
      live = false;
    };
  }, [pinId, mapId, loading, gmToken, onNavigate, clearDeletedPin]);

  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) ?? null;
  /**
   * The party pin, if it is on this map; the row says it in words beside the ring on the map. Says
   * nothing when the pin is elsewhere, since only this map's markers are loaded.
   */
  const partyMarker = markers.find((marker) => marker.isParty) ?? null;
  /** Client-side over this map's pins. Non-matching pins dim rather than disappear. */
  const pinNeedle = filter.trim().toLowerCase();
  const matchesFilter = useCallback(
    (marker: CodexMarker) =>
      (!pinNeedle ||
        (marker.label ?? "").toLowerCase().includes(pinNeedle) ||
        marker.tags.some((tag) => tag.includes(pinNeedle))) &&
      (!tagFilter || marker.tags.includes(tagFilter)),
    [pinNeedle, tagFilter]
  );
  const filtering = pinNeedle !== "" || Boolean(tagFilter);
  const matchCount = filtering ? markers.filter(matchesFilter).length : markers.length;
  const dimmedIds = useMemo(
    () => (filtering ? new Set(markers.filter((marker) => !matchesFilter(marker)).map((marker) => marker.id)) : null),
    [filtering, markers, matchesFilter]
  );
  const pinTags = useMemo(() => [...new Set(markers.flatMap((marker) => marker.tags))].sort(), [markers]);
  // Suggest tags already in use on pages and maps.
  const tagSuggestions = useMemo(
    () => [...new Set([...pages.flatMap((page) => page.tags), ...maps.flatMap((map) => map.tags)])].sort(),
    [pages, maps]
  );

  const breadcrumb = useMemo(() => {
    const chain: CodexMap[] = [];
    let cursor = currentMap;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      chain.unshift(cursor);
      guard.add(cursor.id);
      cursor = maps.find((map) => map.id === cursor!.parentMapId) ?? null;
    }
    return chain;
  }, [currentMap, maps]);
  // Maps nested directly under this one: the way down, since the breadcrumb only goes up.
  const childMaps = useMemo(
    () => (currentMapId ? maps.filter((map) => map.parentMapId === currentMapId) : []),
    [maps, currentMapId]
  );
  // The atlas is a forest; without this row a second root map is unreachable once you leave it.
  const rootMaps = useMemo(() => maps.filter((map) => map.parentMapId === null), [maps]);
  const currentRootId = breadcrumb[0]?.id ?? null;
  // Entering a map drops the pin selection; it is a guarded navigation like any other.
  const enterMap = useCallback((next: string) => onNavigate(atlasPath(next)), [onNavigate]);

  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  /** The shared map-asset library, the same route `MapManager` uses. */
  const uploadAsset = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await atlasApi.uploadAsset(gmToken, file);
      const next = await atlasApi.listAssets(gmToken).catch(() => assets);
      setAssets(next);
      toast("Map image uploaded.", { tone: "success" });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const createFromAsset = async (asset: MapAsset) => {
    try {
      const map = await atlasApi.createMap(gmToken, {
        assetId: asset.id,
        name: asset.name,
        kind: asset.kind,
        parentMapId: nestNew ? currentMapId : null
      });
      setPicking(false);
      await loadMeta();
      onNavigate(atlasPath(map.id));
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not add the map.");
    }
  };
  // Excluded from "sits inside" so a map can't be moved into its own subtree (the server also guards).
  const descendantIds = useMemo(() => {
    if (!currentMapId) return new Set<string>();
    const out = new Set<string>();
    const walk = (parentId: string) => {
      for (const map of maps)
        if (map.parentMapId === parentId && !out.has(map.id)) {
          out.add(map.id);
          walk(map.id);
        }
    };
    walk(currentMapId);
    return out;
  }, [maps, currentMapId]);
  const renameMap = async () => {
    if (!currentMap) return;
    const name = settingsName.trim();
    if (!name || name === currentMap.name) return;
    try {
      onMapReplace(await atlasApi.updateMap(gmToken, currentMap.id, { name }));
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Couldn't rename the map.");
    }
  };
  const retypeMap = async (kind: CodexMapKind) => {
    if (!currentMap) return;
    try {
      onMapReplace(await atlasApi.updateMap(gmToken, currentMap.id, { kind }));
    } catch (retypeError) {
      setError(retypeError instanceof Error ? retypeError.message : "Couldn't change the map kind.");
    }
  };
  // Saved per committed tag; `tags` is always sent in full, so clearing travels as [].
  const retagMap = async (tags: readonly string[]) => {
    if (!currentMap) return;
    try {
      onMapReplace(await atlasApi.updateMap(gmToken, currentMap.id, { tags }));
    } catch (tagError) {
      setError(tagError instanceof Error ? tagError.message : "Couldn't save the tags.");
    }
  };
  const reparentMap = async (parentMapId: string | null) => {
    if (!currentMap) return;
    try {
      onMapReplace(await atlasApi.setMapParent(gmToken, currentMap.id, parentMapId));
      await loadMeta();
    } catch (parentError) {
      setError(parentError instanceof Error ? parentError.message : "Couldn't move the map.");
    }
  };
  const placeMarker = async (point: { x: number; y: number }) => {
    if (!currentMapId) return;
    try {
      const marker = await atlasApi.createMarker(gmToken, currentMapId, {
        x: point.x,
        y: point.y,
        iconId: DEFAULT_ICON,
        iconColor: DEFAULT_COLOR
      });
      setMarkers((prev) => [...prev, marker]);
      setPlacing(false);
      selectPin(marker.id);
    } catch (placeError) {
      setError(placeError instanceof Error ? placeError.message : "Could not place the pin.");
    }
  };
  const moveMarker = async (markerId: string, point: { x: number; y: number }) => {
    setMarkers((prev) =>
      prev.map((marker) => (marker.id === markerId ? { ...marker, x: point.x, y: point.y } : marker))
    );
    try {
      await atlasApi.moveMarker(gmToken, markerId, point.x, point.y);
    } catch {
      void loadMarkers(currentMapId!);
    }
  };
  const onMarkerUpdated = (marker: CodexMarker) =>
    setMarkers((prev) => prev.map((existing) => (existing.id === marker.id ? marker : existing)));
  /** Opens quick-create with the pin's label prefilled, and links the new page to the pin. Cancelling creates nothing. */
  const createPageForMarker = (marker: CodexMarker) =>
    onQuickCreate({
      title: marker.label?.trim() || "",
      entityType: "location",
      onCreated: async (page) => {
        onMarkerUpdated(await atlasApi.updateMarker(gmToken, marker.id, { pageIds: [...marker.pageIds, page.id] }));
        await loadMeta();
      }
    });
  const revealLinkedPage = async (pageId: string) => {
    try {
      await codexApi.revealPage(gmToken, pageId, true);
      await loadMeta();
    } catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : "Could not reveal the page.");
    }
  };
  const onMarkerDeleted = (markerId: string) => {
    setMarkers((prev) => prev.filter((marker) => marker.id !== markerId));
    clearDeletedPin();
  };
  const onMapReplace = (map: CodexMap) =>
    setMaps((prev) => prev.map((existing) => (existing.id === map.id ? map : existing)));
  const revealMap = async (revealed: boolean) => {
    if (!currentMap) return;
    try {
      onMapReplace(await atlasApi.revealMap(gmToken, currentMap.id, revealed));
    } catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : "Couldn't change who can see this map.");
    }
  };
  const deleteMap = async () => {
    if (
      currentMap &&
      (await confirm({
        title: "Delete map",
        body: `Delete map "${currentMap.name}"? Its pins are removed.`,
        confirmLabel: "Delete",
        danger: true
      }))
    ) {
      await atlasApi.deleteMap(gmToken, currentMap.id);
      const parent = currentMap.parentMapId;
      await loadMeta();
      onNavigate(parent ? atlasPath(parent) : "/codex/atlas");
    }
  };

  return (
    <div className="codex-atlas">
      {rootMaps.length > 1 && (
        <nav className="codex-atlas-descend" aria-label="Top-level maps">
          <span className="codex-descend-label">Top level</span>
          {rootMaps.map((root) => (
            <button
              key={root.id}
              type="button"
              className={`codex-descend-chip${root.id === currentRootId ? " is-current" : ""}`}
              aria-current={root.id === currentRootId ? "true" : undefined}
              onClick={() => enterMap(root.id)}
            >
              {root.name}
              {!root.revealedToPlayers && <GmOnlyMark />}
            </button>
          ))}
        </nav>
      )}
      <div className="codex-atlas-bar">
        <nav className="codex-breadcrumb" aria-label="Map path">
          {breadcrumb.length === 0 && <span className="codex-crumb is-current">Atlas</span>}
          {breadcrumb.map((map, index) => (
            <span key={map.id}>
              {index > 0 && (
                <span className="codex-crumb-sep" aria-hidden="true">
                  ›
                </span>
              )}
              <button
                type="button"
                className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`}
                onClick={() => enterMap(map.id)}
              >
                {map.name}
              </button>
            </span>
          ))}
        </nav>
        <div className="codex-atlas-actions">
          {currentMap && (
            <RevealSwitch
              revealed={currentMap.revealedToPlayers}
              onChange={revealMap}
              ariaLabel="Show this map to players"
            />
          )}
          {currentMap && (
            <Button
              variant={placing ? "primary" : "secondary"}
              size="sm"
              aria-pressed={placing}
              onClick={() => setPlacing((value) => !value)}
            >
              {placing ? "Placing…" : "Add pin"}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setNestNew(true);
              setPicking(true);
            }}
          >
            {currentMap ? "Add sub-map" : "New map"}
          </Button>
          {currentMap && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSettingsName(currentMap.name);
                setSettingsOpen(true);
              }}
            >
              Map settings
            </Button>
          )}
        </div>
      </div>

      {currentMap && markers.length > 0 && (
        <div className="codex-atlas-filter">
          <Input
            aria-label="Filter pins"
            placeholder="Filter pins"
            value={filter}
            onChange={(event) =>
              onReplaceQuery((query) => {
                if (event.target.value) query.set("q", event.target.value);
                else query.delete("q");
              })
            }
          />
          {pinTags.length > 0 && (
            <Combobox
              options={pinTags.map((tag) => ({ id: tag, label: `#${tag}` }))}
              value={tagFilter ?? null}
              onChange={(tag) =>
                onReplaceQuery((query) => {
                  if (tag) query.set("tag", tag);
                  else query.delete("tag");
                })
              }
              ariaLabel="Filter pins by tag"
              placeholder="Filter by tag"
            />
          )}
          {filtering && (
            <span className="codex-atlas-filtercount" role="status">
              {matchCount} of {markers.length} pins match
            </span>
          )}
        </div>
      )}

      {childMaps.length > 0 && (
        <nav className="codex-atlas-descend" aria-label="Maps within this one">
          <span className="codex-descend-label">Drill into</span>
          {childMaps.map((child) => (
            <button key={child.id} type="button" className="codex-descend-chip" onClick={() => enterMap(child.id)}>
              <span className="codex-descend-arrow" aria-hidden="true" />
              {child.name}
              {!child.revealedToPlayers && <GmOnlyMark />}
            </button>
          ))}
        </nav>
      )}

      {/* The party's position in words, not only as a ring on the map. */}
      {partyMarker && (
        <div className="codex-atlas-party">
          <span className="codex-atlas-partytext">
            The party is on this map
            {partyMarker.label ? (
              <>
                {" "}
                at <strong>{partyMarker.label}</strong>
              </>
            ) : null}
            .
          </span>
          <Button variant="ghost" onClick={() => showPin(partyMarker.id)}>
            Show the pin
          </Button>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="codex-atlas-body" ref={mapBodyRef}>
        {currentMap ? (
          <MapSurface
            token={gmToken}
            assetId={currentMap.assetId}
            markers={markers}
            placing={placing}
            selectedMarkerId={selectedMarkerId}
            dimmedMarkerIds={dimmedIds}
            centerOnMarkerId={centerOnMarkerId}
            onCentered={() => setCenterOnMarkerId(null)}
            onBackgroundClick={placeMarker}
            onMarkerClick={(markerId) => {
              selectPin(markerId);
              if (window.innerWidth <= 760)
                requestAnimationFrame(() =>
                  inspectorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
                );
            }}
            onMarkerDragEnd={moveMarker}
          />
        ) : loading ? (
          <div className="codex-main-loading">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} variant="text" />
            ))}
          </div>
        ) : (
          <div className="codex-main-empty">
            <h3>No map yet</h3>
            <p>
              An atlas is built from uploaded map images. Add a map, drop pins on it, and link each pin to a page or to
              a map nested underneath.
            </p>
            <Button variant="primary" onClick={() => setPicking(true)}>
              New map
            </Button>
          </div>
        )}
        <div ref={inspectorRef} />
        {selectedMarker && (
          <MarkerInspector
            key={selectedMarker.id}
            gmToken={gmToken}
            marker={selectedMarker}
            pages={pages}
            maps={maps}
            scenes={scenes}
            actors={actors}
            activeSceneId={activeSceneId}
            autosave={autosave}
            onUpdated={onMarkerUpdated}
            onDeleted={onMarkerDeleted}
            onOpenMap={enterMap}
            onOpenPage={(pageId) => onNavigate(`/codex/pages/${pageId}`)}
            onCreatePage={() => createPageForMarker(selectedMarker)}
            onRevealPage={revealLinkedPage}
            onRevealMap={() => void revealMap(true)}
            onActivateScene={onActivateScene}
            onOpenReplay={onOpenReplay}
            /* Setting the party can clear a pin on another map, so re-read this map's pins. */
            onPartyChanged={async () => {
              if (currentMapId) await loadMarkers(currentMapId);
            }}
            onClose={deselectPin}
          />
        )}
      </div>

      <Modal
        open={picking}
        onClose={() => setPicking(false)}
        title={currentMap && nestNew ? `Add a sub-map under ${currentMap.name}` : "Add a map"}
        size="md"
        ariaLabel="Choose a map"
      >
        {currentMap && (
          <div className="codex-atlas-nestrow">
            <Switch checked={nestNew} onChange={setNestNew} label={`Nest inside “${currentMap.name}”`} />
            <p className="codex-inspector-hint">
              {nestNew ? (
                <>
                  The new map sits inside <strong>{currentMap.name}</strong>, and you can drill into it from here.
                </>
              ) : (
                <>The new map is added at the top level, not inside any other map.</>
              )}
            </p>
          </div>
        )}
        {/* Upload here; it is the same asset library Scenes uses. */}
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
              void uploadAsset(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
        {assetsEmpty(assets) ? (
          <p className="codex-list-empty">
            No map images yet. Upload one to start your atlas. Scenes uses the same image library.
          </p>
        ) : (
          <div className="codex-asset-grid">
            {assets.map((asset) => (
              <button key={asset.id} type="button" className="codex-asset-card" onClick={() => createFromAsset(asset)}>
                <span className="codex-asset-name">{asset.name}</span>
                <Badge tone="neutral">{asset.kind}</Badge>
              </button>
            ))}
          </div>
        )}
      </Modal>
      <Modal
        open={settingsOpen && !!currentMap}
        onClose={() => {
          void renameMap();
          setSettingsOpen(false);
        }}
        title="Map settings"
        size="sm"
        ariaLabel="Map settings"
      >
        {currentMap && (
          <div className="codex-map-settings">
            {/* The page's Alert is behind the overlay, and every write here is immediate, so show errors here too. */}
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Name" htmlFor="map-name">
              <Input
                id="map-name"
                value={settingsName}
                onChange={(event) => setSettingsName(event.target.value)}
                onBlur={renameMap}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void renameMap();
                }}
              />
            </Field>
            <Field
              label="Kind"
              htmlFor="map-kind"
              help="Where this map sits in the atlas: a world, a region within a world, or a local place."
            >
              <Select
                id="map-kind"
                value={currentMap.kind}
                onChange={(event) => void retypeMap(event.target.value as CodexMapKind)}
              >
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
                value={currentMap.parentMapId ?? ""}
                onChange={(event) => void reparentMap(event.target.value || null)}
              >
                <option value="">Top level</option>
                {maps
                  .filter((map) => map.id !== currentMap.id && !descendantIds.has(map.id))
                  .map((map) => (
                    <option key={map.id} value={map.id}>
                      {map.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Tags" htmlFor="map-tags">
              <TagInput
                id="map-tags"
                ariaLabel="Tags"
                placeholder="underdark, faerun"
                values={currentMap.tags}
                onChange={(next) => void retagMap(next)}
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
                  setSettingsOpen(false);
                  void deleteMap();
                }}
              >
                Delete map
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}

function assetsEmpty(assets: readonly MapAsset[]) {
  return assets.length === 0;
}
