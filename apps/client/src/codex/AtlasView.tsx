import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Switch } from "@vtt/ui";
import { socket } from "../socket";
import { atlasApi, type CodexMap, type CodexMarker, type CodexPageSummary, type MapAsset } from "./api";
import { codexApi } from "./api";
import { MapSurface } from "./MapSurface";
import { MarkerInspector } from "./MarkerInspector";
import { DEFAULT_COLOR, DEFAULT_ICON } from "./icons";

/**
 * The atlas: a navigable tree of maps (world → region → local) with polymorphic markers. The GM makes a
 * map from an uploaded asset, drops markers, links them to pages / sub-maps, and reveals them to players.
 * Drill-down and breadcrumbs walk the parent chain. All state is server-owned and refreshed on codex:changed.
 */
export function AtlasView({ gmToken, onOpenPage }: Readonly<{ gmToken: string; onOpenPage: (pageId: string) => void }>) {
  const [maps, setMaps] = useState<CodexMap[]>([]);
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [pages, setPages] = useState<CodexPageSummary[]>([]);
  const [currentMapId, setCurrentMapId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<CodexMarker[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    try {
      const [nextMaps, nextPages, nextAssets] = await Promise.all([atlasApi.listMaps(gmToken), codexApi.listPages(gmToken), atlasApi.listAssets(gmToken).catch(() => [])]);
      setMaps(nextMaps); setPages(nextPages); setAssets(nextAssets); setError(null);
      setCurrentMapId((current) => current ?? nextMaps[0]?.id ?? null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load the atlas."); }
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

  const createFromAsset = async (asset: MapAsset) => {
    try {
      const map = await atlasApi.createMap(gmToken, { assetId: asset.id, name: asset.name, kind: asset.kind, parentMapId: currentMapId });
      setPicking(false); await loadMeta(); setCurrentMapId(map.id);
    } catch (createError) { setError(createError instanceof Error ? createError.message : "Could not add the map."); }
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
  const onMarkerDeleted = (markerId: string) => { setMarkers((prev) => prev.filter((marker) => marker.id !== markerId)); setSelectedMarkerId(null); };
  const onMapReplace = (map: CodexMap) => setMaps((prev) => prev.map((existing) => (existing.id === map.id ? map : existing)));
  const revealMap = async (revealed: boolean) => { if (currentMap) onMapReplace(await atlasApi.revealMap(gmToken, currentMap.id, revealed)); };
  const deleteMap = async () => { if (currentMap && confirm(`Delete map "${currentMap.name}"? Its markers are removed.`)) { await atlasApi.deleteMap(gmToken, currentMap.id); const parent = currentMap.parentMapId; await loadMeta(); setCurrentMapId(parent); } };

  return (
    <div className="codex-atlas">
      <div className="codex-atlas-bar">
        <nav className="codex-breadcrumb" aria-label="Map path">
          {breadcrumb.length === 0 && <span className="codex-crumb is-current">Atlas</span>}
          {breadcrumb.map((map, index) => (
            <span key={map.id}>
              {index > 0 && <span className="codex-crumb-sep">›</span>}
              <button type="button" className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`} onClick={() => { setSelectedMarkerId(null); setCurrentMapId(map.id); }}>{map.name}</button>
            </span>
          ))}
        </nav>
        <div className="codex-atlas-actions">
          {currentMap && <Switch checked={currentMap.revealedToPlayers} onChange={revealMap} label={currentMap.revealedToPlayers ? "Map shown" : "Map secret"} />}
          {currentMap && <Button variant={placing ? "primary" : "secondary"} size="sm" aria-pressed={placing} onClick={() => setPlacing((value) => !value)}>{placing ? "Placing…" : "Add marker"}</Button>}
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>New map</Button>
          {currentMap && <Button variant="ghost" size="sm" onClick={deleteMap}>Delete map</Button>}
        </div>
      </div>

      {error && <p className="codex-rail-error" role="alert">{error}</p>}

      <div className="codex-atlas-body">
        {currentMap
          ? <MapSurface gmToken={gmToken} assetId={currentMap.assetId} markers={markers} placing={placing} selectedMarkerId={selectedMarkerId}
              onBackgroundClick={placeMarker} onMarkerClick={setSelectedMarkerId} onMarkerDragEnd={moveMarker} />
          : <div className="codex-main-empty"><h3>Chart your world</h3><p>Turn an uploaded map into an atlas. Drop markers on towns and dungeons, link each to a page or a deeper map, and reveal them as the party explores.</p><Button variant="primary" onClick={() => setPicking(true)}>New map</Button></div>}
        {selectedMarker && <MarkerInspector gmToken={gmToken} marker={selectedMarker} pages={pages} maps={maps} onUpdated={onMarkerUpdated} onDeleted={onMarkerDeleted} onOpenMap={(id) => { setSelectedMarkerId(null); setCurrentMapId(id); }} onOpenPage={onOpenPage} onClose={() => setSelectedMarkerId(null)} />}
      </div>

      {picking && (
        <div className="codex-asset-picker" role="dialog" aria-label="Choose a map">
          <div className="codex-asset-picker-head"><strong>Add a map</strong><button type="button" className="codex-back" onClick={() => setPicking(false)}>✕</button></div>
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
        </div>
      )}
    </div>
  );
}

function assetsEmpty(assets: readonly MapAsset[]) { return assets.length === 0; }
