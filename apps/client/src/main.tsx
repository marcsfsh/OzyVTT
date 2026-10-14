import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import "@vtt/ui/styles.css";
import "./styles.css";
import { ClaimCharacter } from "./actors/ClaimCharacter";
import { PartyRosterTab } from "./actors/PartyRosterTab";
import { PartyStrip } from "./actors/PartyStrip";
import { MyCharacter, partyVisibilityOf } from "./actors/MyCharacter";
import { CharacterBuilder } from "./builder/CharacterBuilder";
import { LevelFlow } from "./builder/LevelFlow";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { Notice, useConfirm, type NoticeMessage } from "./components/feedback";
import { DicePanel } from "./dice/DicePanel";
import { DOCK_POSITIONS, EncounterPanel, type DockPosition } from "./encounter/EncounterPanel";
import { CombatLogDrawer } from "./encounter/CombatLog";
import { ApiReferencePage } from "./integrations/ApiReference";
import { DockAccordion } from "./encounter/DockAccordion";
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
import { currentHref, isGmOnlyPath, isKnownPath, isPlayerOnlyPath, lastLocationForTab, layerOf, litGmTab, navigate, pathForGmTab, redirectForRetiredPath, rememberLocation, resumeTarget, useRoute, type GmTab } from "./router";
import { NotFoundPage } from "./components/NotFoundView";
import { newId } from "./lib/ids";
import { ViewerControls } from "./viewer/ViewerControls";
import { ViewerPreviewPanel } from "./viewer/ViewerPreviewPanel";
import { ThemeToggle, Tabs, Wordmark, ToastProvider, useToast, IconArrow, IconScene, Modal, Badge, Button, Input } from "@vtt/ui";
import { TableEventToasts } from "./scene/toasts";

const PLAYER_TOKEN_KEY = "vtt.player-token";

/**
 * Keyboard safety under the locked shell: the body cannot scroll, so a focused text field is
 * scrolled into view within its own scrolling region (scrollIntoView stops at the first ancestor
 * that can help). Done twice: immediately, and again after the on-screen keyboard has resized the
 * viewport. The regions' scroll-padding keeps the landing spot clear of sticky chrome.
 */
const FOCUS_NUDGE_TARGETS = "input, textarea, select, [contenteditable=''], [contenteditable='true']";
function installKeyboardFocusHelper(): () => void {
  const nudge = (field: HTMLElement) => field.scrollIntoView({ block: "nearest" });
  const onFocusIn = (event: FocusEvent) => {
    const field = event.target;
    if (!(field instanceof HTMLElement) || !field.matches(FOCUS_NUDGE_TARGETS)) return;
    nudge(field);
    window.setTimeout(() => { if (document.activeElement === field) nudge(field); }, 300);
  };
  document.addEventListener("focusin", onFocusIn);
  return () => document.removeEventListener("focusin", onFocusIn);
}

/**
 * The phone table, below 980px (the stylesheet's breakpoint): the map is a fixed band and the sheet
 * takes the rest. Some arrangements cannot be expressed in CSS: which row the pre-claim picker
 * belongs to, and whether a side dock may be offered at all.
 */
const PHONE_TABLE_QUERY = "(max-width: 979px)";
function usePhoneTable(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && (window.matchMedia?.(PHONE_TABLE_QUERY).matches ?? false));
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia(PHONE_TABLE_QUERY);
    const onChange = () => setPhone(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return phone;
}

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { headers: { "content-type": "application/json", ...init?.headers }, ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Something went wrong. Please try again.");
  return body;
}

const GM_TABS: ReadonlyArray<{ id: GmTab; label: string }> = [
  // The place is the "Table" (an encounter is the fight on it); the roster is "Roster".
  { id: "table", label: "Table" },
  { id: "scenes", label: "Scenes" },
  { id: "roster", label: "Roster" },
  { id: "codex", label: "Codex" },
  // Homebrew sits right after Codex: the two GM authoring surfaces are adjacent.
  { id: "homebrew", label: "Homebrew" },
  // Controls for the shared screen.
  { id: "viewer", label: "Shared screen" },
  { id: "replay", label: "Replays" },
  { id: "settings", label: "Settings" }
];

type Connection = "online" | "reconnecting" | "offline";

function App() {
  const [mode, setMode] = useState<"home" | "player" | "gm">("home");
  /** The app's addresses: the GM tab is read from the route, and switching tabs navigates. */
  const route = useRoute();
  /**
   * Which GM tab the address names. Addresses that name none (`/`, `/table`, `/codex/pages/x`) resolve
   * to "table"; an unknown one renders the not-found view.
   */
  const gmTab: GmTab = litGmTab(route.path) ?? "table";
  /**
   * A tab returns you to where you were in it. Re-tapping the current tab goes to its front door.
   */
  const setGmTab = (next: GmTab) =>
    navigate(next === gmTab ? pathForGmTab(next) : lastLocationForTab("gm", pathForGmTab(next).slice(1)) ?? pathForGmTab(next));
  /**
   * The player's four views. Every address that is not My character, the Codex or Settings is the
   * table.
   */
  const playerView: "mine" | "table" | "codex" | "settings" =
    route.segments[0] === "me" ? "mine"
      : route.segments[0] === "codex" ? "codex"
      : route.segments[0] === "settings" ? "settings"
      : "table";
  /** The layer open on top of the tab: the sheet, the builder, a replay, a scene workspace. */
  const layer = layerOf(route.path);
  /**
   * Layers that replace the shell: a wizard, a sheet and a replay take the whole pane. The scene
   * workspaces and the maps library are the Scenes tab's own contents and keep the tab bar.
   */
  const fullPageLayer = layer !== null && layer.kind !== "maps" && layer.kind !== "scene-prep";
  /**
   * An address the app does not answer, for a signed-in GM:
   * (1) Inside the Codex, `CodexShell` owns not-found (its sidebar stays usable), so the shell stands
   *     down on any `/codex/*` address.
   * (2) Elsewhere the tab arms must stand down too: `gmTabForPath` falls back to "table", which would
   *     otherwise paint the whole table under the not-found card.
   * (3) Player-only addresses (`/me`) are unknown to the GM.
   */
  const gmAddressUnknown = (!isKnownPath(route.path) || isPlayerOnlyPath(route.path)) && route.segments[0] !== "codex";
  const [state, setState] = useState<PlayerView | GmView | null>(null);
  const [notice, setNotice] = useState<NoticeMessage>(null);
  const [password, setPassword] = useState("");
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);
  const [gmToken, setGmToken] = useState<string | null>(null);
  const [selectedMap, setSelectedMap] = useState<MapSelection | null>(null);
  const [mapLibrary, setMapLibrary] = useState<readonly MapSelection[]>([]);
  const [showViewerPreview, setShowViewerPreview] = useState(false);
  /**
   * The combat log drawer's state lives here because its door is in two places (the dock, and the
   * docked-into-the-map arm with no dock).
   */
  const [logOpen, setLogOpen] = useState(false);
  const previewSceneId = usePreviewScene();
  const [scenePrepOpen, setScenePrepOpen] = useState(false);
  /** Which character's token image is being picked: GM for anyone, a player for their own. */
  const [tokenPickerFor, setTokenPickerFor] = useState<string | null>(null);
  const autoArrange = useAutoArrange();
  // The maps library is its own address.
  const scenesView: "gallery" | "maps" = layer?.kind === "maps" ? "maps" : "gallery";
  const [scenesModalOpen, setScenesModalOpen] = useState(false);
  // A new scene auto-opens for private staging, but it can only be staged once it lands in GameState
  // (the preview guard below would drop its id), so hold the id and stage on arrival.
  const [pendingStageSceneId, setPendingStageSceneId] = useState<string | null>(null);
  const [dockPosition, setDockPosition] = useState<DockPosition>(() => {
    const stored = localStorage.getItem("vtt.dock-position");
    if (stored === "top" || stored === "bottom") return "right"; // top/bottom docking no longer exists; the nearest edge is right.
    return DOCK_POSITIONS.includes(stored as DockPosition) ? (stored as DockPosition) : "sidebar";
  });
  const [dockWidth, setDockWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem("vtt.dock-width"));
    return Number.isFinite(stored) && stored >= 240 ? stored : 352; // 22rem default
  });
  const phoneTable = usePhoneTable();
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<Connection>("online");
  /**
   * The landing→app entry animation, one-shot. The choreography is CSS (`.landing--drive` in
   * styles.css); this is only the clock. `drive` keeps the landing mounted as a fixed curtain over the
   * frame; `settle` hands over to the app's cascade (`.anim-cascade`, opacity-led so no transform traps
   * a fixed overlay). Both classes are dropped when the entry finishes, so nothing persists and tab
   * navigation never replays it. Reduced motion skips it entirely.
   */
  const [entry, setEntry] = useState<"drive" | "settle" | null>(null);
  const entryTimers = useRef<number[]>([]);
  /**
   * `commit` is the caller's auth state change, which mounts the whole app. It runs only after the
   * curtain has painted and its animations have started (two frames): committing in the same batch
   * lets the app's first render block the animation start, and the title screen stalls then jumps.
   * The animations are transform/opacity, so once on the compositor they run through the mount.
   */
  const beginEntry = (commit: () => void) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { commit(); return; }
    setEntry("drive");
    // rAF does not fire in a background tab, so a timeout races it and whichever is first commits, once.
    let committed = false;
    const once = () => { if (!committed) { committed = true; commit(); } };
    requestAnimationFrame(() => requestAnimationFrame(once));
    entryTimers.current.push(window.setTimeout(once, 120));
    // 1500ms drive + 400ms settle. Must match `--entry-drive` in styles.css, or the drive is cut short.
    entryTimers.current.push(window.setTimeout(() => setEntry("settle"), 1500));
    entryTimers.current.push(window.setTimeout(() => setEntry(null), 1900));
  };
  useEffect(() => () => { entryTimers.current.forEach(clearTimeout); }, []);
  /** Keyboard safety is shell plumbing: installed once, for every region on every surface. */
  useEffect(() => installKeyboardFocusHelper(), []);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();

  /**
   * Pre-auth feedback stays inline beside the form that caused it (the landing's Notice is the one
   * exception to toast-only feedback). Post-auth feedback uses toasts: the locked frame has no row for
   * an inline message.
   */
  const fail = (text: string) => setNotice({ tone: "error", text });
  const failToast = (text: string) => toast(text, { tone: "error" });
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
   * The app reopens where you left it: every authenticated address is remembered, and a fresh sign-in
   * without a deep link resumes there. A deep link always wins (the login screen renders at the
   * requested path). The GM token is memory-only, so a hard refresh passes through the login screen.
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
    // A player who deep-linked a GM-only address gets the not-found view, not a redirect that would
    // confirm the address means something. Only the resume default is rewritten here.
    const target = resumeTarget("player", route.path);
    if (target) { navigate(target, { replace: true }); return; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  /**
   * Old addresses redirect to their new homes (`/encounter` → `/table`, `/setup` → `/settings`,
   * `/scenes?view=maps` → `/scenes/maps`) so bookmarks land; `replace` keeps Back honest.
   */
  useEffect(() => {
    if (mode === "home") return;
    const target = redirectForRetiredPath(route.path, route.query);
    if (target) navigate(target, { replace: true });
  }, [mode, route.path, route.query]);
  useEffect(() => { localStorage.setItem("vtt.dock-position", dockPosition); }, [dockPosition]);
  useEffect(() => { localStorage.setItem("vtt.dock-width", String(dockWidth)); }, [dockWidth]);
  // The map library loads with the GM session (refreshed when returning to Table or Scenes), so
  // starting a fight never needs a visit to the maps library.
  useEffect(() => {
    if (!gmToken || (gmTab !== "table" && gmTab !== "scenes")) return;
    let cancelled = false;
    fetch("/api/v1/map-assets", { headers: { authorization: `Bearer ${gmToken}` } })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Couldn't load the map library."); return body.data.assets as ReadonlyArray<MapSelection & { kind: MapSelection["kind"] }>; })
      .then((assets) => {
        if (cancelled) return;
        const library = assets.map((asset) => ({ id: asset.id, name: asset.name, kind: asset.kind, width: asset.width, height: asset.height, calibration: asset.calibration, scale: asset.scale }));
        setMapLibrary(library);
        // Default to the newest battlemap so Start is one click away on first login.
        setSelectedMap((current) => current && library.some((map) => map.id === current.id) ? current : library.find((map) => map.kind === "battlemap") ?? null);
      })
      .catch(() => { /* the maps view surfaces library errors; setup just stays empty */ });
    return () => { cancelled = true; };
    // Re-fetch when the maps view closes, so a just-uploaded battlemap appears in the scene pickers.
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
        beginEntry(() => { setMode("player"); setConnection("online"); setNotice(null); });
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
        result.ok ? beginEntry(() => { setMode("gm"); setConnection("online"); setPassword(""); setNotice(null); }) : fail(result.message ?? "Couldn't sign in as GM.");
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
    catch (error) { setBusy(false); failToast((error as Error).message); return; }
    setBusy(false);
    leaveGmSession("Signed out.");
  };
  const revokeAllGmSessions = async () => {
    const token = gmToken; if (!token) return;
    const ok = await confirm({ title: "Revoke every GM session?", body: "This signs out every GM browser, including this one. Everyone will need to sign in again.", confirmLabel: "Revoke all", danger: true });
    if (!ok) return;
    setBusy(true);
    try { await api("/api/gm/sessions/revoke-all", { method: "POST", headers: { authorization: `Bearer ${token}` } }); }
    catch (error) { setBusy(false); failToast((error as Error).message); return; }
    setBusy(false);
    leaveGmSession("All GM sessions revoked. Sign in again to continue.");
  };

  const mapToken = mode === "gm" ? gmToken : localStorage.getItem(PLAYER_TOKEN_KEY);
  // "A recap you haven't read". Called unconditionally (hooks rules) with a null token for the GM,
  // where it does nothing.
  const recapBadge = useRecapBadge(mode === "player" ? mapToken : null);
  // Docking is available whenever a map is loaded (a live scene), not only once combat starts.
  // Players' projection nulls mapAssetId until combat, so this never affects them or the viewer.
  const combatMapActive = !!state && !!state.combat.mapAssetId;
  /**
   * Whether this player has claimed anyone, which decides between the pre-claim picker and their own
   * character. Read from the projection's `claimStatus`.
   */
  const playerHasClaimed = mode === "player" && !!state
    && (state as PlayerView).actors.some((actor) => actor.kind === "player-character" && actor.claimStatus === "mine");
  /**
   * No docking below the phone breakpoint: a side dock would take most of the map band and render an
   * unbounded panel stack. So the phone forces `sidebar` and offers no dock picker. The stored
   * preference is untouched, so a wider screen still finds the dock where the GM left it.
   */
  const showDocked = combatMapActive && !phoneTable && dockPosition !== "sidebar";
  const encounterDock = combatMapActive && !phoneTable ? { position: dockPosition, onChange: setDockPosition } : undefined;
  const encounterPanel = state
    ? (mode === "gm"
      ? <EncounterPanel role="gm" state={state as GmView} selectedMap={selectedMap} mapLibrary={mapLibrary} onSelectMap={setSelectedMap} dock={encounterDock} />
      : <EncounterPanel role="player" state={state as PlayerView} dock={encounterDock} />)
    : null;
  // The map dock exists whenever combat runs (even in sidebar mode), so its in-map control is
  // reachable from the enlarged map; `node` is the panel only when actually docked.
  const mapDock = combatMapActive && !phoneTable
    ? { position: dockPosition, onChange: setDockPosition, width: dockWidth, onWidthChange: setDockWidth, node: showDocked ? encounterPanel : null }
    : undefined;
  // GM-private scene staging: while previewing a prepared scene, the table map renders that scene for
  // arranging. Players and the shared screen are unaffected.
  const previewScene = mode === "gm" && previewSceneId ? (state as GmView | null)?.combat.scenes.find((scene) => scene.id === previewSceneId) ?? null : null;
  useEffect(() => {
    // Drop the preview if its scene was removed or went live.
    if (previewSceneId && !(mode === "gm" && (state as GmView | null)?.combat.scenes.some((scene) => scene.id === previewSceneId && scene.id !== (state as GmView).combat.activeSceneId))) setPreviewScene(null);
  }, [previewSceneId, state, mode]);
  useEffect(() => {
    // Open a just-created scene for arranging once it appears in state, unless the GM turned that off
    // (Settings → The table → New tokens).
    if (pendingStageSceneId && mode === "gm" && (state as GmView | null)?.combat.scenes.some((scene) => scene.id === pendingStageSceneId)) {
      if (autoArrange) setPreviewScene(pendingStageSceneId);
      setPendingStageSceneId(null);
    }
  }, [pendingStageSceneId, state, mode, autoArrange]);
  const activeScene = mode === "gm" && state
    ? (state as GmView).combat.scenes?.find((scene) => scene.id === (state as GmView).combat.activeSceneId) ?? null
    : null;
  useEffect(() => {
    // Staging renders on the table map, so switch to it and close the pickers.
    if (previewScene) { navigate(pathForGmTab("table")); setScenePrepOpen(false); setScenesModalOpen(false); }
  }, [previewScene]);
  const makeSceneLive = (sceneId: string) => socket.emit("scene:activate", { commandId: newId(), sceneId }, () => setPreviewScene(null));
  /**
   * The landing page: one centred column with the wordmark and the two doors. The GM password card
   * replaces the buttons in place.
   */
  const preAuth = mode === "home" || (mode === "gm" && !gmToken);
  /** The post-auth shell (rows 2-3). It mounts during the entry drive, behind the opaque curtain. */
  const shellVisible = !preAuth && state !== null;
  /**
   * The frame: <main> is a 100dvh grid with rows [connection strip][tab bar][content pane], and the
   * page never scrolls. Every in-flow child has an explicit grid row (styles.css); overlays, dialogs
   * and the texture take none.
   */
  return <main className={entry === "settle" ? "anim-cascade" : undefined}>
    <div className="app-texture" aria-hidden="true" />
    {mode !== "home" && <TableEventToasts />}
    {/* Row 1: the connection strip. A real frame row, so it never paints over a surface and nothing
        covers it, full-page layers included. */}
    {mode !== "home" && connection !== "online" && <p className="connection-banner" role="status">{connection === "reconnecting" ? "Reconnecting to the table…" : "Connection lost. Trying to reconnect…"}</p>}
    {/* Row 2: the tab bar. It stays up while a full-page layer is open. */}
    {shellVisible && mode === "gm" && <div className="frame-tabbar rim-gm"><Tabs
      className="gm-tabs"
      ariaLabel="GM sections"
      tabs={GM_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
      activeId={gmTab}
      onChange={(id) => setGmTab(id as GmTab)}
    /></div>}
    {/* The player's views are tabs at real addresses (`/table`, `/codex/*`), so Back walks between
        them and pages can be linked. The recap count is part of the tab's accessible name
        ("Codex, 2 new"), not just a coloured dot. */}
    {shellVisible && mode === "player" && <div className="frame-tabbar rim-player"><Tabs
      className="player-view-tabs"
      ariaLabel="Player sections"
      tabs={[
        /* The player's first tab: who they play, how they are doing, the sheet, the party, and the builder. */
        { id: "mine", label: "My character" },
        { id: "table", label: "Table" },
        { id: "codex", label: <>Codex{recapBadge.unread > 0 && <> <Badge tone="info" solid>{recapBadge.unread} new</Badge></>}</> },
        /* A player sees only the Mine group here. */
        { id: "settings", label: "Settings" }
      ]}
      activeId={playerView}
      /* The Codex reopens on the page they were reading. */
      onChange={(id) => {
        if (id === "codex") recapBadge.markSeen();
        const home = id === "codex" ? "/codex" : id === "settings" ? "/settings" : id === "mine" ? "/me" : "/table";
        if (id === playerView) { navigate(home); return; }
        navigate(id === "codex" ? lastLocationForTab("player", "codex") ?? "/codex" : home);
      }}
    /></div>}
    {/* Row 3: the pane. Each surface below is its one child, a `.frame-col` with chrome rows above a
        `.scroll-y` region; the pane gives out the height and the surface divides it. */}
    <div className="app-pane">
    {(preAuth || entry === "drive") && <div className={entry === "drive" ? "landing landing--drive" : "landing"}>
      {/* The title screen, layer by layer: star field, the slatted sun behind the horizon, the
          receding grid, grain, and the CRT vignette/scanlines from `.landing`'s pseudo-elements.
          Colours are --landing-* tokens, re-skinned per theme. */}
      <div className="landing-scene" aria-hidden="true">
        <span className="landing-stars-far" /><span className="landing-stars" />
        <span className="landing-skyband"><span className="landing-sun" /></span>
        <span className="landing-planet" /><span className="landing-horizon" /><span className="landing-grid" />
        <span className="landing-noise" />
      </div>
      {/* A sibling of the scene, not inside it: it must paint over the CRT dressing and the content,
          and the scene is its own stacking context. */}
      <span className="landing-flare" aria-hidden="true" />
      <header className="home-hero anim-view">
        <h1 className="home-hero-title"><Wordmark>OZYVTT</Wordmark></h1>
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
      {/* Auth errors are the one inline exception to toast-only feedback. */}
      <Notice notice={notice} />
      <div className="home-theme-switch"><ThemeToggle /></div>
    </div>}
    {/* Full-page layers, each at its own address, so a refresh keeps them and Back closes them.
        They render inside the pane (rows 1-2 stay up) and own their scrolling. */}
    {shellVisible && state && layer?.kind === "builder" && (mode === "gm" || state.builderPolicy.playerBuilder === "open"
      ? <CharacterBuilder
          state={state}
          sessionKey={mode === "gm" ? "gm" : "player"}
          /* The wizard gates its last step on this prop: a disabled Create beats a banner to notice. */
          connection={connection}
          onClose={() => navigate(mode === "gm" ? pathForGmTab("roster") : "/table")}
          onCreated={(name) => succeed(`${name} joined the roster — ready to claim.`)}
        />
      : /* The builder is closed to players at this table: one line and one door back. */
        <div className="anim-view builder-gate pane-frame pane-scene scanlines frame-col">
          <div className="pane-sky" aria-hidden="true" />
          <div className="scene-empty frame-fill">
            <p>Your GM builds the characters at this table. Ask them to make you one, or claim one that&rsquo;s already on the table.</p>
            <Button variant="primary" onClick={() => navigate("/table")}>Back to the table</Button>
          </div>
        </div>)}
    {shellVisible && state && layer?.kind === "level" && <LevelFlow
      state={state}
      role={mode === "gm" ? "gm" : "player"}
      actorId={layer.actorId}
      sessionKey={mode === "gm" ? "gm-level" : "player-level"}
      connection={connection}
      onClose={() => navigate(`/characters/${layer.actorId}`)}
      onDone={() => navigate(`/characters/${layer.actorId}`)}
    />}
    {/* The replay viewer owns its frame, so it takes the pane directly. */}
    {shellVisible && state && layer?.kind === "replay" && mapToken && <ReplayViewer
      role={mode === "gm" ? "gm" : "player"}
      token={mapToken}
      archiveId={layer.archiveId}
      onBack={() => navigate("/replays")}
      onLaunched={() => navigate("/table")}
    />}
    {shellVisible && state && layer?.kind === "sheet" && (() => {
      const actor = state.actors.find((entry) => entry.id === layer.actorId);
      // A player asking for someone else's sheet gets the not-found view: their projection does not carry
      // it, so "no such character" is both true and indistinguishable.
      if (!actor) return <NotFoundPage role={mode === "gm" ? "gm" : "player"} />;
      /* The sheet is its own frame. The two page-level doors ride inside it as the bottom row; they are
         passed only from here because they navigate to app addresses and `sheet.html` has no router. */
      return <div className="anim-view sheet-page frame-col">
        <CharacterSheet actor={actor} role={mode === "gm" ? "gm" : "player"} state={state} standalone onClose={() => navigate(mode === "gm" ? pathForGmTab("roster") : "/table")}
          standaloneActions={<>
            <Button variant="secondary" onClick={() => navigate(`/characters/${layer.actorId}/level`)}>Level up or down…</Button>
            {mapToken && <Button variant="secondary" onClick={() => setTokenPickerFor(layer.actorId)}>Set token image…</Button>}
          </>} />
      </div>;
    })()}
    {shellVisible && state && !fullPageLayer && <>
      {/* An unknown address, and a GM-only address asked for by a player, both land here,
          indistinguishably. */}
      {mode === "gm" && gmToken && gmAddressUnknown && <NotFoundPage role="gm" />}

      {/* The player Codex owns its frame: a rail beside chrome rows over one scrolling region. */}
      {mode === "player" && playerView === "codex" && mapToken && <PlayerCodex token={mapToken} />}
      {/* One Settings component for both roles. `SettingsPage` renders the GM groups only for a GM
          token, so GM-only controls are absent from a player's tree, not hidden. */}
      {mode === "player" && playerView === "settings" && !isGmOnlyPath(route.path) && isKnownPath(route.path) && <SettingsPage role="player" state={state} />}
      {/* My character, the player's first tab; it carries the release verb. */}
      {mode === "player" && playerView === "mine" && <MyCharacter
        state={state as PlayerView}
        onOpenSheet={(actorId) => navigate(`/characters/${actorId}`)}
        onCreateCharacter={() => navigate("/builder")}
        onLevel={(actorId) => navigate(`/characters/${actorId}/level`)}
        onGoToTable={() => navigate("/table")}
      />}
      {/* A player on a GM-only or unknown address gets the not-found view, indistinguishable from each
          other. Covers the settings view too, since `/settings/api` is GM-only. */}
      {mode === "player" && (playerView === "table" || playerView === "settings") && (isGmOnlyPath(route.path) || !isKnownPath(route.path)) && <NotFoundPage role="player" />}

      {/* The table owns its frame at every width: above 980px two columns share one height; below it
          the rows stack with the map as a fixed band and the sheet taking the rest.
          `.scroll-y` is the frame's escape hatch: the docked arm is a bare panel stack that cannot fit,
          and on a phone a pane shorter than the frame's floors (landscape, soft keyboard) must scroll.
          The player half excludes `/replays`, which renders the shared-replays page below. */}
      {((mode === "player" && playerView === "table" && route.segments[0] !== "replays" && !isGmOnlyPath(route.path) && isKnownPath(route.path)) || (mode === "gm" && !gmAddressUnknown && gmTab === "table" && route.segments[0] !== "codex")) && <div className={`table-layout anim-view scroll-y${showDocked ? " docked" : ""}`}>
        <section className="table">
          {/* The top line: one 44px row below 980px and `display: contents` above it. Hides itself when
              empty. */}
          <div className="table-topline">
            {/* The party strip, out of combat only (in combat the turn order shows the same people). */}
            {/* The party strip is a party surface, so the `off` tier removes it for players. Read the tier,
                not which fields arrived: every ally stays in `state.actors` at `off` because initiative and
                tokens need them. The GM's strip is not tier-gated. */}
            {!previewScene && !state.combat.active && (mode === "gm"
              ? <PartyStrip role="gm" state={state as GmView} onOpenRoster={() => navigate(pathForGmTab("roster"))} />
              : playerHasClaimed && partyVisibilityOf(state as PlayerView) !== "off" ? <PartyStrip role="player" state={state as PlayerView} /> : null)}
          </div>
          {/* A player who has claimed nobody gets the picker. On a phone it renders as the sheet's body
              (below), so the map band stays live in a running fight. */}
          {mode === "player" && !playerHasClaimed && !phoneTable && <ClaimCharacter state={state as PlayerView} />}
          {previewScene ? <>
            <div className="scene-preview-banner" role="status">Staging <strong>{previewScene.name}</strong> — GM only. Drag tokens from the tray to place them, then use the map buttons to go back or make it live.</div>
            <EncounterMap assetId={previewScene.mapAssetId} token={mapToken} altText={`Staging ${previewScene.name}`} role="gm" actors={state.actors} tokens={previewScene.combat.tokens} annotations={[]} revision={state.revision} activeActorId={null} fog={previewScene.combat.fog} moveSceneId={previewScene.id} onScenePrep={() => setScenePrepOpen(true)} staging={{ onBackToLive: () => setPreviewScene(null), onMakeLive: () => makeSceneLive(previewScene.id) }} healthDisplay={previewScene.combat.healthDisplay} state={state} />
          </> : <>
          {!state.combat.active && state.combat.mapAssetId && <p className="table-status">{mode === "gm" ? "Scene is live — add who's in it and start the fight from the panel below." : "Waiting for the GM to start the fight."}</p>}
          {!state.combat.active && !state.combat.mapAssetId && <p className="table-status">{mode === "gm" ? "No fight running yet. Start one from the panel below." : "No fight running yet. The GM will start one when everyone's ready."}</p>}
          {/* Render the map once a scene is live, even before combat. Players still only get it once
              combat is active (their projection nulls mapAssetId until then). */}
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
            {...(mode === "gm" && Array.isArray((state as GmView).combat.scenes) ? { onViewAllScenes: () => setScenesModalOpen(true), ...(activeScene ? { activeSceneName: activeScene.name } : {}) } : {})}
            {...(mode === "gm" && gmToken ? { viewerPreview: { on: showViewerPreview, onToggle: () => setShowViewerPreview((current) => !current) } } : {})}
            healthDisplay={mode === "gm" ? (state as GmView).combat.healthDisplay : undefined}
            state={state}
          /> : <div className="empty map-empty-hero scanlines"><div className="empty-atmos" aria-hidden="true"><span className="home-hero-bloom" /><span className="home-hero-grid grid-floor" /></div><strong>No map loaded yet</strong><span>{mode === "gm" ? "Prepare a scene from the Scenes tab - pick a map and who's in it, then go live." : "The GM will load the battle map when combat begins."}</span>{mode === "gm" && <Button variant="secondary" className="empty-scene-prep" onClick={() => setScenePrepOpen(true)}><IconScene /> Prepare a scene</Button>}</div>}
          </>}
        </section>
        {/* The sheet row: the sidebar column above 980px; below it, the row that takes the leftover
            height (`.table-sheet`, where the tabbed sheet lives). Each arm is a frame column, so the row
            never scrolls, except the docked arm: with the tracker docked into the map, the dice panel
            renders bare and cannot fit, so the column declares a scroll. */}
        <div className={`table-sidebar table-sheet${showDocked ? " scroll-y" : ""}`}>
          {previewScene
            ? <SceneBuilder scene={previewScene} actors={(state as GmView).actors} revision={state.revision} stagingDefaults={(state as GmView).stagingDefaults} />
            /* On a phone an unclaimed player's sheet is the claim picker. */
            : mode === "player" && !playerHasClaimed && phoneTable
              ? <ClaimCharacter state={state as PlayerView} />
            /* The dock accordion, in and out of combat. When the tracker is docked into the map, the map
               owns the arrangement instead. */
            : showDocked
              /* With the tracker docked into the map only the dice remain here; the log drawer is a tap away. */
              ? <><DicePanel role={mode} state={state} /><Button variant="secondary" className="dock-log-door-standalone" onClick={() => setLogOpen(true)}>Combat log</Button></>
              : <DockAccordion role={mode === "gm" ? "gm" : "player"} inCombat={state.combat.active}
                  turnLabel={state.combat.active ? "Turn order" : "The fight"}
                  turn={encounterPanel}
                  dice={<DicePanel role={mode} state={state} />}
                  onOpenLog={() => setLogOpen(true)} />}
          {/* The fights the GM shared, under the player's sheet, out of combat. Renders nothing when
              nothing is shared. */}
          {mode === "player" && !state.combat.active && mapToken && <ReplayShelf token={mapToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />}
          {mode === "player" && <section className="gm-session-controls"><Button variant="secondary" onClick={leavePlayer}>Leave table</Button></section>}
        </div>
      </div>}

      {/* The Scenes tab is two addresses: the gallery and the map library, each owning its frame. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "scenes" && Array.isArray((state as GmView).combat.scenes) && (scenesView === "maps"
        ? <MapManager gmToken={gmToken} preferredMapId={(state as GmView).combat.mapAssetId} onSelectionChange={setSelectedMap} onBack={() => navigate(pathForGmTab("scenes"))} />
        : <SceneGallery surface scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} liveCombatantCount={(state as GmView).combat.initiative.length} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} onNewScene={() => setScenePrepOpen(true)} onManageMaps={() => navigate("/scenes/maps")} onClose={() => navigate(pathForGmTab("table"))} onFeedback={failToast} />)}

      {/* The shared-screen controls own their frame. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "viewer" && <ViewerControls gmToken={gmToken} {...(selectedMap ? { map: { assetId: selectedMap.id, width: selectedMap.width, height: selectedMap.height, altText: selectedMap.name, calibration: selectedMap.calibration, scale: selectedMap.scale, ...(selectedMap.previewUrl ? { previewUrl: selectedMap.previewUrl } : {}) } } : {})} />}

      {/* The roster owns its frame. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "roster" && <PartyRosterTab state={state as GmView} onCreateCharacter={() => navigate("/builder")} />}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "replay" && <ReplayList role="gm" token={gmToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />}
      {/* A player reaches the shared replay list at the same address as its own page, with the Table
          tab lit. Unshared ids are 404 at the server, so the list is the truth. */}
      {mode === "player" && playerView === "table" && route.segments[0] === "replays" && mapToken &&
        <ReplayList role="player" token={mapToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} onBack={() => navigate("/table")} />}
      {/* The GM Codex. `actors` carries `archived` and `kind` too: the Codex's character pickers
          order archived characters last, and "archived" is a table flag with no Codex equivalent
          (see `codex/characters.ts`). */}
      {mode === "gm" && gmToken && route.segments[0] === "codex" && <CodexShell gmToken={gmToken}
        scenes={(state as GmView | null)?.combat?.scenes?.map((scene) => ({ id: scene.id, name: scene.name })) ?? []}
        actors={(state as GmView | null)?.actors?.map((actor) => ({ id: actor.id, name: actor.name, archived: actor.archived, kind: actor.kind })) ?? []}
        activeSceneId={(state as GmView | null)?.combat?.activeSceneId ?? null}
        onActivateScene={(sceneId: string) => { makeSceneLive(sceneId); navigate(pathForGmTab("table")); }}
        onOpenReplay={(archiveId: number) => navigate(`/replays/${archiveId}`)} />}

      {/* Homebrew owns its frame: a modebar row over a master-detail workspace. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "homebrew" && <HomebrewPanel gmToken={gmToken} />}

      {mode === "gm" && gmToken && showViewerPreview &&<ViewerPreviewPanel gmToken={gmToken} onClose={() => setShowViewerPreview(false)} />}

      {mode === "gm" && gmToken && scenePrepOpen && state && <Modal open onClose={() => setScenePrepOpen(false)} size="lg" className="scene-prep-modal" title="New scene" ariaLabel="New scene">
        <ScenePanel actors={(state as GmView).actors} selectedMap={selectedMap} mapLibrary={mapLibrary} stagingDefaults={(state as GmView).stagingDefaults} onCreated={(sceneId) => { setScenePrepOpen(false); if (sceneId) setPendingStageSceneId(sceneId); }} />
      </Modal>}

      {mode === "gm" && gmToken && scenesModalOpen && state && Array.isArray((state as GmView).combat.scenes) && <Modal open onClose={() => setScenesModalOpen(false)} size="lg" className="scenes-modal" title="Scenes" ariaLabel="Scenes">
        <SceneGallery scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} liveCombatantCount={(state as GmView).combat.initiative.length} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} hideHeading onNewScene={() => { setScenesModalOpen(false); setScenePrepOpen(true); }} onManageMaps={() => { setScenesModalOpen(false); navigate("/scenes/maps"); }} onClose={() => setScenesModalOpen(false)} onFeedback={failToast} />
      </Modal>}

      {/* The GM Settings page (two columns at 1280px+, settings.css). */}
      {/* `/settings/api`: the API reference at full pane width. Opening it in a new tab asks for the
          GM password once, since the GM token is memory-only. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "settings" && route.path === "/settings/api" &&
        <ApiReferencePage gmToken={gmToken} onBack={() => navigate(pathForGmTab("settings"))} />}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "settings" && route.path !== "/settings/api" && <SettingsPage
        role="gm"
        state={state}
        gmToken={gmToken}
        busy={busy}
        onPreviewPlayers={() => { navigate(pathForGmTab("table")); setShowViewerPreview(true); }}
        onSignOut={signOutGm}
        onRevokeAll={revokeAllGmSessions}
      />}
    </>}
    </div>
    {/* The combat log drawer lives outside the pane because it is `position: fixed` and the pane is
        where transforms happen. Non-modal, so the table stays live behind it. */}
    {shellVisible && <CombatLogDrawer open={logOpen} onClose={() => setLogOpen(false)} />}
    {/* The token picker, opened from the sheet or Settings → Players. The server decides who may set
        which token. Dialogs live outside the pane: they take no frame row. */}
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
