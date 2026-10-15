import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, IconEyeOff, RevealSwitch, Skeleton, useToast } from "@vtt/ui";
import type { CodexAutosaveSettings, CodexMap, CodexMapKind, CodexMarker, CodexPageSummary } from "@vtt/domain";
import { atlasApi, codexApi, type MapAsset } from "./api";
import { MapPicker, MapSettings } from "./AtlasMapDialogs";
import { AtlasBreadcrumb, AtlasChildren, AtlasRoots, PinFilter, useDimmedPins, useMapTree } from "./AtlasNav";
import { MapSurface } from "./MapSurface";
import { MarkerInspector } from "./MarkerInspector";
import { useConfirm } from "../components/feedback";
import { DEFAULT_COLOR, DEFAULT_ICON } from "./icons";
import { CODEX_ROOT, atlasPath } from "./routes";
import { withQuery } from "../router";
import type { QuickCreateRequest } from "./QuickCreate";
import { useCodexQuery } from "./useCodexQuery";

/**
 * The atlas: a navigable forest of maps (world, region, local) with markers that link to pages and
 * sub-maps. All state is server-owned and refreshed on `codex:changed`.
 */
/** A stable empty feed, so a list that has not loaded yet keeps one identity across renders. */
const EMPTY: readonly never[] = [];
type AtlasScene = Readonly<{ id: string; name: string }>;
type AtlasMeta = Readonly<{
  maps: readonly CodexMap[];
  pages: readonly CodexPageSummary[];
  assets: readonly MapAsset[];
}>;
type AtlasActor = Readonly<{ id: string; name: string }>;
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
  /** The map tree, the page list for linking, and the map-image library. */
  const meta = useCodexQuery(
    useCallback(async (): Promise<AtlasMeta> => {
      const [maps, pages, assets] = await Promise.all([
        atlasApi.listMaps(gmToken),
        codexApi.listPages(gmToken),
        atlasApi.listAssets(gmToken).catch(() => [])
      ]);
      return { maps, pages, assets };
    }, [gmToken]),
    { failure: "Could not load the atlas." }
  );
  const maps = meta.data?.maps ?? EMPTY;
  const pages = meta.data?.pages ?? EMPTY;
  const assets = meta.data?.assets ?? EMPTY;
  // Don't show the "first map" invitation before the fetch settles.
  const loading = meta.loading;
  const loadMeta = meta.reload;
  const setMeta = meta.setData;
  /**
   * The URL is the source of truth; this mirror also holds the map a `?pin=` link resolved to. With
   * neither, the atlas opens on the first root map.
   */
  const [chosenMapId, setCurrentMapId] = useState<string | null>(mapId);
  useEffect(() => {
    if (mapId) setCurrentMapId(mapId);
  }, [mapId]);
  const currentMapId = chosenMapId ?? maps.find((map) => map.parentMapId === null)?.id ?? maps[0]?.id ?? null;
  const readMarkers = useCallback(() => atlasApi.listMarkers(gmToken, currentMapId ?? ""), [gmToken, currentMapId]);
  const pins = useCodexQuery(currentMapId ? readMarkers : null);
  const markers = currentMapId && !pins.error ? (pins.data ?? EMPTY) : EMPTY;
  const setMarkers = (update: (prev: readonly CodexMarker[]) => readonly CodexMarker[]) =>
    pins.setData((prev) => [...update(prev ?? EMPTY)]);
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
  /** A failed write or pin lookup. Fresh atlas data clears it. */
  const [actionError, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [meta.data]);
  const error = actionError ?? meta.error;

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
  const dimmedIds = useDimmedPins(markers, filter, tagFilter ?? null);
  // Suggest tags already in use on pages and maps.
  const tagSuggestions = useMemo(
    () => [...new Set([...pages.flatMap((page) => page.tags), ...maps.flatMap((map) => map.tags)])].sort(),
    [pages, maps]
  );

  const { rootMaps, breadcrumb, childMaps } = useMapTree(maps, currentMapId);
  // Entering a map drops the pin selection; it is a guarded navigation like any other.
  const enterMap = useCallback((next: string) => onNavigate(atlasPath(next)), [onNavigate]);

  const [uploading, setUploading] = useState(false);
  const uploadAsset = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      await atlasApi.uploadAsset(gmToken, file);
      const next = await atlasApi.listAssets(gmToken).catch(() => assets);
      setMeta((prev) => prev && { ...prev, assets: next });
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
  const renameMap = async (name: string) => {
    if (!currentMap) return;
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
      void pins.reload();
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
    setMeta(
      (prev) => prev && { ...prev, maps: prev.maps.map((existing) => (existing.id === map.id ? map : existing)) }
    );
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
      <AtlasRoots
        roots={rootMaps}
        currentRootId={breadcrumb[0]?.id ?? null}
        onEnter={enterMap}
        mark={(map) => !map.revealedToPlayers && <GmOnlyMark />}
      />
      <div className="codex-atlas-bar">
        <AtlasBreadcrumb chain={breadcrumb} currentMapId={currentMapId} onEnter={enterMap} />
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
            <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
              Map settings
            </Button>
          )}
        </div>
      </div>

      {currentMap && markers.length > 0 && (
        <PinFilter
          pins={markers}
          text={filter}
          tag={tagFilter ?? null}
          dimmed={dimmedIds}
          onChange={(next) =>
            onReplaceQuery((query) => {
              for (const [key, value] of Object.entries(next)) {
                if (value) query.set(key, value);
                else query.delete(key);
              }
            })
          }
        />
      )}

      <AtlasChildren maps={childMaps} onEnter={enterMap} mark={(map) => !map.revealedToPlayers && <GmOnlyMark />} />

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
              await pins.reload();
            }}
            onClose={deselectPin}
          />
        )}
      </div>

      <MapPicker
        open={picking}
        currentMap={currentMap}
        nest={nestNew}
        onNestChange={setNestNew}
        assets={assets}
        uploading={uploading}
        onUpload={(file) => void uploadAsset(file)}
        onPick={(asset) => void createFromAsset(asset)}
        onClose={() => setPicking(false)}
      />
      <MapSettings
        open={settingsOpen}
        map={currentMap}
        maps={maps}
        tagSuggestions={tagSuggestions}
        error={error}
        onRename={(name) => void renameMap(name)}
        onRetype={(kind) => void retypeMap(kind)}
        onReparent={(parentMapId) => void reparentMap(parentMapId)}
        onRetag={(tags) => void retagMap(tags)}
        onDelete={() => void deleteMap()}
        onClose={() => setSettingsOpen(false)}
      />
      {confirmDialog}
    </div>
  );
}
