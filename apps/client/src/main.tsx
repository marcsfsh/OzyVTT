import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import "@vtt/ui/styles.css";
import "./styles.css";
import { ActorRoster } from "./actors/ActorRoster";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { Notice, useConfirm, type NoticeMessage } from "./components/feedback";
import { DicePanel } from "./dice/DicePanel";
import { DOCK_POSITIONS, EncounterPanel, type DockPosition } from "./encounter/EncounterPanel";
import { CombatLogPanel } from "./encounter/CombatLog";
import { IntegrationsPanel } from "./integrations/IntegrationsPanel";
import { MapManager, type MapSelection } from "./maps/MapManager";
import { ReplayPanel } from "./replay/ReplayPanel";
import { ScenePanel } from "./scenes/ScenePanel";
import { SceneGallery } from "./scenes/SceneGallery";
import { SceneSwitcher } from "./scenes/SceneSwitcher";
import { setPreviewScene, usePreviewScene } from "./scenes/scenePreview";
import { SceneBuilder } from "./scenes/SceneBuilder";
import { EncounterMap } from "./scene/EncounterMap";
import { socket } from "./socket";
import { newId } from "./lib/ids";
import { ViewerControls } from "./viewer/ViewerControls";
import { ViewerPreviewPanel } from "./viewer/ViewerPreviewPanel";
import { ThemeToggle, Tabs, Wordmark, ToastProvider, useToast, Modal, Button, Input } from "@vtt/ui";
import { TableEventToasts } from "./scene/toasts";

const PLAYER_TOKEN_KEY = "vtt.player-token";
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...init?.headers }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Something went wrong. Please try again.");
  return body;
}

type GmTab = "scenes" | "table" | "maps" | "viewer" | "replay" | "setup";
const GM_TABS: ReadonlyArray<{ id: GmTab; label: string }> = [
  { id: "scenes", label: "Scenes" },
  { id: "table", label: "Encounter" },
  { id: "maps", label: "Map Setup" },
  { id: "viewer", label: "Viewer" },
  { id: "replay", label: "Replays" },
  { id: "setup", label: "VTT Setup" }
];

type Connection = "online" | "reconnecting" | "offline";

function App() {
  const [mode, setMode] = useState<"home" | "player" | "gm">("home");
  const [state, setState] = useState<PlayerView | GmView | null>(null);
  const [notice, setNotice] = useState<NoticeMessage>(null);
  const [password, setPassword] = useState("");
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [gmToken, setGmToken] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<MapSelection | null>(null);
  const [mapLibrary, setMapLibrary] = useState<readonly MapSelection[]>([]);
  const [gmTab, setGmTab] = useState<GmTab>("table");
  const [showViewerPreview, setShowViewerPreview] = useState(false);
  const previewSceneId = usePreviewScene();
  const [scenePrepOpen, setScenePrepOpen] = useState(false);
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    const stored = localStorage.getItem("vtt.dock-position");
    if (stored === "top" || stored === "bottom") return "right"; // top/bottom docking was removed; nearest edge is right
    return DOCK_POSITIONS.includes(stored as DockPosition) ? (stored as DockPosition) : "sidebar";
  });
  const [dockWidth, setDockWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem("vtt.dock-width"));
    return Number.isFinite(stored) && stored >= 240 ? stored : 352; // 22rem default
  });
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<Connection>("online");
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  // Undocked setup: the encounter-setup panel is sized to the map/scene panel's exact height (its
  // combatant list scrolls inside). We measure that panel live and publish it as `--setup-h` on the
  // grid, which the setup panel reads; the ResizeObserver keeps it in step as the map column reflows
  // (async image load, window resize, combat toggling). A callback ref binds it whenever the panel
  // mounts, without depending on render order.
  const tableObserverRef = useRef<ResizeObserver | null>(null);
  const measureTablePanel = useCallback((section: HTMLElement | null) => {
    tableObserverRef.current?.disconnect();
    tableObserverRef.current = null;
    if (!section) return;
    const layout = section.closest(".table-layout") as HTMLElement | null;
    const apply = () => layout?.style.setProperty("--setup-h", `${section.offsetHeight}px`);
    apply();
    tableObserverRef.current = new ResizeObserver(apply);
    tableObserverRef.current.observe(section);
  }, []);

  const fail = (text: string) => setNotice({ tone: "error", text });
  // Ephemeral acknowledgements ("Signed out", "GM password set") go to the shared toast surface;
  // errors and pending states stay inline (Notice) where they're prominent next to the auth form.
  const succeed = (text: string) => toast(text, { tone: "success" });

  useEffect(() => {
    api("/api/bootstrap/status").then(({ bootstrapped }) => setBootstrapped(bootstrapped)).catch((error) => fail(error.message));
    socket.on("state:updated", setState);
    const onConnect = () => setConnection("online");
    const onDisconnect = () => setConnection("reconnecting");
    const onReconnecting = () => setConnection("reconnecting");
    const onGaveUp = () => setConnection("offline");
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnecting);
    socket.io.on("reconnect", onConnect);
    socket.io.on("reconnect_failed", onGaveUp);
    return () => {
      socket.off("state:updated", setState);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnecting);
      socket.io.off("reconnect", onConnect);
      socket.io.off("reconnect_failed", onGaveUp);
    };
  }, []);
  useEffect(() => { localStorage.setItem("vtt.dock-position", dockPosition); }, [dockPosition]);
  useEffect(() => { localStorage.setItem("vtt.dock-width", String(dockWidth)); }, [dockWidth]);
  // The map library loads with the GM session (refreshed on returning to the Encounter tab) so
  // encounter setup can pick a battlemap directly - starting a fight never requires a Maps-tab visit.
  useEffect(() => {
    if (!gmToken || (gmTab !== "table" && gmTab !== "maps" && gmTab !== "scenes")) return;
    let cancelled = false;
    fetch("/api/v1/map-assets", { headers: { authorization: `Bearer ${gmToken}` } })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Couldn't load the map library."); return body.data.assets as ReadonlyArray<MapSelection & { kind: MapSelection["kind"] }>; })
      .then((assets) => {
        if (cancelled) return;
        const library = assets.map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind, width: asset.width, height: asset.height, calibration: asset.calibration, scale: asset.scale }));
        setMapLibrary(library);
        // Default the selection to the newest battlemap so Start is one click away on first login.
        setSelectedMap((current) => current && library.some((map) => map.id === current.id) ? current : library.find((map) => map.kind === "battlemap") ?? null);
      })
      .catch(() => { /* the Maps tab surfaces library errors; setup just stays pickable-empty */ });
    return () => { cancelled = true; };
  }, [gmToken, gmTab]);

  const joinPlayer = () => {
    setBusy(true);
    setNotice({ tone: "info", text: "Connecting to the table…" });
    const token = localStorage.getItem(PLAYER_TOKEN_KEY) ?? undefined;
    socket.auth = { token }; socket.connect();
    socket.emit("session:join", { token }, (result: SessionJoinResult) => {
      setBusy(false);
      if (!result.ok) fail(result.message ?? "Couldn't join the table. Please try again.");
      else {
        if (result.token) localStorage.setItem(PLAYER_TOKEN_KEY, result.token);
        setMode("player"); setConnection("online"); setNotice(null);
      }
    });
  };
  const loginGm = async () => {
    setBusy(true);
    try {
      const { token } = await api("/api/gm/login", { method: "POST", body: JSON.stringify({ password }) });
      setGmToken(token); socket.auth = { token }; socket.connect();
      socket.emit("session:join", { token }, (result: SessionJoinResult) => {
        setBusy(false);
        result.ok ? (setMode("gm"), setConnection("online"), setPassword(""), setNotice(null)) : fail(result.message ?? "Couldn't sign in as GM.");
      });
    } catch (error) { setBusy(false); fail((error as Error).message); }
  };
  const bootstrap = async () => {
    setBusy(true);
    try {
      await api("/api/bootstrap", { method: "POST", body: JSON.stringify({ password }) });
      setBootstrapped(true); succeed("GM password set. Enter it to begin.");
    } catch (error) { fail((error as Error).message); }
    finally { setBusy(false); }
  };
  const leaveGmSession = (text: string) => {
    socket.disconnect(); setGmToken(null); setSelectedMap(null); setGmTab("table"); setPassword(""); setMode("home"); setState(null); succeed(text);
  };
  const leavePlayer = () => {
    socket.disconnect(); setMode("home"); setState(null); setNotice(null);
  };
  const signOutGm = async () => {
    setBusy(true);
    const token = gmToken;
    try { if (token) await api("/api/gm/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } }); }
    catch (error) { setBusy(false); fail((error as Error).message); return; }
    setBusy(false);
    leaveGmSession("Signed out.");
  };
  const revokeAllGmSessions = async () => {
    const token = gmToken; if (!token) return;
    const ok = await confirm({ title: "Revoke every GM session?", body: "This signs out every GM browser, including this one. Everyone will need to sign in again.", confirmLabel: "Revoke all", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await api("/api/gm/sessions/revoke-all", { method: "POST", headers: { authorization: `Bearer ${token}` } }); }
    catch (error) { setBusy(false); fail((error as Error).message); return; }
    setBusy(false);
    leaveGmSession("All GM sessions revoked. Sign in again to continue.");
  };

  const mapToken = mode === "gm" ? gmToken : localStorage.getItem(PLAYER_TOKEN_KEY);
  // Docking is available whenever a map is loaded (a live scene), not only once combat starts, so the
  // GM can position the tracker during encounter setup too (report #9/#6). Players' projection nulls
  // mapAssetId until combat is active, so this stays GM-side and never affects the viewer.
  const combatMapActive = !!state && !!state.combat.mapAssetId;
  const showDocked = combatMapActive && dockPosition !== "sidebar";
  const encounterDock = combatMapActive ? { position: dockPosition, onChange: setDockPosition } : undefined;
  const encounterPanel = state
    ? (mode === "gm"
      ? <EncounterPanel role="gm" state={state as GmView} selectedMap={selectedMap} mapLibrary={mapLibrary} onSelectMap={setSelectedMap} dock={encounterDock} />
      : <EncounterPanel role="player" state={state as PlayerView} dock={encounterDock} />)
    : null;
  // The map dock is present whenever combat is running (even in sidebar mode) so its in-map dock
  // control is reachable from inside the enlarged map; `node` is only the panel when actually docked.
  const mapDock = combatMapActive
    ? { position: dockPosition, onChange: setDockPosition, width: dockWidth, onWidthChange: setDockWidth, node: showDocked ? encounterPanel : null }
    : undefined;
  // GM-private scene staging: when the GM is previewing a prepared scene, the table map renders THAT
  // scene (its map + staged tokens) for arranging - players and the shared screen are unaffected.
  const previewScene = mode === "gm" && previewSceneId ? (state as GmView | null)?.combat.scenes.find((scene) => scene.id === previewSceneId) ?? null : null;
  useEffect(() => {
    // Drop the preview if its scene was removed or went live (it's the live map then, not a private one).
    if (previewSceneId && !(mode === "gm" && (state as GmView | null)?.combat.scenes.some((scene) => scene.id === previewSceneId && scene.id !== (state as GmView).combat.activeSceneId))) setPreviewScene(null);
  }, [previewSceneId, state, mode]);
  useEffect(() => {
    // Staging renders on the table map - make sure the GM is looking at it, and close the picker.
    if (previewScene) { setGmTab("table"); setScenePrepOpen(false); }
  }, [previewScene]);
  const makeSceneLive = (sceneId: string) => socket.emit("scene:activate", { commandId: newId(), sceneId }, () => setPreviewScene(null));
  return <main>
    <div className="app-texture" aria-hidden="true" />
    {mode !== "home" && <TableEventToasts />}
    {mode === "home" && <header className="home-hero scanlines anim-view">
      <div className="home-hero-atmos" aria-hidden="true"><span className="home-hero-bloom" /><span className="home-hero-grid grid-floor" /></div>
      <span className="eyebrow">Your table</span>
      <h1 className="home-hero-title"><Wordmark>OzyVTT</Wordmark></h1>
      <p>Combat-first D&amp;D 5e, hosted by your group. Table ready.</p>
      <div className="home-theme-switch"><ThemeToggle /></div>
    </header>}
    {mode !== "home" && connection !== "online" && <p className="connection-banner" role="status">{connection === "reconnecting" ? "Reconnecting to the table…" : "Connection lost. Trying to reconnect…"}</p>}
    <Notice notice={notice} />
    {mode === "home" && <section className="choices anim-view">
      <button className="lift" onClick={joinPlayer} disabled={busy}><strong>Join as Player</strong><span>Choose your character and take your seat.</span><span className="nav-arrow" aria-hidden="true">→</span></button>
      <button className="secondary lift" onClick={() => { setNotice(null); setMode("gm"); }}><strong>Enter as GM</strong><span>Run the table, encounter, and hidden information.</span><span className="nav-arrow" aria-hidden="true">→</span></button>
    </section>}
    {mode === "gm" && !gmToken && <section className="card anim-view">
      <h2>{bootstrapped ? "GM sign-in" : "Set up the GM password"}</h2>
      <p>{bootstrapped ? "Enter the GM password to run the table." : "Do this once, on the host machine, before players join."}</p>
      <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="GM password" autoFocus onKeyDown={(event) => { if (event.key === "Enter" && !busy) (bootstrapped ? loginGm() : bootstrap()); }} />
      <Button variant="primary" onClick={bootstrapped ? loginGm : bootstrap} disabled={busy || !password}>{busy ? "Please wait…" : bootstrapped ? "Enter table" : "Set GM password"}{!busy && <span className="nav-arrow" aria-hidden="true">→</span>}</Button>
      <Button variant="ghost" className="link" onClick={() => { setNotice(null); setMode("home"); }}>Back</Button>
    </section>}
    {mode !== "home" && state && <>
      {/* The roster is a lobby surface (claiming characters, pre-fight prep). During a live
          encounter it duplicates the combat tracker at several times the size, so it collapses to
          one quiet line - still one tap away for a player joining mid-fight. */}
      {state.combat.active
        ? <details className="roster-collapsed"><summary>Characters &amp; claims</summary><ActorRoster {...(mode === "gm" ? { role: "gm" as const, state: state as GmView } : { role: "player" as const, state: state as PlayerView })} /></details>
        : <ActorRoster {...(mode === "gm" ? { role: "gm" as const, state: state as GmView } : { role: "player" as const, state: state as PlayerView })} />}

      {mode === "gm" && <Tabs
        className="gm-tabs"
        ariaLabel="GM sections"
        tabs={GM_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeId={gmTab}
        onChange={(id) => setGmTab(id as GmTab)}
      />}

      {(mode === "player" || gmTab === "table") && <div className={`table-layout anim-view${showDocked ? " docked" : ""}`}>
        <section className="table" ref={measureTablePanel}>
          {/* Scene IA lives where the GM plays: stage, switch, and create scenes from one strip.
              Guarded on the field, not just the mode - the first state after login can still be
              player-projected (no scenes) until the session join lands. */}
          {mode === "gm" && Array.isArray((state as GmView).combat.scenes) && <SceneSwitcher scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} onNewScene={() => setScenePrepOpen(true)} onFeedback={(text) => setNotice({ tone: "error", text })} />}
          {previewScene ? <>
            <div className="scene-preview-banner" role="status">Staging <strong>{previewScene.name}</strong> - only you see this. Drag tokens from the tray to place them, then use the map buttons to go back or make it live.</div>
            <EncounterMap assetId={previewScene.mapAssetId} token={mapToken} altText={`Staging ${previewScene.name}`} role="gm" actors={state.actors} tokens={previewScene.combat.tokens} annotations={[]} revision={state.revision} activeActorId={null} fog={previewScene.combat.fog} moveSceneId={previewScene.id} onScenePrep={() => setScenePrepOpen(true)} staging={{ onBackToLive: () => setPreviewScene(null), onMakeLive: () => makeSceneLive(previewScene.id) }} healthDisplay={previewScene.combat.healthDisplay} />
          </> : <>
          {!state.combat.active && state.combat.mapAssetId && <p className="table-status">{mode === "gm" ? "Scene is live - add combatants and start the encounter from the panel below." : "Waiting for the GM to start combat."}</p>}
          {!state.combat.active && !state.combat.mapAssetId && <p className="table-status">{mode === "gm" ? "No encounter running yet. Start one from the Encounter panel." : "No encounter running yet. The GM will start combat when everyone's ready."}</p>}
          {/* Render the map once a scene is live (has a map) even before combat starts, so making a
              prepared scene live shows it instead of a blank "no map" page. Players still only get the
              map once combat is active (their projection nulls mapAssetId until then). */}
          {state.combat.mapAssetId ? <EncounterMap
            assetId={state.combat.mapAssetId}
            token={mapToken}
            altText={selectedMap?.id === state.combat.mapAssetId ? selectedMap.name : "Battle map"}
            role={mode}
            actors={state.actors}
            tokens={state.combat.tokens}
            annotations={state.combat.annotations}
            revision={state.revision}
            activeActorId={state.combat.turnActorId}
            reactionsUsed={state.combat.reactionsUsed}
            fog={state.combat.fog}
            dock={mapDock}
            onScenePrep={mode === "gm" ? () => setScenePrepOpen(true) : undefined}
            healthDisplay={mode === "gm" ? (state as GmView).combat.healthDisplay : undefined}
          /> : <div className="empty map-empty-hero scanlines"><div className="empty-atmos" aria-hidden="true"><span className="home-hero-bloom" /><span className="home-hero-grid grid-floor" /></div><strong>No map loaded yet</strong><span>{mode === "gm" ? "Upload a map on the Maps tab, then start an encounter - or open Scene prep to stage one." : "The GM will load the battle map when combat begins."}</span>{mode === "gm" && <button type="button" className="empty-scene-prep" onClick={() => setScenePrepOpen(true)}>🎬 Scene prep</button>}</div>}
          </>}
          {mode === "gm" && gmToken && !previewScene && <Button variant="secondary" className="viewer-preview-toggle" aria-pressed={showViewerPreview} onClick={() => setShowViewerPreview((current) => !current)}>{showViewerPreview ? "Hide viewer preview" : "Preview what players see"}</Button>}
        </section>
        <div className="table-sidebar">
          {previewScene
            ? <SceneBuilder scene={previewScene} actors={(state as GmView).actors} revision={state.revision} />
            : !showDocked && encounterPanel}
          {/* Mid-fight the column belongs to the tracker; dice and the log sit one tap away. */}
          {state.combat.active
            ? <>
                <details className="sidebar-collapsed"><summary>Dice</summary><DicePanel role={mode} state={state} /></details>
                <details className="sidebar-collapsed"><summary>Combat log</summary><CombatLogPanel /></details>
              </>
            : <>
                <DicePanel role={mode} state={state} />
                <CombatLogPanel />
              </>}
          {mode === "player" && <section className="gm-session-controls"><Button variant="secondary" onClick={leavePlayer}>Leave table</Button></section>}
        </div>
      </div>}

      {mode === "gm" && gmToken && gmTab === "scenes" && Array.isArray((state as GmView).combat.scenes) && <div className="anim-view"><SceneGallery scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} onNewScene={() => setScenePrepOpen(true)} onFeedback={(text) => setNotice({ tone: "error", text })} /></div>}

      {mode === "gm" && gmToken && gmTab === "maps" && <div className="anim-view"><MapManager gmToken={gmToken} preferredMapId={(state as GmView).combat.mapAssetId} onSelectionChange={setSelectedMap} /></div>}
      {/* Scenes moved to the Encounter tab's switcher strip; Map Setup is purely library management. */}

      {mode === "gm" && gmToken && gmTab === "viewer" && <div className="anim-view"><ViewerControls gmToken={gmToken} {...(selectedMap ? { map: { assetId: selectedMap.id, width: selectedMap.width, height: selectedMap.height, altText: selectedMap.name, calibration: selectedMap.calibration, scale: selectedMap.scale, ...(selectedMap.previewUrl ? { previewUrl: selectedMap.previewUrl } : {}) } } : {})} /></div>}

      {mode === "gm" && gmToken && gmTab === "replay" && <div className="anim-view"><ReplayPanel gmToken={gmToken} /></div>}

      {mode === "gm" && gmToken && showViewerPreview && <ViewerPreviewPanel gmToken={gmToken} onClose={() => setShowViewerPreview(false)} />}

      {mode === "gm" && gmToken && scenePrepOpen && state && <Modal open onClose={() => setScenePrepOpen(false)} size="lg" className="scene-prep-modal" title="Scene prep" ariaLabel="Scene prep">
        <ScenePanel actors={(state as GmView).actors} selectedMap={selectedMap} mapLibrary={mapLibrary} onCreated={() => setScenePrepOpen(false)} />
      </Modal>}

      {mode === "gm" && gmToken && gmTab === "setup" && <div className="anim-view">
        <section className="setup-appearance"><span className="eyebrow">APPEARANCE</span><ThemeToggle /></section>
        <IntegrationsPanel gmToken={gmToken} />
        <section className="gm-session-controls"><Button variant="secondary" onClick={signOutGm} disabled={busy}>Sign out</Button><Button variant="destructive" onClick={revokeAllGmSessions} disabled={busy}>Revoke all GM sessions</Button></section>
      </div>}
    </>}
    {dialog}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><AppErrorBoundary><ToastProvider><App /></ToastProvider></AppErrorBoundary></StrictMode>);
