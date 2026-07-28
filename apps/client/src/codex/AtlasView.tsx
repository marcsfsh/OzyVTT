import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Field, IconEyeOff, Input, Modal, Select, Skeleton, Switch, TagInput } from "@vtt/ui";
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
/**
 * CI-1 / R1 ("every cross-mode jump prepares its destination"): an incoming request to *land somewhere*
 * in the atlas. A marker hit carries both halves because opening a pin means opening its map FIRST and
 * then selecting the pin — `mapId` alone lands on the wrong pin, `markerId` alone lands on the wrong map.
 *
 * CI-6 widened `mapId` to null: a journal entry stores only `attachMarkerId`, so the entry→marker edge
 * knows the pin but not the map it sits on. Rather than teach every caller to go looking, the atlas
 * resolves that itself below — this view is the only thing in the client that already knows the map list.
 */
export type AtlasTarget = Readonly<{ mapId: string | null; markerId: string | null }>;

/**
 * "Players can't see this map yet", on a drill chip. Was a literal 🔒 — design-language §0 forbids an emoji
 * as a UI glyph and names the failure mode: it renders at a platform-chosen size, in a hue the palette does
 * not own, and cannot take `currentColor`. `IconEyeOff` is the design system's own GM-only mark (the same
 * glyph `/styleguide` documents as "GM only"), so this reads identically to the rest of the app's
 * hidden-from-players vocabulary. `role="img"` + `aria-label` keeps the meaning for a screen reader, which
 * the emoji's own name ("locked") never carried.
 */
function GmOnlyMark() {
  return <span className="codex-descend-lock" role="img" aria-label="GM only" title="GM-only — players can't see this map yet"><IconEyeOff /></span>;
}

export function AtlasView({ gmToken, scenes, actors = [], activeSceneId, onOpenPage, onActivateScene, onOpenReplay, openTarget = null, onOpenedTarget = () => {} }: Readonly<{ gmToken: string; scenes: readonly AtlasScene[]; actors?: readonly AtlasActor[]; activeSceneId: string | null; onOpenPage: (pageId: string) => void; onActivateScene: (sceneId: string) => void; onOpenReplay?: (archiveId: number) => void; openTarget?: AtlasTarget | null; onOpenedTarget?: () => void }>) {
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

  // Arriving from a search hit: open the requested map, THEN select the requested marker. The pin lives
  // in `markers`, which only loads once `currentMapId` changes, so this sets the id and lets the existing
  // load effect resolve it — `selectedMarker` is derived, so the inspector opens when the pin arrives.
  // Same handled-latch shape as ReplayPanel's `openArchiveId`: without it a caller that passes a target
  // and no `onOpenedTarget` would yank the view back every time the atlas refreshes. Clearing the latch
  // when the target goes away is the one deviation — it lets the SAME pin be re-opened from a later search.
  const handledTargetRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useEffect(() => {
    if (!openTarget) { handledTargetRef.current = null; return; }
    if (loading) return; // wait for the map list either way: a failed load settles too, and must not hang the jump
    const key = `${openTarget.mapId ?? ""}:${openTarget.markerId ?? ""}`;
    if (handledTargetRef.current === key) return;
    handledTargetRef.current = key;
    if (openTarget.mapId !== null) {
      if (maps.some((map) => map.id === openTarget.mapId)) {
        setCurrentMapId(openTarget.mapId);
        setSelectedMarkerId(openTarget.markerId);
      } // No such map (deleted since the search) => the GM simply lands on the atlas they were already on.
      onOpenedTarget();
      return;
    }
    // CI-6: a pin without its map. There is no marker-by-id read on the codex surface — markers are
    // only listed per map — so the map is found by asking each one. Bounded by the size of the atlas,
    // paid only when this edge is actually used, and never on the Atlas's own load path.
    if (!openTarget.markerId) { onOpenedTarget(); return; }
    const markerId = openTarget.markerId;
    void (async () => {
      const found = await findMarkerMap(gmToken, maps, markerId);
      // Cancelled by UNMOUNT only, deliberately — not by this effect re-running. A `codex:changed` ping
      // mid-lookup gives `maps` a new identity, and a per-effect `live` flag would abandon the lookup
      // there while the latch above stops it ever being retried: the jump would just quietly do nothing.
      if (!mountedRef.current) return;
      if (found) { setError(null); setCurrentMapId(found); setSelectedMarkerId(markerId); }
      // R4: the jump failed for a reason the GM can act on — say so rather than dropping them on
      // whatever map happened to be open and letting them wonder which pin they were promised.
      else setError("That pin is no longer on any map in the atlas.");
      onOpenedTarget();
    })();
  }, [openTarget, loading, maps, onOpenedTarget, gmToken]);

  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) ?? null;
  // Hint from the tags already in use on pages and on other maps — one vocabulary across the suite.
  const tagSuggestions = useMemo(() => [...new Set([...pages.flatMap((page) => page.tags), ...maps.flatMap((map) => map.tags)])].sort(), [pages, maps]);

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
  // Saved per committed tag, matching the kind/parent selects beside it — Map settings has no Save button.
  // `tags` is always sent as a full list, so clearing the last one travels as [] and genuinely clears it.
  const retagMap = async (tags: readonly string[]) => {
    if (!currentMap) return;
    try { onMapReplace(await atlasApi.updateMap(gmToken, currentMap.id, { tags })); }
    catch (tagError) { setError(tagError instanceof Error ? tagError.message : "Couldn't save the tags."); }
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
              {!child.revealedToPlayers && <GmOnlyMark />}
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
            {/* R4: the atlas's error Alert sits behind the overlay, so a failed save in here was silent.
                Every write in this modal is immediate, which makes a visible failure the only feedback. */}
            {error && <Alert tone="danger">{error}</Alert>}
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
            <Field label="Tags" htmlFor="map-tags">
              <TagInput id="map-tags" ariaLabel="Tags" placeholder="underdark, faerun" values={currentMap.tags}
                onChange={(next) => void retagMap(next)}
                max={24} maxReachedReason="A map may carry at most 24 tags."
                suggestions={tagSuggestions}
                /* DEFAULT slugify — the server's `tags()` throws on anything that is not
                   /^[a-z0-9][a-z0-9-]*$/, so the primitive's default IS the contract. */ />
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

/**
 * CI-6: which map is this pin on? Asked in parallel across the atlas because the codex exposes markers
 * only per map (`GET /maps/:id/markers`) — there is no marker-by-id route to ask instead. A failed map
 * contributes no markers rather than failing the whole lookup, so one unreadable map cannot break a
 * jump to a pin that lives on another.
 */
async function findMarkerMap(token: string, maps: readonly CodexMap[], markerId: string): Promise<string | null> {
  const perMap = await Promise.all(maps.map(async (map) => {
    const markers = await atlasApi.listMarkers(token, map.id).catch(() => [] as CodexMarker[]);
    return markers.some((marker) => marker.id === markerId) ? map.id : null;
  }));
  return perMap.find((mapId) => mapId !== null) ?? null;
}
