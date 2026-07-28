import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Field, Input, Modal, Select, Skeleton, Switch } from "@vtt/ui";
import { socket } from "../socket";
import { atlasApi, type CodexMap, type CodexMapKind, type CodexMarker, type CodexPageSummary, type MapAsset } from "./api";
import { codexApi } from "./api";
import { MapSurface } from "./MapSurface";
import { MarkerInspector } from "./MarkerInspector";
import { RevealSwitch } from "./SecretMarkers";
import { useConfirm } from "../components/feedback";
import { DEFAULT_COLOR, DEFAULT_ICON } from "./icons";

/**
 * The atlas: a navigable tree of maps (world → region → local) with polymorphic markers. The GM makes a
 * map from an uploaded asset, drops markers, links them to pages / sub-maps, and reveals them to players.
 * Drill-down and breadcrumbs walk the parent chain. All state is server-owned and refreshed on codex:changed.
 */
type AtlasScene = Readonly<{ id: string; name: string }>;
type AtlasActor = Readonly<{ id: string; name: string }>;
const MAP_KINDS: ReadonlyArray<{ value: CodexMapKind; label: string }> = [
  { value: "world", label: "World" }, { value: "regional", label: "Regional" }, { value: "battlemap", label: "Local / battlemap" }
];
export function AtlasView({ gmToken, scenes, actors = [], activeSceneId, onOpenPage, onActivateScene, onOpenReplay }: Readonly<{ gmToken: string; scenes: readonly AtlasScene[]; actors?: readonly AtlasActor[]; activeSceneId: string | null; onOpenPage: (pageId: string) => void; onActivateScene: (sceneId: string) => void; onOpenReplay?: (archiveId: number) => void }>) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [maps, setMaps] = useState<CodexMap[]>([]);
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<CodexMarker[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [picking, setPicking] = useState(false);
  // A new map nests under the map you're looking at by default; turning this off makes a second ROOT map,
  // so a world with separate continents/planes isn't stuck in one tree (the data model always allowed a forest).
  const [nestNew, setNestNew] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsName, setSettingsName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // CF-2: "Chart your world" is an invitation to create the FIRST map — showing it mid-fetch tells
  // a GM with a full atlas that they have nothing.
  const [loading, setLoading] = useState(true);

  const loadMeta = useCallback(async () => {
    try {
      const [nextMaps, nextPages, nextAssets] = await Promise.all([atlasApi.listMaps(gmToken), codexApi.listPages(gmToken), atlasApi.listAssets(gmToken).catch(() => [])]);
      setMaps(nextMaps); setPages(nextPages); setAssets(nextAssets); setError(null);
      setCurrentMapId((current) => current ?? nextMaps[0]?.id ?? null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the atlas."); }
    finally { setLoading(false); }
  }, [gmToken]);

  const loadMarkers = useCallback(async (mapId: string) => {
    try { setMarkers(await atlasApi.listMarkers(gmToken, mapId)); } catch { setMarkers([]); }
  }, [gmToken]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);
  useEffect(() => { if (currentMapId) void loadMarkers(currentMapId); else setMarkers([]); }, [currentMapId, loadMarkers]);
  useEffect(() => {
    const onChanged = () => { void loadMeta(); if (currentMapId) void loadMarkers(currentMapId); };
    socket.on("codex:changed", onChanged);
    return () => { socket.off("codex:changed", onChanged); };
  }, [loadMeta, loadMarkers, currentMapId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setPlacing(false); setPicking(false); setSelectedMarkerId(null); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) ?? null;

  const breadcrumb = useMemo(() => {
    const chain: CodexMap[] = [];
    let cursor = currentMap;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) { chain.unshift(cursor); guard.add(cursor.id); cursor = maps.find((map) => map.id === cursor!.parentMapId) ?? null; }
    return chain;
  }, [currentMap, maps]);
  // Maps nested directly under the current one — the breadcrumb walks UP the parent chain, so these
  // "drill into" chips are the way DOWN (without them a regional child map is unreachable once you leave it).
  const childMaps = useMemo(() => (currentMapId ? maps.filter((map) => map.parentMapId === currentMapId) : []), [maps, currentMapId]);
  // The atlas is a FOREST, not one tree. The breadcrumb only climbs a single chain, so without this row a
  // second root map becomes unreachable the moment you leave it (the view remounts onto the first root).
  const rootMaps = useMemo(() => maps.filter((map) => map.parentMapId === null), [maps]);
  const currentRootId = breadcrumb[0]?.id ?? null;
  const enterMap = useCallback((mapId: string) => { setSelectedMarkerId(null); setCurrentMapId(mapId); }, []);

  const createFromAsset = async (asset: MapAsset) => {
    try {
      const map = await atlasApi.createMap(gmToken, { assetId: asset.id, name: asset.name, kind: asset.kind, parentMapId: nestNew ? currentMapId : null });
      setPicking(false); await loadMeta(); setCurrentMapId(map.id);
    } catch (createError) { setError(createError instanceof Error ? createError.message : "Could not add the map."); }
  };
  // Every map beneath the current one — excluded from the "sits inside" options so a map can't be
  // re-parented into its own subtree (the server cycle-guards too; this keeps the choice honest).
  const descendantIds = useMemo(() => {
    if (!currentMapId) return new Set<string>();
    const out = new Set<string>();
    const walk = (parentId: string) => { for (const map of maps) if (map.parentMapId === parentId && !out.has(map.id)) { out.add(map.id); walk(map.id); } };
    walk(currentMapId);
    return out;
  }, [maps, currentMapId]);
  const renameMap = async () => {
    if (!currentMap) return;
    const name = settingsName.trim();
    if (!name || name === currentMap.name) return;
    try { onMapReplace(await atlasApi.updateMap(gmToken, currentMap.id, { name })); }
    catch (renameError) { setError(renameError instanceof Error ? renameError.message : "Couldn't rename the map."); }
  };
  const retypeMap = async (kind: CodexMapKind) => {
    if (!currentMap) return;
    try { onMapReplace(await atlasApi.updateMap(gmToken, currentMap.id, { kind })); }
    catch (retypeError) { setError(retypeError instanceof Error ? retypeError.message : "Couldn't change the map kind."); }
  };
  const reparentMap = async (parentMapId: string | null) => {
    if (!currentMap) return;
    try { onMapReplace(await atlasApi.setMapParent(gmToken, currentMap.id, parentMapId)); await loadMeta(); }
    catch (parentError) { setError(parentError instanceof Error ? parentError.message : "Couldn't move the map."); }
  };
  const placeMarker = async (point: { x: number; y: number }) => {
    if (!currentMapId) return;
    try { const marker = await atlasApi.createMarker(gmToken, currentMapId, { x: point.x, y: point.y, iconId: DEFAULT_ICON, iconColor: DEFAULT_COLOR }); setMarkers((prev) => [...prev, marker]); setSelectedMarkerId(marker.id); setPlacing(false); }
    catch (placeError) { setError(placeError instanceof Error ? placeError.message : "Could not place the marker."); }
  };
  const moveMarker = async (markerId: string, point: { x: number; y: number }) => {
    setMarkers((prev) => prev.map((marker) => (marker.id === markerId ? { ...marker, x: point.x, y: point.y } : marker)));
    try { await atlasApi.moveMarker(gmToken, markerId, point.x, point.y); } catch { void loadMarkers(currentMapId!); }
  };
  const onMarkerUpdated = (marker: CodexMarker) => setMarkers((prev) => prev.map((existing) => (existing.id === marker.id ? marker : existing)));
  // One-tap: turn a pin into a linked page (titled from its label), then open it - no round-trip through the Pages tab.
  const createPageForMarker = async (marker: CodexMarker) => {
    try {
      const page = await codexApi.createPage(gmToken, { title: marker.label?.trim() || "New location" });
      onMarkerUpdated(await atlasApi.updateMarker(gmToken, marker.id, { pageIds: [...marker.pageIds, page.id] }));
      await loadMeta();
      onOpenPage(page.id);
    } catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create the page."); }
  };
  const revealLinkedPage = async (pageId: string) => {
    try { await codexApi.revealPage(gmToken, pageId, true); await loadMeta(); }
    catch (revealError) { setError(revealError instanceof Error ? revealError.message : "Could not reveal the page."); }
  };
  const onMarkerDeleted = (markerId: string) => { setMarkers((prev) => prev.filter((marker) => marker.id !== markerId)); setSelectedMarkerId(null); };
  const onMapReplace = (map: CodexMap) => setMaps((prev) => prev.map((existing) => (existing.id === map.id ? map : existing)));
  const revealMap = async (revealed: boolean) => {
    if (!currentMap) return;
    try { onMapReplace(await atlasApi.revealMap(gmToken, currentMap.id, revealed)); }
    catch (revealError) { setError(revealError instanceof Error ? revealError.message : "Couldn't change who can see this map."); }
  };
  const deleteMap = async () => { if (currentMap && await confirm({ title: "Delete map", body: `Delete map "${currentMap.name}"? Its markers are removed.`, confirmLabel: "Delete", danger: true })) { await atlasApi.deleteMap(gmToken, currentMap.id); const parent = currentMap.parentMapId; await loadMeta(); setCurrentMapId(parent); } };

  return (
    <div className="codex-atlas">
      {rootMaps.length > 1 && (
        <nav className="codex-atlas-descend" aria-label="Top-level maps">
          <span className="codex-descend-label">Top level</span>
          {rootMaps.map((root) => (
            <button key={root.id} type="button" className={`codex-descend-chip${root.id === currentRootId ? " is-current" : ""}`} aria-current={root.id === currentRootId ? "true" : undefined} onClick={() => enterMap(root.id)}>
              {root.name}
              {!root.revealedToPlayers && <span className="codex-descend-lock" title="GM-only — players can't see this map yet" aria-label="GM-only">🔒</span>}
            </button>
          ))}
        </nav>
      )}
      <div className="codex-atlas-bar">
        <nav className="codex-breadcrumb" aria-label="Map path">
          {breadcrumb.length === 0 && <span className="codex-crumb is-current">Atlas</span>}
          {breadcrumb.map((map, index) => (
            <span key={map.id}>
              {index > 0 && <span className="codex-crumb-sep">›</span>}
              <button type="button" className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`} onClick={() => enterMap(map.id)}>{map.name}</button>
            </span>
          ))}
        </nav>
        <div className="codex-atlas-actions">
          {currentMap && <RevealSwitch revealed={currentMap.revealedToPlayers} onChange={revealMap} ariaLabel="Show this map to players" />}
          {currentMap && <Button variant={placing ? "primary" : "secondary"} size="sm" aria-pressed={placing} onClick={() => setPlacing((value) => !value)}>{placing ? "Placing…" : "Add marker"}</Button>}
          <Button variant="secondary" size="sm" onClick={() => { setNestNew(true); setPicking(true); }}>{currentMap ? "Add sub-map" : "New map"}</Button>
          {currentMap && <Button variant="ghost" size="sm" onClick={() => { setSettingsName(currentMap.name); setSettingsOpen(true); }}>Map settings</Button>}
        </div>
      </div>

      {childMaps.length > 0 && (
        <nav className="codex-atlas-descend" aria-label="Maps within this one">
          <span className="codex-descend-label">Drill into</span>
          {childMaps.map((child) => (
            <button key={child.id} type="button" className="codex-descend-chip" onClick={() => enterMap(child.id)}>
              <span className="codex-descend-arrow" aria-hidden="true">↳</span>{child.name}
              {!child.revealedToPlayers && <span className="codex-descend-lock" title="GM-only — players can't see this map yet" aria-label="GM-only">🔒</span>}
            </button>
          ))}
        </nav>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="codex-atlas-body">
        {currentMap
          ? <MapSurface token={gmToken} assetId={currentMap.assetId} markers={markers} placing={placing} selectedMarkerId={selectedMarkerId}
              onBackgroundClick={placeMarker} onMarkerClick={setSelectedMarkerId} onMarkerDragEnd={moveMarker} />
          : loading ? <div className="codex-main-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>
          : <div className="codex-main-empty"><h3>Chart your world</h3><p>Turn an uploaded map into an atlas. Drop markers on towns and dungeons, link each to a page or a deeper map, and reveal them as the party explores.</p><Button variant="primary" onClick={() => setPicking(true)}>New map</Button></div>}
        {selectedMarker && <MarkerInspector key={selectedMarker.id} gmToken={gmToken} marker={selectedMarker} pages={pages} maps={maps} scenes={scenes} actors={actors} activeSceneId={activeSceneId}
          onUpdated={onMarkerUpdated} onDeleted={onMarkerDeleted} onOpenMap={enterMap} onOpenPage={onOpenPage}
          onCreatePage={() => createPageForMarker(selectedMarker)} onRevealPage={revealLinkedPage} onRevealMap={() => void revealMap(true)} onActivateScene={onActivateScene} onOpenReplay={onOpenReplay} onClose={() => setSelectedMarkerId(null)} />}
      </div>

      <Modal open={picking} onClose={() => setPicking(false)} title={currentMap && nestNew ? `Add a sub-map under ${currentMap.name}` : "Add a map"} size="md" ariaLabel="Choose a map">
        {currentMap && (
          <div className="codex-atlas-nestrow">
            <Switch checked={nestNew} onChange={setNestNew} label={`Nest inside “${currentMap.name}”`} />
            <p className="codex-inspector-hint">{nestNew
              ? <>The new map sits inside <strong>{currentMap.name}</strong>, and you can drill into it from here.</>
              : <>The new map starts its own tree at the top level — for a separate continent, plane, or city.</>}</p>
          </div>
        )}
        {assetsEmpty(assets) ? <p className="codex-list-empty">No maps uploaded yet. Upload one under Scenes → Manage maps, then come back.</p> : (
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
      <Modal open={settingsOpen && !!currentMap} onClose={() => { void renameMap(); setSettingsOpen(false); }} title="Map settings" size="sm" ariaLabel="Map settings">
        {currentMap && (
          <div className="codex-map-settings">
            <Field label="Name" htmlFor="map-name">
              <Input id="map-name" value={settingsName} onChange={(event) => setSettingsName(event.target.value)} onBlur={renameMap}
                onKeyDown={(event) => { if (event.key === "Enter") void renameMap(); }} />
            </Field>
            <Field label="Kind" htmlFor="map-kind" help="How this map sits in the atlas — a world, a region within it, or a local place.">
              <Select id="map-kind" value={currentMap.kind} onChange={(event) => void retypeMap(event.target.value as CodexMapKind)}>
                {MAP_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
              </Select>
            </Field>
            <Field label="Sits inside" htmlFor="map-parent" help="Move this map elsewhere in the atlas. Everything under it travels along.">
              <Select id="map-parent" value={currentMap.parentMapId ?? ""} onChange={(event) => void reparentMap(event.target.value || null)}>
                <option value="">— top level —</option>
                {maps.filter((map) => map.id !== currentMap.id && !descendantIds.has(map.id)).map((map) => <option key={map.id} value={map.id}>{map.name}</option>)}
              </Select>
            </Field>
            <div className="codex-inspector-foot">
              <Button variant="ghost" size="sm" onClick={() => { setSettingsOpen(false); void deleteMap(); }}>Delete map</Button>
            </div>
          </div>
        )}
      </Modal>
      {confirmDialog}
    </div>
  );
}

function assetsEmpty(assets: readonly MapAsset[]) { return assets.length === 0; }
