import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Combobox, Field, IconEyeOff, IconPlus, Input, Modal, Select, Skeleton, Switch, TagInput, useToast } from "@vtt/ui";
import { socket } from "../socket";
import { atlasApi, type CodexMap, type CodexMapKind, type CodexMarker, type CodexPageSummary, type MapAsset } from "./api";
import { codexApi } from "./api";
import { MapSurface } from "./MapSurface";
import { MarkerInspector } from "./MarkerInspector";
import { RevealSwitch } from "./SecretMarkers";
import { useConfirm } from "../components/feedback";
import { DEFAULT_COLOR, DEFAULT_ICON } from "./icons";
import { atlasPath } from "./routes";
import type { QuickCreateRequest } from "./QuickCreate";
import type { CodexAutosaveSettings } from "./api";

/**
 * The atlas: a navigable tree of maps (world → region → local) with polymorphic markers. The GM makes a
 * map from an uploaded asset, drops markers, links them to pages / sub-maps, and reveals them to players.
 * Drill-down and breadcrumbs walk the parent chain. All state is server-owned and refreshed on codex:changed.
 */
type AtlasScene = Readonly<{ id: string; name: string }>;
type AtlasActor = Readonly<{ id: string; name: string }>;
const MAP_KINDS: ReadonlyArray<{ value: CodexMapKind; label: string }> = [
  { value: "world", label: "World" }, { value: "regional", label: "Regional" }, { value: "battlemap", label: "Battle map" }
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

export function AtlasView({ gmToken, scenes, actors = [], activeSceneId, onActivateScene, onOpenReplay, mapId, pinId, filter = "", tagFilter, autosave, onQuickCreate, onNavigate, onReplaceQuery }: Readonly<{
  gmToken: string;
  scenes: readonly AtlasScene[];
  actors?: readonly AtlasActor[];
  activeSceneId: string | null;
  onActivateScene: (sceneId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  /** D3: from `/codex/atlas/:mapId`. Null opens the first root map. */
  mapId: string | null;
  /** D3: from `?pin=`. Resolves its own map through `GET /codex/markers/{id}` when `mapId` is absent. */
  pinId: string | null;
  /** D10: in-place pin filters, in the URL so a tag chip can deep-link. */
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
   * D3: the open map is the ADDRESS. This mirror exists only for the two cases the address cannot answer
   * on its own — the very first load (no `:mapId` yet, so the first root map is chosen here and the URL
   * is rewritten to match) and a `?pin=` deep link whose map must be resolved server-side first.
   */
  const [currentMapId, setCurrentMapId] = useState<string | null>(mapId);
  useEffect(() => { if (mapId) setCurrentMapId(mapId); }, [mapId]);
  const [markers, setMarkers] = useState<CodexMarker[]>([]);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(pinId);
  useEffect(() => { if (pinId) setSelectedMarkerId(pinId); }, [pinId]);
  /**
   * "Show the pin" must SHOW the pin (`ux-principles.md` §9). It used to call `setSelectedMarkerId` alone,
   * which opens the inspector and rings the pin — neither of which helps if the pin is off the current view,
   * and on a phone the map itself is usually below the fold from this row. So the tap does both halves now:
   * this asks the surface to centre its camera (`MapSurface.centerOnMarkerId`), and the ref below brings the
   * map into the page's own viewport.
   */
  const [centerOnMarkerId, setCenterOnMarkerId] = useState<string | null>(null);
  const mapBodyRef = useRef<HTMLDivElement>(null);
  /** ≤760 the inspector sits BELOW the map, so selecting a pin must bring it into the page viewport. */
  const inspectorRef = useRef<HTMLDivElement>(null);
  const showPin = (markerId: string) => {
    setSelectedMarkerId(markerId);
    setCenterOnMarkerId(markerId);
    mapBodyRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
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
      setCurrentMapId((current) => current ?? nextMaps.find((map) => map.parentMapId === null)?.id ?? nextMaps[0]?.id ?? null);
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

  /**
   * D15 — a `?pin=` deep link with no `:mapId`: a journal entry stores only `attachMarkerId`, and a
   * search hit for a pin can arrive without one.
   *
   * This used to be a **client-side scan of every map**, one `GET /maps/:id/markers` per map, because
   * there was no marker-by-id read. There is now (`GET /codex/markers/{id}`), and that scan is DELETED
   * rather than kept as a fallback — a second way to answer one question is exactly what this overhaul
   * removes, and the scan's cost grew with the atlas.
   */
  const resolvedPinRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pinId || mapId || loading) return;
    if (resolvedPinRef.current === pinId) return;
    resolvedPinRef.current = pinId;
    let live = true;
    void codexApi.marker(gmToken, pinId)
      .then((marker) => {
        if (!live) return;
        setError(null);
        setCurrentMapId(marker.mapId);
        // Rewrite the address so the map is in the URL from here on — a refresh must land in the same place.
        onNavigate(atlasPath(marker.mapId, pinId));
      })
      // R4: say what happened. A 404 here means the pin is gone (or was never ours), and dropping the GM
      // on whatever map happened to be open, silently, is how a jump becomes a mystery. The selection is
      // cleared with it — a `?pin=` naming nothing must not leave the surface claiming a pin is chosen.
      .catch(() => {
        if (!live) return;
        setError("That pin is no longer in the atlas.");
        setSelectedMarkerId(null);
        onReplaceQuery((query) => query.delete("pin"));
      });
    return () => { live = false; };
  }, [pinId, mapId, loading, gmToken, onNavigate, onReplaceQuery]);

  const currentMap = maps.find((map) => map.id === currentMapId) ?? null;
  const selectedMarker = markers.find((marker) => marker.id === selectedMarkerId) ?? null;
  /**
   * CT-7: the party pin, if it is on the map currently open. R2's other half — the surface draws a ring
   * and the words "The party is here" on the pin itself, and this row says the same thing in the atlas
   * chrome so it is legible without hunting the map for it.
   *
   * Deliberately says NOTHING when the pin is elsewhere. Markers are listed per map (there is no
   * marker-by-id read on the codex surface), so this view honestly does not know where the party is when
   * it is not here — and "the party is not on this map" would be a claim it cannot make either, since a
   * map whose pins have not loaded looks identical.
   */
  const partyMarker = markers.find((marker) => marker.isParty) ?? null;
  /**
   * D10 — Atlas is one of the lists D10 names, and it had no filter at all. Client-side over the pins
   * already fetched for this map, so it costs no read; non-matching pins DIM rather than disappearing,
   * because a map with pins removed is a different picture of the world, not a filtered list of one.
   */
  const pinNeedle = filter.trim().toLowerCase();
  const matchesFilter = useCallback((marker: CodexMarker) =>
    (!pinNeedle || (marker.label ?? "").toLowerCase().includes(pinNeedle) || marker.tags.some((tag) => tag.includes(pinNeedle)))
    && (!tagFilter || marker.tags.includes(tagFilter)), [pinNeedle, tagFilter]);
  const filtering = pinNeedle !== "" || Boolean(tagFilter);
  const matchCount = filtering ? markers.filter(matchesFilter).length : markers.length;
  const dimmedIds = useMemo(
    () => (filtering ? new Set(markers.filter((marker) => !matchesFilter(marker)).map((marker) => marker.id)) : null),
    [filtering, markers, matchesFilter]
  );
  const pinTags = useMemo(() => [...new Set(markers.flatMap((marker) => marker.tags))].sort(), [markers]);
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
  const enterMap = useCallback((next: string) => { setSelectedMarkerId(null); onNavigate(atlasPath(next)); }, [onNavigate]);

  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  /** The shared map-asset library — the same route `MapManager` posts to, so one upload serves both. */
  const uploadAsset = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const response = await fetch(`/api/v1/map-assets?filename=${encodeURIComponent(file.name)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${gmToken}`, "content-type": file.type || "application/octet-stream" },
        body: file
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "The upload failed.");
      const next = await atlasApi.listAssets(gmToken).catch(() => assets);
      setAssets(next);
      toast("Map image uploaded.", { tone: "success" });
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "The upload failed."); }
    finally { setUploading(false); }
  };

  const createFromAsset = async (asset: MapAsset) => {
    try {
      const map = await atlasApi.createMap(gmToken, { assetId: asset.id, name: asset.name, kind: asset.kind, parentMapId: nestNew ? currentMapId : null });
      setPicking(false); await loadMeta(); onNavigate(atlasPath(map.id));
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
    catch (placeError) { setError(placeError instanceof Error ? placeError.message : "Could not place the pin."); }
  };
  const moveMarker = async (markerId: string, point: { x: number; y: number }) => {
    setMarkers((prev) => prev.map((marker) => (marker.id === markerId ? { ...marker, x: point.x, y: point.y } : marker)));
    try { await atlasApi.moveMarker(gmToken, markerId, point.x, point.y); } catch { void loadMarkers(currentMapId!); }
  };
  const onMarkerUpdated = (marker: CodexMarker) => setMarkers((prev) => prev.map((existing) => (existing.id === marker.id ? marker : existing)));
  /**
   * D7: turn a pin into a linked page. It used to create an UNTYPED page silently; it now opens the one
   * quick-create dialog with the pin's label prefilled, and links the result to the pin on success — so
   * the page starts life with a kind, and cancelling creates nothing.
   */
  const createPageForMarker = (marker: CodexMarker) => onQuickCreate({
    title: marker.label?.trim() || "",
    entityType: "location",
    onCreated: async (page) => {
      onMarkerUpdated(await atlasApi.updateMarker(gmToken, marker.id, { pageIds: [...marker.pageIds, page.id] }));
      await loadMeta();
    }
  });
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
  const deleteMap = async () => { if (currentMap && await confirm({ title: "Delete map", body: `Delete map "${currentMap.name}"? Its pins are removed.`, confirmLabel: "Delete", danger: true })) { await atlasApi.deleteMap(gmToken, currentMap.id); const parent = currentMap.parentMapId; await loadMeta(); onNavigate(parent ? atlasPath(parent) : "/codex/atlas"); } };

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
              {index > 0 && <span className="codex-crumb-sep" aria-hidden="true">›</span>}
              <button type="button" className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`} onClick={() => enterMap(map.id)}>{map.name}</button>
            </span>
          ))}
        </nav>
        <div className="codex-atlas-actions">
          {currentMap && <RevealSwitch revealed={currentMap.revealedToPlayers} onChange={revealMap} ariaLabel="Show this map to players" />}
          {currentMap && <Button variant={placing ? "primary" : "secondary"} size="sm" aria-pressed={placing} onClick={() => setPlacing((value) => !value)}>{placing ? "Placing…" : "Add pin"}</Button>}
          <Button variant="secondary" size="sm" onClick={() => { setNestNew(true); setPicking(true); }}>{currentMap ? "Add sub-map" : "New map"}</Button>
          {currentMap && <Button variant="ghost" size="sm" onClick={() => { setSettingsName(currentMap.name); setSettingsOpen(true); }}>Map settings</Button>}
        </div>
      </div>

      {currentMap && markers.length > 0 && (
        <div className="codex-atlas-filter">
          <Input aria-label="Filter pins" placeholder="Filter pins…" value={filter}
            onChange={(event) => onReplaceQuery((query) => { if (event.target.value) query.set("q", event.target.value); else query.delete("q"); })} />
          {pinTags.length > 0 && (
            <Combobox options={pinTags.map((tag) => ({ id: tag, label: `#${tag}` }))} value={tagFilter ?? null}
              onChange={(tag) => onReplaceQuery((query) => { if (tag) query.set("tag", tag); else query.delete("tag"); })}
              ariaLabel="Filter pins by tag" placeholder="Filter by tag…" />
          )}
          {filtering && <span className="codex-atlas-filtercount" role="status">{matchCount} of {markers.length} pins match</span>}
        </div>
      )}

      {childMaps.length > 0 && (
        <nav className="codex-atlas-descend" aria-label="Maps within this one">
          <span className="codex-descend-label">Drill into</span>
          {childMaps.map((child) => (
            <button key={child.id} type="button" className="codex-descend-chip" onClick={() => enterMap(child.id)}>
              <span className="codex-descend-arrow" aria-hidden="true" />{child.name}
              {!child.revealedToPlayers && <GmOnlyMark />}
            </button>
          ))}
        </nav>
      )}

      {/* CT-7 / R2: the party's position said in WORDS, not only as a ring on the map. §4 route 1 —
          `.codex-atlas-party` carries `min-height` and its one control is `Button` at its default size,
          which grows its own paint to 44px and has no `::after`. */}
      {partyMarker && (
        <div className="codex-atlas-party">
          <span className="codex-atlas-partytext">The party is on this map{partyMarker.label ? <> — <strong>{partyMarker.label}</strong></> : null}.</span>
          <Button variant="ghost" onClick={() => showPin(partyMarker.id)}>Show the pin</Button>
        </div>
      )}

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="codex-atlas-body" ref={mapBodyRef}>
        {currentMap
          ? <MapSurface token={gmToken} assetId={currentMap.assetId} markers={markers} placing={placing} selectedMarkerId={selectedMarkerId}
              dimmedMarkerIds={dimmedIds}
              centerOnMarkerId={centerOnMarkerId} onCentered={() => setCenterOnMarkerId(null)}
              onBackgroundClick={placeMarker} onMarkerClick={(markerId) => { setSelectedMarkerId(markerId); if (window.innerWidth <= 760) requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })); }} onMarkerDragEnd={moveMarker} />
          : loading ? <div className="codex-main-loading">{[0, 1, 2].map((row) => <Skeleton key={row} variant="text" />)}</div>
          : <div className="codex-main-empty"><h3>Chart your world</h3><p>Turn an uploaded map into an atlas. Drop pins on towns and dungeons, link each to a page or a deeper map, and show them to players as the party explores.</p><Button variant="primary" onClick={() => setPicking(true)}>New map</Button></div>}
        <div ref={inspectorRef} />
        {selectedMarker && <MarkerInspector key={selectedMarker.id} gmToken={gmToken} marker={selectedMarker} pages={pages} maps={maps} scenes={scenes} actors={actors} activeSceneId={activeSceneId} autosave={autosave}
          onUpdated={onMarkerUpdated} onDeleted={onMarkerDeleted} onOpenMap={enterMap} onOpenPage={(pageId) => onNavigate(`/codex/pages/${pageId}`)}
          onCreatePage={() => createPageForMarker(selectedMarker)} onRevealPage={revealLinkedPage} onRevealMap={() => void revealMap(true)} onActivateScene={onActivateScene} onOpenReplay={onOpenReplay}
          /* M12-C: setting the party clears whichever pin held it before — possibly on another map — so
             the whole map's pins are re-read rather than one row being patched. */
          onPartyChanged={async () => { if (currentMapId) await loadMarkers(currentMapId); }}
          onClose={() => setSelectedMarkerId(null)} />}
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
        {/* D15 / G5: upload HERE. The atlas used to send the GM to Scenes → Manage maps and back, which
            is the only place in the Codex that asked you to leave it to finish a job. Same shared asset
            library underneath, so a map uploaded here is available to Scenes and vice versa. */}
        <div className="codex-atlas-upload">
          <Button variant="secondary" size="sm" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
            <IconPlus /> {uploading ? "Uploading…" : "Upload a map image"}
          </Button>
          <input ref={uploadInputRef} type="file" accept="image/*" hidden onChange={(event) => { void uploadAsset(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
        {assetsEmpty(assets) ? <p className="codex-list-empty">No map images yet. Upload one to start your atlas — Scenes uses the same library.</p> : (
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
