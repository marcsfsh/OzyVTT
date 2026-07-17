import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import "./styles.css";
import { ActorRoster } from "./actors/ActorRoster";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { Notice, useConfirm, type NoticeMessage } from "./components/feedback";
import { DicePanel } from "./dice/DicePanel";
import { DOCK_POSITIONS, EncounterPanel, type DockPosition } from "./encounter/EncounterPanel";
import { IntegrationsPanel } from "./integrations/IntegrationsPanel";
import { MapManager, type MapSelection } from "./maps/MapManager";
import { ScenePanel } from "./scenes/ScenePanel";
import { EncounterMap } from "./scene/EncounterMap";
import { socket } from "./socket";
import { ViewerControls } from "./viewer/ViewerControls";
import { ViewerPreviewPanel } from "./viewer/ViewerPreviewPanel";

const PLAYER_TOKEN_KEY = "vtt.player-token";
async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...init?.headers }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Something went wrong. Please try again.");
  return body;
}

type GmTab = "table" | "maps" | "viewer" | "setup";
const GM_TABS: ReadonlyArray<{ id: GmTab; label: string }> = [
  { id: "table", label: "Encounter" },
  { id: "maps", label: "Map Setup" },
  { id: "viewer", label: "Viewer" },
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
  const [gmTab, setGmTab] = useState<GmTab>("table");
  const [showViewerPreview, setShowViewerPreview] = useState(false);
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

  const fail = (text: string) => setNotice({ tone: "error", text });
  const succeed = (text: string) => setNotice({ tone: "success", text });

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
  const combatMapActive = !!state && state.combat.active && !!state.combat.mapAssetId;
  const showDocked = combatMapActive && dockPosition !== "sidebar";
  const encounterDock = combatMapActive ? { position: dockPosition, onChange: setDockPosition } : undefined;
  const encounterPanel = state
    ? (mode === "gm"
      ? <EncounterPanel role="gm" state={state as GmView} selectedMap={selectedMap} dock={encounterDock} />
      : <EncounterPanel role="player" state={state as PlayerView} dock={encounterDock} />)
    : null;
  // The map dock is present whenever combat is running (even in sidebar mode) so its in-map dock
  // control is reachable from inside the enlarged map; `node` is only the panel when actually docked.
  const mapDock = combatMapActive
    ? { position: dockPosition, onChange: setDockPosition, width: dockWidth, onWidthChange: setDockWidth, node: showDocked ? encounterPanel : null }
    : undefined;
  return <main>
    <header><span className="eyebrow">YOUR TABLE</span><h1>Table ready.</h1><p>Combat-first D&amp;D 5e, hosted by your group.</p></header>
    {mode !== "home" && connection !== "online" && <p className="connection-banner" role="status">{connection === "reconnecting" ? "Reconnecting to the table…" : "Connection lost. Trying to reconnect…"}</p>}
    <Notice notice={notice} />
    {mode === "home" && <section className="choices">
      <button onClick={joinPlayer} disabled={busy}><strong>Join as Player</strong><span>Choose your character and take your seat.</span></button>
      <button className="secondary" onClick={() => { setNotice(null); setMode("gm"); }}><strong>Enter as GM</strong><span>Run the table, encounter, and hidden information.</span></button>
    </section>}
    {mode === "gm" && !gmToken && <section className="card">
      <h2>{bootstrapped ? "GM sign-in" : "Set up the GM password"}</h2>
      <p>{bootstrapped ? "Enter the GM password to run the table." : "Do this once, on the host machine, before players join."}</p>
      <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="GM password" autoFocus onKeyDown={(event) => { if (event.key === "Enter" && !busy) (bootstrapped ? loginGm() : bootstrap()); }} />
      <button onClick={bootstrapped ? loginGm : bootstrap} disabled={busy || !password}>{busy ? "Please wait…" : bootstrapped ? "Enter table" : "Set GM password"}</button>
      <button className="link" onClick={() => { setNotice(null); setMode("home"); }}>Back</button>
    </section>}
    {mode !== "home" && state && <>
      <ActorRoster {...(mode === "gm" ? { role: "gm" as const, state: state as GmView } : { role: "player" as const, state: state as PlayerView })} />

      {mode === "gm" && <nav className="gm-tabs" aria-label="GM sections">
        {GM_TABS.map((tab) => <button key={tab.id} aria-pressed={gmTab === tab.id} onClick={() => setGmTab(tab.id)}>{tab.label}</button>)}
      </nav>}

      {(mode === "player" || gmTab === "table") && <div className="table-layout">
        <section className="table">
          <div><span className="eyebrow">{mode === "gm" ? "GM VIEW" : "AT THE TABLE"}</span><h2>Battle map</h2><p>{state.combat.active ? `Encounter running · Round ${state.combat.round}` : mode === "gm" ? "No encounter running yet. Start one from the Encounter panel." : "No encounter running yet. The GM will start combat when everyone's ready."}</p></div>
          {state.combat.active && state.combat.mapAssetId ? <EncounterMap
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
            dock={mapDock}
          /> : <div className="empty"><strong>No map loaded yet</strong><span>{mode === "gm" ? "Upload a map on the Maps tab, then start an encounter to place tokens." : "The GM will load the battle map when combat begins."}</span></div>}
          {mode === "gm" && gmToken && <button type="button" className="secondary viewer-preview-toggle" aria-pressed={showViewerPreview} onClick={() => setShowViewerPreview((current) => !current)}>{showViewerPreview ? "Hide viewer preview" : "Preview what players see"}</button>}
        </section>
        <div className="table-sidebar">
          {!showDocked && encounterPanel}
          <DicePanel role={mode} state={state} />
          {mode === "player" && <section className="gm-session-controls"><button className="secondary" onClick={leavePlayer}>Leave table</button></section>}
        </div>
      </div>}

      {mode === "gm" && gmToken && gmTab === "maps" && <MapManager gmToken={gmToken} preferredMapId={(state as GmView).combat.mapAssetId} onSelectionChange={setSelectedMap} />}
      {mode === "gm" && gmToken && gmTab === "maps" && <ScenePanel scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId} combatActive={(state as GmView).combat.active} combatRound={(state as GmView).combat.round} actors={(state as GmView).actors} selectedMap={selectedMap} />}

      {mode === "gm" && gmToken && gmTab === "viewer" && <ViewerControls gmToken={gmToken} {...(selectedMap ? { map: { assetId: selectedMap.id, width: selectedMap.width, height: selectedMap.height, altText: selectedMap.name, calibration: selectedMap.calibration, scale: selectedMap.scale, ...(selectedMap.previewUrl ? { previewUrl: selectedMap.previewUrl } : {}) } } : {})} />}

      {mode === "gm" && gmToken && showViewerPreview && <ViewerPreviewPanel gmToken={gmToken} onClose={() => setShowViewerPreview(false)} />}

      {mode === "gm" && gmToken && gmTab === "setup" && <>
        <IntegrationsPanel gmToken={gmToken} />
        <section className="gm-session-controls"><button className="secondary" onClick={signOutGm} disabled={busy}>Sign out</button><button className="danger" onClick={revokeAllGmSessions} disabled={busy}>Revoke all GM sessions</button></section>
      </>}
    </>}
    {dialog}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><AppErrorBoundary><App /></AppErrorBoundary></StrictMode>);
