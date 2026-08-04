import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import "@vtt/ui/styles.css";
import "./styles.css";
import { ClaimCharacter } from "./actors/ClaimCharacter";
import { PartyRosterTab } from "./actors/PartyRosterTab";
import { PartyStrip } from "./actors/PartyStrip";
import { YouArePlaying } from "./actors/YouArePlaying";
import { CharacterBuilder } from "./builder/CharacterBuilder";
import { LevelFlow } from "./builder/LevelFlow";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { Notice, useConfirm, type NoticeMessage } from "./components/feedback";
import { DicePanel } from "./dice/DicePanel";
import { DOCK_POSITIONS, EncounterPanel, type DockPosition } from "./encounter/EncounterPanel";
import { CombatLogPanel } from "./encounter/CombatLog";
import { CharacterSheet } from "./encounter/CharacterSheet";
import { TokenLibrary } from "./tokens/TokenLibrary";
import { MapManager, type MapSelection } from "./maps/MapManager";
import { ReplayList, ReplayShelf, ReplayViewer } from "./replay/ReplayPanel";
import { SettingsPage } from "./settings/SettingsPage";
import { useAutoArrange } from "./settings/preferences";
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
import { currentHref, isGmOnlyPath, isKnownPath, lastLocationForTab, layerOf, litGmTab, navigate, pathForGmTab, redirectForRetiredPath, rememberLocation, resumeTarget, useRoute, type GmTab } from "./router";
import { NotFoundView } from "./components/NotFoundView";
import { newId } from "./lib/ids";
import { ViewerControls } from "./viewer/ViewerControls";
import { ViewerPreviewPanel } from "./viewer/ViewerPreviewPanel";
import { ThemeToggle, Tabs, Wordmark, ToastProvider, useToast, IconArrow, IconChevron, IconChevronLeft, IconScene, Modal, Badge, Button, Input } from "@vtt/ui";
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
  // D28: the place is the **Table** (an "encounter" is the fight that happens on it), and the roster is
  // the **Roster** — one word, matching its address and the strip that now carries the party.
  { id: "table", label: "Table" },
  { id: "scenes", label: "Scenes" },
  { id: "roster", label: "Roster" },
  { id: "codex", label: "Codex" },
  // Immediately after Codex: the two GM authoring surfaces sit adjacent, and Homebrew
  // is not the eighth-and-furthest label in the tab bar's scroll container.
  { id: "homebrew", label: "Homebrew" },
  // D28: the tab says what it is — the controls for the shared screen — and "VTT Setup" is Settings.
  { id: "viewer", label: "Shared screen" },
  { id: "replay", label: "Replays" },
  { id: "settings", label: "Settings" }
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
  const gmTab: GmTab = litGmTab(route.path) ?? "table";
  /**
   * D2: a tab returns you to where you WERE in it, not to its front door. Re-tapping the tab you are
   * already on is the deliberate exception — that gesture means "take me to the top of this tab".
   */
  const setGmTab = (next: GmTab) =>
    navigate(next === gmTab ? pathForGmTab(next) : lastLocationForTab("gm", pathForGmTab(next).slice(1)) ?? pathForGmTab(next));
  /** D4/D24: the player's three views. Every address that is not the Codex or Settings is the table. */
  const playerView: "table" | "codex" | "settings" =
    route.segments[0] === "codex" ? "codex" : route.segments[0] === "settings" ? "settings" : "table";
  /** D29: the layer open on top of the tab — the sheet, the builder, a replay, a scene workspace. */
  const layer = layerOf(route.path);
  /**
   * Which layers REPLACE the shell. A wizard, a sheet and a replay each want the whole viewport (and
   * on a phone there is no other honest answer); the scene workspaces and the maps library are the
   * Scenes tab's own contents, so they keep the tab bar above them.
   */
  const fullPageLayer = layer !== null && layer.kind !== "maps" && layer.kind !== "scene-prep";
  /* (The shell used to hide its roster while the player read the Codex — the one surface it had been
     removed from. There is no shell roster to hide any more: the party lives on the table, so every
     view except the table is now free of it by construction rather than by exception.) */
  /**
   * D3 — an address the app does not answer, for a signed-in GM. Two rules, and the second was missing.
   *
   * (1) **Inside the Codex, `CodexShell` owns not-found.** The sidebar stays up, so a GM who followed a
   *     stale bookmark can navigate out of it instead of being handed a dead end. The app shell must
   *     therefore stand down on any `/codex/*` address, or both render and the GM reads the same
   *     heading, paragraph and pair of buttons twice, in two `role="status"` regions.
   * (2) **Outside it, the tab arms must stand down.** `gmTabForPath` falls back to "table" for an
   *     address it does not recognise, so `/nonsense` painted the whole encounter table — map, panel,
   *     dice, combat log — underneath the not-found card with the Encounter tab lit. That is the
   *     lit-tab lie D1 was raised to kill, one level up from where it was killed.
   */
  const gmAddressUnknown = !isKnownPath(route.path) && route.segments[0] !== "codex";
  const [state, setState] = useState<PlayerView | GmView | null>(null);
  const [notice, setNotice] = useState<NoticeMessage>(null);
  const [password, setPassword] = useState("");
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [gmToken, setGmToken] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<MapSelection | null>(null);
  const [mapLibrary, setMapLibrary] = useState<readonly MapSelection[]>([]);
  const [showViewerPreview, setShowViewerPreview] = useState(false);
  const previewSceneId = usePreviewScene();
  const [scenePrepOpen, setScenePrepOpen] = useState(false);
  /** Which character's token image is being picked (A11/D18) — GM anywhere, player on their own. */
  const [tokenPickerFor, setTokenPickerFor] = useState<string | null>(null);
  const autoArrange = useAutoArrange();
  // D29: the maps library is its own address, not a query view of the gallery.
  const scenesView: "gallery" | "maps" = layer?.kind === "maps" ? "maps" : "gallery";
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
  /**
   * D29 — an address that used to mean something now means somewhere else. `/encounter` is `/table`,
   * `/setup` is `/settings`, `/scenes?view=maps` is `/scenes/maps`. A redirect rather than a
   * not-found: someone's bookmark from the last build must land, and `replace` keeps Back honest.
   */
  useEffect(() => {
    if (mode === "home") return;
    const target = redirectForRetiredPath(route.path, route.query);
    if (target) navigate(target, { replace: true });
  }, [mode, route.path, route.query]);
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
  /**
   * Has this player claimed anyone? It decides which half of the player's table renders: the pre-claim
   * picker (§B4.2) or their own character. Read off the projection's own `claimStatus`, never inferred.
   */
  const playerHasClaimed = mode === "player" && !!state
    && (state as PlayerView).actors.some((actor) => actor.kind === "player-character" && actor.claimStatus === "mine");
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
    // Open a just-created scene for arranging the moment it appears in state — unless the GM has
    // turned that off in Settings → The table → New tokens (the promise that comment used to make).
    if (pendingStageSceneId && mode === "gm" && (state as GmView | null)?.combat.scenes.some((scene) => scene.id === pendingStageSceneId)) {
      if (autoArrange) setPreviewScene(pendingStageSceneId);
      setPendingStageSceneId(null);
    }
  }, [pendingStageSceneId, state, mode, autoArrange]);
  const activeScene = mode === "gm" && state
    ? (state as GmView).combat.scenes?.find((scene) => scene.id === (state as GmView).combat.activeSceneId) ?? null
    : null;
  const activeSceneName = activeScene?.name ?? "Scenes";
  useEffect(() => {
    // Staging renders on the table map - make sure the GM is looking at it, and close the pickers.
    if (previewScene) { navigate(pathForGmTab("table")); setScenePrepOpen(false); setScenesModalOpen(false); }
  }, [previewScene]);
  const makeSceneLive = (sceneId: string) => socket.emit("scene:activate", { commandId: newId(), sceneId }, () => setPreviewScene(null));
  /**
   * D30 — the landing page is ONE centred column: the wordmark, the two doors, nothing else.
   *
   * The GM password step is part of it (the buttons swap for the card), so the hero stays up rather
   * than the app appearing to change identity between two halves of the same decision.
   */
  const preAuth = mode === "home" || (mode === "gm" && !gmToken);
  return <main>
    <div className="app-texture" aria-hidden="true" />
    {mode !== "home" && <TableEventToasts />}
    {mode !== "home" && connection !== "online" && <p className="connection-banner" role="status">{connection === "reconnecting" ? "Reconnecting to the table…" : "Connection lost. Trying to reconnect…"}</p>}
    {preAuth && <div className="landing">
      {/* D30's full statement — the 80s retro-cyber title screen, layer by layer: star field, the
          slatted sun rising behind the horizon line, the grid rolling toward the viewer, analog
          grain, and the CRT vignette + scanlines the `.landing` pseudo-elements paint over it all.
          Every colour is a --landing-* token, re-skinned by the theme toggle: night, the sunset
          hour, daybreak — same composition, three skies (client call, 2026-08-04). */}
      <div className="landing-scene" aria-hidden="true">
        <span className="landing-stars-far" /><span className="landing-stars" />
        <span className="landing-skyband"><span className="landing-sun" /></span>
        <span className="landing-horizon" /><span className="landing-grid" />
        <span className="landing-noise" />
      </div>
      <header className="home-hero anim-view">
        {/* The one bold thing on the view: no eyebrow, no subtext, nothing beside it (D30). */}
        <h1 className="home-hero-title"><Wordmark>OzyVTT</Wordmark></h1>
      </header>
      {mode === "home" && <section className="choices anim-view">
        <Button variant="primary" size="md" lift onClick={joinPlayer} disabled={busy}>{busy ? "Connecting…" : "Join as Player"}<IconArrow className="nav-arrow" /></Button>
        <Button variant="secondary" lift onClick={() => { setNotice(null); setMode("gm"); }}>Enter as GM<IconArrow className="nav-arrow" /></Button>
      </section>}
      {mode === "gm" && !gmToken && <section className="card anim-view">
        <h2>{bootstrapped ? "GM sign-in" : "Set up the GM password"}</h2>
        <p>{bootstrapped ? "Enter the GM password to run the table." : "Do this once, on the host machine, before players join."}</p>
        <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="GM password" autoFocus onKeyDown={(event) => { if (event.key === "Enter" && !busy) (bootstrapped ? loginGm() : bootstrap()); }} />
        <Button variant="primary" onClick={bootstrapped ? loginGm : bootstrap} disabled={busy || !password}>{busy ? "Please wait…" : bootstrapped ? "Enter table" : "Set GM password"}{!busy && <IconArrow className="nav-arrow" />}</Button>
        <Button variant="ghost" className="link" onClick={() => { setNotice(null); setMode("home"); }}>Back</Button>
      </section>}
      {/* Auth errors are the sanctioned inline exception to toast-only feedback (§D6). */}
      <Notice notice={notice} />
      <div className="home-theme-switch"><ThemeToggle /></div>
    </div>}
    {!preAuth && <Notice notice={notice} />}
    {/* D29 — the FULL-PAGE layers. Each was component state (`builderOpen`, five sheet openers,
        `?archive=`); each is an address now, so a refresh keeps you where you were and Back closes
        the layer instead of leaving the tab. They replace the shell body rather than floating over
        it: the tabs and the map would otherwise scroll behind a full-height wizard. */}
    {mode !== "home" && state && layer?.kind === "builder" && (mode === "gm" || state.builderPolicy.playerBuilder === "open"
      ? <CharacterBuilder
          state={state}
          sessionKey={mode === "gm" ? "gm" : "player"}
          /* The builder covers the viewport, so the connection banner above is painted over. It gates
             its own last step on this instead. */
          connection={connection}
          onClose={() => navigate(mode === "gm" ? pathForGmTab("roster") : "/table")}
          onCreated={(name) => setNotice({ tone: "success", text: `${name} joined the roster — ready to claim.` })}
        />
      : <div className="anim-view builder-gate card"><h2>Your GM builds the characters at this table</h2><p>Ask them to make one for you, or claim one that&rsquo;s already on the table.</p><Button variant="secondary" onClick={() => navigate("/table")}>Back to the table</Button></div>)}
    {mode !== "home" && state && layer?.kind === "level" && <LevelFlow
      state={state}
      role={mode === "gm" ? "gm" : "player"}
      actorId={layer.actorId}
      sessionKey={mode === "gm" ? "gm-level" : "player-level"}
      connection={connection}
      onClose={() => navigate(`/characters/${layer.actorId}`)}
      onDone={() => navigate(`/characters/${layer.actorId}`)}
    />}
    {mode !== "home" && state && layer?.kind === "replay" && mapToken && <div className="anim-view replay-page">
      <ReplayViewer
        role={mode === "gm" ? "gm" : "player"}
        token={mapToken}
        archiveId={layer.archiveId}
        onBack={() => navigate("/replays")}
        onLaunched={() => navigate("/table")}
      />
    </div>}
    {mode !== "home" && state && layer?.kind === "sheet" && (() => {
      const actor = state.actors.find((entry) => entry.id === layer.actorId);
      // A player asking for someone else's sheet gets the not-found view: their projection does not
      // carry it, so "no such character" is both the true answer and the indistinguishable one.
      if (!actor) return <NotFoundView role={mode === "gm" ? "gm" : "player"} />;
      return <div className="anim-view sheet-page">
        <CharacterSheet actor={actor} role={mode === "gm" ? "gm" : "player"} state={state} standalone onClose={() => navigate(mode === "gm" ? pathForGmTab("roster") : "/table")} />
        <div className="sheet-page-actions">
          <Button variant="secondary" onClick={() => navigate(`/characters/${layer.actorId}/level`)}>Level up or down…</Button>
          {mapToken && <Button variant="secondary" onClick={() => setTokenPickerFor(layer.actorId)}>Set token image…</Button>}
        </div>
      </div>;
    })()}
    {mode !== "home" && state && !fullPageLayer && <>
      {/* **A10/D15: the shell renders no roster.** It used to render the whole one — a full-size card
          grid out of combat — above the tab bar, which put it above the map, above Scenes, above
          Homebrew, above the GM's Codex (which therefore began ~1500px down at phone width), and above
          the Roster tab, where it appeared a SECOND time under the tab's own gallery. The party belongs
          to the table, so it lives on the table: a slim strip out of combat (§B2.2), the player's
          pre-claim picker on the player's table (§B4.2), and management — create, import, approve,
          archive — on the Roster tab (§B6). Nothing above the tabs but the tabs. */}
      {mode === "gm" && <Tabs
        className="gm-tabs"
        ariaLabel="GM sections"
        tabs={GM_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
        activeId={gmTab}
        onChange={(id) => setGmTab(id as GmTab)}
      />}
      {/* D3: an address the app does not answer, and a GM-only address asked for by a player, both land
          here — indistinguishable on purpose (invariant §3.2). */}
      {mode === "gm" && gmToken && gmAddressUnknown && <NotFoundView role="gm" />}

      {/* D4 — the player Codex is a VIEW of the player app now, not a modal over the table. The two
          are a switcher, at real addresses (`/table` and `/codex/*`), so the Android back gesture walks
          between them and a player can be sent a link to a page.
          CT-3: the recap count rides INSIDE the switching affordance, so it is part of its accessible
          name ("Codex, 2 new") rather than a coloured dot a screen reader never reaches. */}
      {mode === "player" && <Tabs
        className="player-view-tabs"
        ariaLabel="Table, Codex or Settings"
        tabs={[
          { id: "table", label: "Table" },
          { id: "codex", label: <>Codex{recapBadge.unread > 0 && <> <Badge tone="info" solid>{recapBadge.unread} new</Badge></>}</> },
          /* D24: a real tab, not hidden chrome — it lights when active and it is addressed. A player
             who opens it sees the Mine group and nothing else, because nothing else is rendered. */
          { id: "settings", label: "Settings" }
        ]}
        activeId={playerView}
        /* Same rule for the player's views: the Codex reopens on the page they were reading. */
        onChange={(id) => {
          if (id === "codex") recapBadge.markSeen();
          const home = id === "codex" ? "/codex" : id === "settings" ? "/settings" : "/table";
          if (id === playerView) { navigate(home); return; }
          navigate(id === "codex" ? lastLocationForTab("player", "codex") ?? "/codex" : home);
        }}
      />}
      {mode === "player" && playerView === "codex" && mapToken && <div className="anim-view codex-anim"><PlayerCodex token={mapToken} /></div>}
      {/* D24 — one Settings surface, one component, both roles. A player is handed no GM group at
          all: `SettingsPage` renders `TableGroup`/`PlayersGroup` only for a GM token, so the GM-only
          controls are absent from the tree rather than hidden in it. */}
      {mode === "player" && playerView === "settings" && <SettingsPage role="player" state={state} />}
      {/* A player on a GM-only or unknown address: the not-found view, indistinguishable from each other
          and from a genuinely unknown address (invariant §3.2). */}
      {mode === "player" && playerView === "table" && (isGmOnlyPath(route.path) || !isKnownPath(route.path)) && <NotFoundView role="player" />}

      {((mode === "player" && playerView === "table" && !isGmOnlyPath(route.path) && isKnownPath(route.path)) || (mode === "gm" && !gmAddressUnknown && gmTab === "table" && route.segments[0] !== "codex")) && <div className={`table-layout anim-view${showDocked ? " docked" : ""}`}>
        <section className="table" ref={measureTablePanel}>
          {/* Scene IA lives where the GM plays: stage, switch, and create scenes from one strip.
              Guarded on the field, not just the mode - the first state after login can still be
              player-projected (no scenes) until the session join lands. */}
          {mode === "gm" && Array.isArray((state as GmView).combat.scenes) && <div className="scenes-open-row">
            <Button variant="secondary" className="scenes-open" aria-label={activeScene ? `Scenes — ${activeScene.name} is live` : "Scenes"} onClick={() => setScenesModalOpen(true)}><IconScene className="scenes-open-icon" />{activeSceneName}<IconChevron className="scenes-open-caret" /></Button>
          </div>}
          {/* D15/D32 — the party is part of the TABLE. A player who has claimed nobody gets the picker
              (never stranded by the roster's removal); a player who has claimed leads with their own
              character; and out of combat both roles get the slim strip, because in combat the turn
              order already carries the same people. */}
          {mode === "player" && (playerHasClaimed
            ? <YouArePlaying state={state as PlayerView} />
            : <ClaimCharacter state={state as PlayerView} />)}
          {!previewScene && !state.combat.active && (mode === "gm"
            ? <PartyStrip role="gm" state={state as GmView} onOpenRoster={() => navigate(pathForGmTab("roster"))} />
            : playerHasClaimed ? <PartyStrip role="player" state={state as PlayerView} /> : null)}
          {previewScene ? <>
            <div className="scene-preview-banner" role="status">Staging <strong>{previewScene.name}</strong> — GM only. Drag tokens from the tray to place them, then use the map buttons to go back or make it live.</div>
            <EncounterMap assetId={previewScene.mapAssetId} token={mapToken} altText={`Staging ${previewScene.name}`} role="gm" actors={state.actors} tokens={previewScene.combat.tokens} annotations={[]} revision={state.revision} activeActorId={null} fog={previewScene.combat.fog} moveSceneId={previewScene.id} onScenePrep={() => setScenePrepOpen(true)} staging={{ onBackToLive: () => setPreviewScene(null), onMakeLive: () => makeSceneLive(previewScene.id) }} healthDisplay={previewScene.combat.healthDisplay} state={state} />
          </> : <>
          {!state.combat.active && state.combat.mapAssetId && <p className="table-status">{mode === "gm" ? "Scene is live — add who's in it and start the fight from the panel below." : "Waiting for the GM to start the fight."}</p>}
          {!state.combat.active && !state.combat.mapAssetId && <p className="table-status">{mode === "gm" ? "No fight running yet. Start one from the panel below." : "No fight running yet. The GM will start one when everyone's ready."}</p>}
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
          /> : <div className="empty map-empty-hero scanlines"><div className="empty-atmos" aria-hidden="true"><span className="home-hero-bloom" /><span className="home-hero-grid grid-floor" /></div><strong>No map loaded yet</strong><span>{mode === "gm" ? "Prepare a scene from the Scenes tab - pick a map and who's in it, then go live." : "The GM will load the battle map when combat begins."}</span>{mode === "gm" && <Button variant="secondary" className="empty-scene-prep" onClick={() => setScenePrepOpen(true)}><IconScene /> Prepare a scene</Button>}</div>}
          </>}
          {mode === "gm" && gmToken && !previewScene && <Button variant="secondary" className="viewer-preview-toggle" aria-pressed={showViewerPreview} onClick={() => setShowViewerPreview((current) => !current)}>{showViewerPreview ? "Hide viewer preview" : "Preview what players see"}</Button>}
        </section>
        <div className="table-sidebar">
          {previewScene
            ? <SceneBuilder scene={previewScene} actors={(state as GmView).actors} revision={state.revision} stagingDefaults={(state as GmView).stagingDefaults} />
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
          {/* §B4.4 — the shelf: the fights the GM shared, under the player's own sheet, out of combat.
              Renders nothing when nothing has been shared, so an empty shelf is never a thing to read. */}
          {mode === "player" && !state.combat.active && mapToken && <ReplayShelf token={mapToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />}
          {mode === "player" && <section className="gm-session-controls"><Button variant="secondary" onClick={leavePlayer}>Leave table</Button></section>}
        </div>
      </div>}

      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "scenes" && Array.isArray((state as GmView).combat.scenes) && <div className="anim-view">
        {scenesView === "maps"
          ? <div className="scenes-maps-view">
              <Button variant="ghost" className="scenes-back" onClick={() => navigate(pathForGmTab("scenes"))}><IconChevronLeft /> Back to scenes</Button>
              <MapManager gmToken={gmToken} preferredMapId={(state as GmView).combat.mapAssetId} onSelectionChange={setSelectedMap} />
            </div>
          : <SceneGallery scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} liveCombatantCount={(state as GmView).combat.initiative.length} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} onNewScene={() => setScenePrepOpen(true)} onManageMaps={() => navigate("/scenes/maps")} onClose={() => navigate(pathForGmTab("table"))} onFeedback={(text) => setNotice({ tone: "error", text })} />}
      </div>}

      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "viewer" && <div className="anim-view"><ViewerControls gmToken={gmToken} {...(selectedMap ? { map: { assetId: selectedMap.id, width: selectedMap.width, height: selectedMap.height, altText: selectedMap.name, calibration: selectedMap.calibration, scale: selectedMap.scale, ...(selectedMap.previewUrl ? { previewUrl: selectedMap.previewUrl } : {}) } } : {})} /></div>}

      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "roster" && <div className="anim-view"><PartyRosterTab state={state as GmView} onCreateCharacter={() => navigate("/builder")} /></div>}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "replay" && <div className="anim-view"><ReplayList role="gm" token={gmToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} /></div>}
      {/* D27 — a player reaches the shared list at the same address, as its own page, with the Table
          tab lit and a way back to it. Unshared ids are 404 at the server, so the list is the truth. */}
      {mode === "player" && playerView === "table" && route.segments[0] === "replays" && mapToken && <div className="anim-view replay-page">
        <Button variant="ghost" onClick={() => navigate("/table")}><IconChevronLeft /> Back to the table</Button>
        <ReplayList role="player" token={mapToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />
      </div>}
      {mode === "gm" && gmToken && route.segments[0] === "codex" && <div className="anim-view codex-anim"><CodexShell gmToken={gmToken}
        scenes={(state as GmView | null)?.combat?.scenes?.map((scene) => ({ id: scene.id, name: scene.name })) ?? []}
        actors={(state as GmView | null)?.actors?.map((actor) => ({ id: actor.id, name: actor.name })) ?? []}
        activeSceneId={(state as GmView | null)?.combat?.activeSceneId ?? null}
        onActivateScene={(sceneId: string) => { makeSceneLive(sceneId); navigate(pathForGmTab("table")); }}
        onOpenReplay={(archiveId: number) => navigate(`/replays/${archiveId}`)} /></div>}

      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "homebrew" && <div className="anim-view"><HomebrewPanel gmToken={gmToken} /></div>}

      {mode === "gm" && gmToken && showViewerPreview &&<ViewerPreviewPanel gmToken={gmToken} onClose={() => setShowViewerPreview(false)} />}

      {mode === "gm" && gmToken && scenePrepOpen && state && <Modal open onClose={() => setScenePrepOpen(false)} size="lg" className="scene-prep-modal" title="New scene" ariaLabel="New scene">
        <ScenePanel actors={(state as GmView).actors} selectedMap={selectedMap} mapLibrary={mapLibrary} stagingDefaults={(state as GmView).stagingDefaults} onCreated={(sceneId) => { setScenePrepOpen(false); if (sceneId) setPendingStageSceneId(sceneId); }} />
      </Modal>}

      {mode === "gm" && gmToken && scenesModalOpen && state && Array.isArray((state as GmView).combat.scenes) && <Modal open onClose={() => setScenesModalOpen(false)} size="lg" className="scenes-modal" title="Scenes" ariaLabel="Scenes">
        <SceneGallery scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} liveCombatantCount={(state as GmView).combat.initiative.length} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} hideHeading onNewScene={() => { setScenesModalOpen(false); setScenePrepOpen(true); }} onManageMaps={() => { setScenesModalOpen(false); navigate("/scenes/maps"); }} onClose={() => setScenesModalOpen(false)} onFeedback={(text) => setNotice({ tone: "error", text })} />
      </Modal>}

      {/* A7/D24 — Settings replaces "VTT Setup", and nothing /setup held is lost: theme moved to Mine,
          credentials and session security to The table → Access & integrations (§B9.4). */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "settings" && <SettingsPage
        role="gm"
        state={state}
        gmToken={gmToken}
        busy={busy}
        onPreviewPlayers={() => { navigate(pathForGmTab("table")); setShowViewerPreview(true); }}
        onSignOut={signOutGm}
        onRevokeAll={revokeAllGmSessions}
      />}
    </>}
    {/* A11/D18 — the token picker, opened from the sheet or from Settings → Players. The server
        decides who may set which token; this is the door, not the gate. */}
    {tokenPickerFor && mapToken && state && (() => {
      const actor = state.actors.find((entry) => entry.id === tokenPickerFor);
      if (!actor) return null;
      return <TokenLibrary
        actorId={actor.id}
        actorName={actor.name}
        definitionId={actor.definitionId ?? null}
        currentAssetId={actor.tokenAssetId ?? null}
        token={mapToken}
        role={mode === "gm" ? "gm" : "player"}
        onClose={() => setTokenPickerFor(null)}
      />;
    })()}
    {dialog}
  </main>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><AppErrorBoundary><ToastProvider><App /></ToastProvider></AppErrorBoundary></StrictMode>);
