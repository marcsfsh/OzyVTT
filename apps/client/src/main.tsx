import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import "@vtt/ui/styles.css";
import "./styles.css";
import { ActorRoster, YouArePlaying } from "./actors/ActorRoster";
import { PartyRosterTab } from "./actors/PartyRosterTab";
import { CharacterBuilder } from "./builder/CharacterBuilder";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { Notice, useConfirm, type NoticeMessage } from "./components/feedback";
import { DicePanel } from "./dice/DicePanel";
import { DOCK_POSITIONS, EncounterPanel, type DockPosition } from "./encounter/EncounterPanel";
import { CombatLogPanel } from "./encounter/CombatLog";
import { IntegrationsPanel } from "./integrations/IntegrationsPanel";
import { MapManager, type MapSelection } from "./maps/MapManager";
import { ReplayPanel } from "./replay/ReplayPanel";
import { CodexShell } from "./codex/CodexShell";
import { PlayerCodex } from "./codex/PlayerCodex";
import { useRecapBadge } from "./codex/useRecapBadge";
import { HomebrewPanel } from "./homebrew/HomebrewPanel";
import { ScenePanel } from "./scenes/ScenePanel";
import { SceneGallery } from "./scenes/SceneGallery";
import { setPreviewScene, usePreviewScene } from "./scenes/scenePreview";
import { SceneBuilder } from "./scenes/SceneBuilder";
import { EncounterMap } from "./scene/EncounterMap";
import { socket } from "./socket";
import { currentHref, gmTabForPath, isGmOnlyPath, isKnownPath, navigate, pathForGmTab, rememberLocation, resumeTarget, useRoute, type GmTab } from "./router";
import { NotFoundView } from "./components/NotFoundView";
import { newId } from "./lib/ids";
import { ViewerControls } from "./viewer/ViewerControls";
import { ViewerPreviewPanel } from "./viewer/ViewerPreviewPanel";
import { ThemeToggle, Tabs, Wordmark, ToastProvider, useToast, Modal, Badge, Button, Input } from "@vtt/ui";
import { TableEventToasts } from "./scene/toasts";

const PLAYER_TOKEN_KEY = "vtt.player-token";
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...init?.headers }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Something went wrong. Please try again.");
  return body;
}

// v4 #10: reordered to Encounter | Scenes | Character Roster | ... | VTT Setup; Viewer is kept (it drives
// the shared screen) and placed after Character Roster.
const GM_TABS: ReadonlyArray<{ id: GmTab; label: string }> = [
  { id: "table", label: "Encounter" },
  { id: "scenes", label: "Scenes" },
  { id: "roster", label: "Character Roster" },
  { id: "codex", label: "Codex" },
  // Immediately after Codex: the two GM authoring surfaces sit adjacent, and Homebrew
  // is not the eighth-and-furthest label in the tab bar's scroll container.
  { id: "homebrew", label: "Homebrew" },
  { id: "viewer", label: "Viewer" },
  { id: "replay", label: "Replays" },
  { id: "setup", label: "VTT Setup" }
];

type Connection = "online" | "reconnecting" | "offline";

function App() {
  const [mode, setMode] = useState<"home" | "player" | "gm">("home");
  /**
   * D3 — the app's addresses. `gmTab` is no longer state: it is READ from the route, and every
   * `setGmTab` becomes a `navigate`. The render trees below are untouched; only what selects them moved.
   */
  const route = useRoute();
  /**
   * D3: which GM tab the address names. An address that names none — `/`, `/table`, `/codex/pages/x` —
   * resolves through the table below, and an unknown one renders the not-found view.
   */
  const gmTab: GmTab = gmTabForPath(route.path) ?? "table";
  const setGmTab = (next: GmTab) => navigate(pathForGmTab(next));
  /** D4: the player's two views. Every address that is not the Codex is the table. */
  const playerView: "table" | "codex" = route.segments[0] === "codex" ? "codex" : "table";
  /** The player is READING the Codex, so the table's own furniture above it is not what they asked for. */
  const playerCodexOpen = mode === "player" && playerView === "codex";
  const [state, setState] = useState<PlayerView | GmView | null>(null);
  const [notice, setNotice] = useState<NoticeMessage>(null);
  const [password, setPassword] = useState("");
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [gmToken, setGmToken] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<MapSelection | null>(null);
  const [mapLibrary, setMapLibrary] = useState<readonly MapSelection[]>([]);
  // A Codex combat entry can jump to the archived fight it came from (GM-only; archives carry GM
  // narration). D3: the latch is the address now — `/replays?archive=<id>`.
  const replayArchiveId = route.query.get("archive") ? Number(route.query.get("archive")) : null;
  // The character builder is a FULL PAGE (decision 4), so it replaces the app body rather than
  // floating over it in a modal — the shell's tabs and roster would otherwise scroll behind it.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [showViewerPreview, setShowViewerPreview] = useState(false);
  const previewSceneId = usePreviewScene();
  const [scenePrepOpen, setScenePrepOpen] = useState(false);
  // The Scenes tab shows the gallery by default; "Manage maps" swaps in the map library/calibration
  // surface (folded in from the retired Map Setup tab) without leaving the scene-prep home.
  // `?view=maps` preserves the Manage-maps sub-view as an address.
  const scenesView: "gallery" | "maps" = route.query.get("view") === "maps" ? "maps" : "gallery";
  const setScenesView = (next: "gallery" | "maps") => navigate(next === "maps" ? "/scenes?view=maps" : "/scenes");
  const [scenesModalOpen, setScenesModalOpen] = useState(false);
  // A freshly created scene auto-opens for private staging. We can't stage it until it lands in
  // GameState (its id would be dropped by the preview-guard below), so hold the id and stage on arrival.
  const [pendingStageSceneId, setPendingStageSceneId] = useState<string | null>(null);
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
  /**
   * D2 — **the Codex reopens where you left it.** Every address visited while authenticated is
   * remembered; a fresh sign-in that did NOT deep-link resumes there. A deep link always wins: the login
   * screen renders *at* the requested path, so after auth the requested view is what appears.
   *
   * The GM token lives in React state only, so a hard refresh still passes through the login screen —
   * the requested path survives it, which is what "refresh-proof" means for everything after auth.
   * Persisting the token would be an auth change, and this lane does not make one.
   */
  useEffect(() => {
    if (mode === "home") return;
    if (mode === "gm" && !gmToken) return;
    rememberLocation(mode === "gm" ? "gm" : "player", currentHref());
  }, [mode, gmToken, route.path, route.query]);
  useEffect(() => {
    if (mode === "gm" && gmToken) {
      const target = resumeTarget("gm", route.path);
      if (target) navigate(target, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, gmToken]);
  useEffect(() => {
    if (mode !== "player") return;
    // Invariant §3.2: a player who deep-linked a GM-only address gets the not-found view, not a redirect
    // that would confirm the address means something. Only the resume default is rewritten here.
    const target = resumeTarget("player", route.path);
    if (target) { navigate(target, { replace: true }); return; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => { localStorage.setItem("vtt.dock-position", dockPosition); }, [dockPosition]);
  useEffect(() => { localStorage.setItem("vtt.dock-width", String(dockWidth)); }, [dockWidth]);
  // The map library loads with the GM session (refreshed on returning to the Encounter tab) so
  // encounter setup can pick a battlemap directly - starting a fight never requires a Maps-tab visit.
  useEffect(() => {
    if (!gmToken || (gmTab !== "table" && gmTab !== "scenes")) return;
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
      .catch(() => { /* the maps view surfaces library errors; setup just stays pickable-empty */ });
    return () => { cancelled = true; };
    // Re-fetch when the maps sub-view closes so a just-uploaded battlemap shows up in the scene pickers.
  }, [gmToken, gmTab, scenesView]);

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
    socket.disconnect(); setGmToken(null); setSelectedMap(null); setPassword(""); setMode("home"); setState(null); navigate("/"); succeed(text);
  };
  const leavePlayer = () => {
    socket.disconnect(); setMode("home"); setState(null); setNotice(null); navigate("/");
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
  // CT-3: "a recap you haven't read". Called unconditionally (hooks rules) with a null token for the GM,
  // where it does nothing — the badge belongs to the player's Open Codex button and to nothing else.
  const recapBadge = useRecapBadge(mode === "player" ? mapToken : null);
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
    // Auto-stage a just-created scene the moment it appears in state. (A future "auto-staging" personal
    // setting on the VTT Settings tab will gate this — see docs/ai-ledger/known-bugs.md.)
    if (pendingStageSceneId && mode === "gm" && (state as GmView | null)?.combat.scenes.some((scene) => scene.id === pendingStageSceneId)) {
      setPreviewScene(pendingStageSceneId);
      setPendingStageSceneId(null);
    }
  }, [pendingStageSceneId, state, mode]);
  const activeScene = mode === "gm" && state
    ? (state as GmView).combat.scenes?.find((scene) => scene.id === (state as GmView).combat.activeSceneId) ?? null
    : null;
  const activeSceneName = activeScene?.name ?? "Scenes";
  useEffect(() => {
    // Staging renders on the table map - make sure the GM is looking at it, and close the pickers.
    if (previewScene) { navigate(pathForGmTab("table")); setScenePrepOpen(false); setScenesModalOpen(false); }
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
    {mode === "gm" && gmToken && state && builderOpen && <CharacterBuilder
      state={state}
      sessionKey="gm"
      /* The builder covers the viewport, so the connection banner above is painted over. It gates
         its own last step on this instead. */
      connection={connection}
      onClose={() => setBuilderOpen(false)}
      onCreated={(name) => setNotice({ tone: "success", text: `${name} joined the roster — ready to claim.` })}
    />}
    {mode !== "home" && state && !builderOpen && <>
      {/* The roster is a lobby surface (claiming characters, pre-fight prep). During a live encounter it
          duplicates the combat tracker at several times the size, so it collapses behind one "Character
          Roster" disclosure - the arrow is the only toggle (v5 #6.1) - still one tap away mid-fight. */}
      {/* v5 #7: a player's own character is no longer inside the roster; it rides the always-shown
          YouArePlaying bar below, so the roster can collapse for both roles without hiding their identity. */}
      {/* D4 moved the player Codex out of a top-layer `<dialog>.showModal()` and into document flow. The
          roster and the YouArePlaying bar sit above it, and out of combat the roster is a full one-column
          card grid at =<760px — so a player tapping Codex, reloading, or following a deep link landed at
          scroll 0 looking at the party roster with the Codex about 1500px below it. The modal it replaced
          was visible immediately regardless of scroll, which makes this a regression D4 introduced rather
          than the shell's pre-existing tab problem. The Codex is a WHOLE VIEW of the player app: while it
          is open, the table's furniture is not what they asked for. (The GM's Codex tab has the same
          shell above it, but the Codex was already GM_TABS[3] before this engagement — see
          known-bugs.md — so that half stays out of this pass.) */}
      {!playerCodexOpen && (state.combat.active
        ? <details className="roster-collapsed"><summary>Character Roster</summary><ActorRoster {...(mode === "gm" ? { role: "gm" as const, state: state as GmView, onCreateCharacter: () => setBuilderOpen(true) } : { role: "player" as const, state: state as PlayerView })} /></details>
        : <ActorRoster {...(mode === "gm" ? { role: "gm" as const, state: state as GmView, onCreateCharacter: () => setBuilderOpen(true) } : { role: "player" as const, state: state as PlayerView })} />)}
      {mode === "player" && !playerCodexOpen && <YouArePlaying state={state as PlayerView} />}

      {mode === "gm" && <Tabs
        className="gm-tabs"
        ariaLabel="GM sections"
        tabs={GM_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeId={gmTab}
        onChange={(id) => setGmTab(id as GmTab)}
      />}
      {/* D3: an address the app does not answer, and a GM-only address asked for by a player, both land
          here — indistinguishable on purpose (invariant §3.2). */}
      {mode === "gm" && gmToken && !isKnownPath(route.path) && <NotFoundView role="gm" />}

      {/* D4 — the player Codex is a VIEW of the player app now, not a modal over the table. The two
          are a switcher, at real addresses (`/table` and `/codex/*`), so the Android back gesture walks
          between them and a player can be sent a link to a page.
          CT-3: the recap count rides INSIDE the switching affordance, so it is part of its accessible
          name ("Codex, 2 new") rather than a coloured dot a screen reader never reaches. */}
      {mode === "player" && <Tabs
        className="player-view-tabs"
        ariaLabel="Table or Codex"
        tabs={[
          { id: "table", label: "Table" },
          { id: "codex", label: <>Codex{recapBadge.unread > 0 && <> <Badge tone="info" solid>{recapBadge.unread} new</Badge></>}</> }
        ]}
        activeId={playerView}
        onChange={(id) => { if (id === "codex") recapBadge.markSeen(); navigate(id === "codex" ? "/codex" : "/table"); }}
      />}
      {mode === "player" && playerView === "codex" && mapToken && <div className="anim-view codex-anim"><PlayerCodex token={mapToken} /></div>}
      {/* A player on a GM-only or unknown address: the not-found view, indistinguishable from each other
          and from a genuinely unknown address (invariant §3.2). */}
      {mode === "player" && playerView === "table" && (isGmOnlyPath(route.path) || !isKnownPath(route.path)) && <NotFoundView role="player" />}

      {((mode === "player" && playerView === "table" && !isGmOnlyPath(route.path) && isKnownPath(route.path)) || (mode === "gm" && gmTab === "table" && route.segments[0] !== "codex")) && <div className={`table-layout anim-view${showDocked ? " docked" : ""}`}>
        <section className="table" ref={measureTablePanel}>
          {/* Scene IA lives where the GM plays: stage, switch, and create scenes from one strip.
              Guarded on the field, not just the mode - the first state after login can still be
              player-projected (no scenes) until the session join lands. */}
          {mode === "gm" && Array.isArray((state as GmView).combat.scenes) && <div className="scenes-open-row">
            <Button variant="secondary" className="scenes-open" aria-label={activeScene ? `Scenes — ${activeScene.name} is live` : "Scenes"} onClick={() => setScenesModalOpen(true)}><span className="scenes-open-icon" aria-hidden="true">🎬</span>{activeSceneName}<span className="scenes-open-caret" aria-hidden="true">▾</span></Button>
          </div>}
          {previewScene ? <>
            <div className="scene-preview-banner" role="status">Staging <strong>{previewScene.name}</strong> - only you see this. Drag tokens from the tray to place them, then use the map buttons to go back or make it live.</div>
            <EncounterMap assetId={previewScene.mapAssetId} token={mapToken} altText={`Staging ${previewScene.name}`} role="gm" actors={state.actors} tokens={previewScene.combat.tokens} annotations={[]} revision={state.revision} activeActorId={null} fog={previewScene.combat.fog} moveSceneId={previewScene.id} onScenePrep={() => setScenePrepOpen(true)} staging={{ onBackToLive: () => setPreviewScene(null), onMakeLive: () => makeSceneLive(previewScene.id) }} healthDisplay={previewScene.combat.healthDisplay} state={state} />
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
            state={state}
          /> : <div className="empty map-empty-hero scanlines"><div className="empty-atmos" aria-hidden="true"><span className="home-hero-bloom" /><span className="home-hero-grid grid-floor" /></div><strong>No map loaded yet</strong><span>{mode === "gm" ? "Prepare a scene from the Scenes tab - pick a map and who's in it, then go live." : "The GM will load the battle map when combat begins."}</span>{mode === "gm" && <button type="button" className="empty-scene-prep" onClick={() => setScenePrepOpen(true)}>🎬 Scene prep</button>}</div>}
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

      {mode === "gm" && gmToken && gmTab === "scenes" && Array.isArray((state as GmView).combat.scenes) && <div className="anim-view">
        {scenesView === "maps"
          ? <div className="scenes-maps-view">
              <Button variant="ghost" className="scenes-back" onClick={() => setScenesView("gallery")}>← Back to scenes</Button>
              <MapManager gmToken={gmToken} preferredMapId={(state as GmView).combat.mapAssetId} onSelectionChange={setSelectedMap} />
            </div>
          : <SceneGallery scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} liveCombatantCount={(state as GmView).combat.initiative.length} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} onNewScene={() => setScenePrepOpen(true)} onManageMaps={() => setScenesView("maps")} onClose={() => navigate(pathForGmTab("table"))} onFeedback={(text) => setNotice({ tone: "error", text })} />}
      </div>}

      {mode === "gm" && gmToken && gmTab === "viewer" && <div className="anim-view"><ViewerControls gmToken={gmToken} {...(selectedMap ? { map: { assetId: selectedMap.id, width: selectedMap.width, height: selectedMap.height, altText: selectedMap.name, calibration: selectedMap.calibration, scale: selectedMap.scale, ...(selectedMap.previewUrl ? { previewUrl: selectedMap.previewUrl } : {}) } } : {})} /></div>}

      {mode === "gm" && gmToken && gmTab === "roster" && <div className="anim-view"><PartyRosterTab state={state as GmView} /></div>}
      {mode === "gm" && gmToken && gmTab === "replay" && <div className="anim-view"><ReplayPanel gmToken={gmToken} openArchiveId={replayArchiveId} onOpenedArchive={() => navigate("/replays", { replace: true })} /></div>}
      {mode === "gm" && gmToken && route.segments[0] === "codex" && <div className="anim-view codex-anim"><CodexShell gmToken={gmToken}
        scenes={(state as GmView | null)?.combat?.scenes?.map((scene) => ({ id: scene.id, name: scene.name })) ?? []}
        actors={(state as GmView | null)?.actors?.map((actor) => ({ id: actor.id, name: actor.name })) ?? []}
        activeSceneId={(state as GmView | null)?.combat?.activeSceneId ?? null}
        onActivateScene={(sceneId: string) => { makeSceneLive(sceneId); navigate(pathForGmTab("table")); }}
        onOpenReplay={(archiveId: number) => navigate(`/replays?archive=${archiveId}`)} /></div>}

      {mode === "gm" && gmToken && gmTab === "homebrew" && <div className="anim-view"><HomebrewPanel gmToken={gmToken} /></div>}

      {mode === "gm" && gmToken && showViewerPreview &&<ViewerPreviewPanel gmToken={gmToken} onClose={() => setShowViewerPreview(false)} />}

      {mode === "gm" && gmToken && scenePrepOpen && state && <Modal open onClose={() => setScenePrepOpen(false)} size="lg" className="scene-prep-modal" title="Scene prep" ariaLabel="Scene prep">
        <ScenePanel actors={(state as GmView).actors} selectedMap={selectedMap} mapLibrary={mapLibrary} onCreated={(sceneId) => { setScenePrepOpen(false); if (sceneId) setPendingStageSceneId(sceneId); }} onManageMaps={() => { setScenePrepOpen(false); navigate("/scenes?view=maps"); }} />
      </Modal>}

      {mode === "gm" && gmToken && scenesModalOpen && state && Array.isArray((state as GmView).combat.scenes) && <Modal open onClose={() => setScenesModalOpen(false)} size="lg" className="scenes-modal" title="Scenes" ariaLabel="Scenes">
        <SceneGallery scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} liveCombatantCount={(state as GmView).combat.initiative.length} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} hideHeading onNewScene={() => { setScenesModalOpen(false); setScenePrepOpen(true); }} onManageMaps={() => { setScenesModalOpen(false); navigate("/scenes?view=maps"); }} onClose={() => setScenesModalOpen(false)} onFeedback={(text) => setNotice({ tone: "error", text })} />
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
