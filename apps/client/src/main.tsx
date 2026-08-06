import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { GmView, PlayerView, SessionJoinResult } from "@vtt/domain";
import "@vtt/ui/styles.css";
import "./styles.css";
import { ClaimCharacter } from "./actors/ClaimCharacter";
import { PartyRosterTab } from "./actors/PartyRosterTab";
import { PartyStrip } from "./actors/PartyStrip";
import { MyCharacter } from "./actors/MyCharacter";
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
 * Keyboard safety under the locked shell (§7.5). The page cannot scroll a focused field
 * into view any more — the body is locked — so the REGION must: this nudges the focused
 * text field within its own scrolling ancestor (scrollIntoView walks every scrollable
 * ancestor and stops at the first that can help, so it finds the region, never the dead
 * page). Twice: immediately, for fields parked under a region's edge; and again after the
 * on-screen keyboard has had time to land, because the keyboard resizes the viewport AFTER
 * focus. `block: "nearest"` keeps the correction minimal, and the regions' own
 * scroll-padding (`.pane-frame > .scroll-y` in styles.css, each converted surface's own
 * region, the wizard layer) keeps the landing spot clear of sticky chrome and the home bar.
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
 * THE PHONE TABLE (C1), as a fact the components can read. Below the 980 rung the table is a frame
 * whose map is a fixed band and whose sheet takes the rest, and three of its arrangements are
 * genuinely not expressible in CSS: which ROW the pre-claim picker belongs to, and whether a
 * side-dock — 242px of a 330px band at 390px — may be offered or chosen at all. Same rung as the
 * stylesheet's, and it is the ladder's (design-language §breakpoints), not a fourth number.
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
  /**
   * D4/D24/D9: the player's FOUR views. Every address that is not My character, the Codex or Settings
   * is the table. `/me` is the player's own tab (D9) and leads the bar — the character bar that used
   * to ride over the map is gone, and this is where its three facts live now.
   */
  const playerView: "mine" | "table" | "codex" | "settings" =
    route.segments[0] === "me" ? "mine"
      : route.segments[0] === "codex" ? "codex"
      : route.segments[0] === "settings" ? "settings"
      : "table";
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
   * (3) **A PLAYER-ONLY address is unknown to the GM.** `/me` (D9) is about the character you
   *     claimed, and the GM claims nobody. It is a known address, so rule (2) would have painted the
   *     table under it; it gets the same not-found card `/nonsense` does.
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
   * RULING 6 — the combat log is a drawer from the right. The state lives here rather than in the
   * dock, because the door is in two places (the dock's own row, and the docked-into-the-map arm
   * where there is no dock) and one drawer must answer both.
   */
  const [logOpen, setLogOpen] = useState(false);
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
  const phoneTable = usePhoneTable();
  const [busy, setBusy] = useState(false);
  const [connection, setConnection] = useState<Connection>("online");
  /**
   * The landing→app ENTRY DRIVE (§7.7, one-shot). The door answers, and the title screen drives:
   * the doors travel past the camera down the grid road, the sun rises out from behind the horizon
   * and its flare clears the frame — and the app is already there behind it (client brief,
   * 2026-08-04). The scene's own choreography is CSS (the .landing--drive block in styles.css);
   * this is only the clock.
   *
   * Two phases, because they own different elements: `drive` keeps the landing mounted as a fixed
   * curtain over the frame for its 900ms beat, then `settle` hands the beat to the app, which
   * cascades up (main wears .anim-cascade; the pane's leg is opacity-led — the pane-in rule).
   * The 900 matches the CSS beat exactly: shorter and the curtain would drop mid-drive, longer and
   * the settled app would sit behind a transparent curtain doing nothing.
   *
   * Both classes are STATE and both are dropped when the entry lands, so nothing is retained to
   * trap a fixed overlay afterwards (refresh risk #2) and later tab navigation never replays it.
   * Reduced motion declines the state machine outright — the swap is instant, which is what the
   * global animation kill would collapse the drive to anyway, and an instant swap is honest where
   * a frozen mid-drive frame would just look broken.
   */
  const [entry, setEntry] = useState<"drive" | "settle" | null>(null);
  const entryTimers = useRef<number[]>([]);
  /**
   * `commit` is the caller's auth state change — the one that mounts the whole app. It is handed in
   * rather than run alongside, because ORDER is the whole difference between a drive and a stall.
   *
   * Committing in the same React batch as the drive class costs the first ~450ms of the beat, and
   * that is measured, not guessed: the curtain's keyframes cannot start until style and layout are
   * computed, and the app's first render/layout/paint sits in front of them on the main thread. The
   * probe showed the road at 0px until t≈500ms and only 143px of its 560px travelled by the time the
   * curtain dropped — the title screen simply sat there and then jumped.
   *
   * So: paint the curtain, let its animations actually begin, and only then mount the app behind it.
   * Two frames rather than one because the first only guarantees the style is computed; by the second
   * the compositor owns the animations, and since every one of them is transform/opacity it keeps
   * running through the mount jank instead of waiting for it.
   */
  const beginEntry = (commit: () => void) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { commit(); return; }
    setEntry("drive");
    // rAF does not fire in a background tab, and a half-entered app is a far worse failure than a
    // skipped animation — so a timeout races it and whichever arrives first commits, once.
    let committed = false;
    const once = () => { if (!committed) { committed = true; commit(); } };
    requestAnimationFrame(() => requestAnimationFrame(once));
    entryTimers.current.push(window.setTimeout(once, 120));
    entryTimers.current.push(window.setTimeout(() => setEntry("settle"), 900));
    entryTimers.current.push(window.setTimeout(() => setEntry(null), 1400));
  };
  useEffect(() => () => { entryTimers.current.forEach(clearTimeout); }, []);
  /** Keyboard safety is shell plumbing: installed once, for every region on every surface. */
  useEffect(() => installKeyboardFocusHelper(), []);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  /* (The `--setup-h` plumbing lived here: a ResizeObserver on the map panel publishing its height so
     the setup panel beside it could match. It measured one column to size another because neither
     column had a height of its own. The table is a frame now — both columns are given the same height
     by the grid — so the observer, its ref, the custom property and the setup panel's `max-height`
     that read it are all gone. Nothing in this app should be measuring a sibling to guess a height.) */

  /**
   * PRE-auth feedback stays inline beside the form that caused it — the landing's Notice is
   * the sanctioned exception to toast-only feedback (§D6). POST-auth feedback rides the one
   * toast channel (convention (e)): the locked frame has no notice slot — an in-flow message
   * between the frame's rows would be a phantom row the grid never planned for.
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
  /**
   * BELOW THE RUNG THERE IS NOWHERE TO DOCK (C1). A side dock takes `min(22rem, 62vw)` — 242px of a
   * 330px map band at 390px — and `showDocked` renders the panels as a bare unbounded stack with no
   * accordion at all, so a saved `left`/`right` from a laptop session arrived on the phone as a map
   * you cannot read beside a column that cannot scroll. So the phone forces `sidebar` and offers no
   * picker: neither the panel's three 28x28 dock buttons nor the map toolbar's View-group field
   * render, because there is no choice to make there.
   *
   * The STORED preference is untouched — `dockPosition` is what the localStorage effect writes, and
   * this only overrides what the table DOES with it — so rotating a tablet back over the rung, or
   * opening the same table on the laptop, still finds the dock where the GM left it.
   */
  const showDocked = combatMapActive && !phoneTable && dockPosition !== "sidebar";
  const encounterDock = combatMapActive && !phoneTable ? { position: dockPosition, onChange: setDockPosition } : undefined;
  const encounterPanel = state
    ? (mode === "gm"
      ? <EncounterPanel role="gm" state={state as GmView} selectedMap={selectedMap} mapLibrary={mapLibrary} onSelectMap={setSelectedMap} dock={encounterDock} />
      : <EncounterPanel role="player" state={state as PlayerView} dock={encounterDock} />)
    : null;
  // The map dock is present whenever combat is running (even in sidebar mode) so its in-map dock
  // control is reachable from inside the enlarged map; `node` is only the panel when actually docked.
  const mapDock = combatMapActive && !phoneTable
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
  /** The post-auth shell — rows 2-3's content. It is deliberately NOT suppressed during the entry
      drive any more: the drive is a fixed, opaque curtain over the whole viewport, so the frame can
      mount and settle behind it and be finished by the time the flare clears. That is the point of
      a curtain — the old dip had to hide the shell because it did not cover it. */
  const shellVisible = !preAuth && state !== null;
  /**
   * THE FRAME (§7 — the screen is the page): <main> is a 100dvh grid, rows
   * [connection strip][tab bar][content pane], and the page never scrolls. Every in-flow
   * child carries an explicit grid row (styles.css); overlays, dialogs and the texture take
   * no row. During the one-shot entry transition the frame wears .anim-cascade — its pane
   * leg is opacity-led so no transform ever traps a fixed overlay (refresh risk #2).
   */
  return <main className={entry === "settle" ? "anim-cascade" : undefined}>
    <div className="app-texture" aria-hidden="true" />
    {mode !== "home" && <TableEventToasts />}
    {/* Row 1 — connection. A real frame row: it height-animates in and the frame steps down
        to make room, so it can never paint over a surface and no surface can cover it — the
        fixed-strip life, its z-index and the :has() padding dance all retired with the lock.
        It stays visible over full-page layers too (the wizard used to paint over it). */}
    {mode !== "home" && connection !== "online" && <p className="connection-banner" role="status">{connection === "reconnecting" ? "Reconnecting to the table…" : "Connection lost. Trying to reconnect…"}</p>}
    {/* Row 2 — the tab bar. **A10/D15: the shell renders no roster** — the party lives on
        the table (slim strip out of combat, the pre-claim picker, management on the Roster
        tab); nothing above the tabs but the tabs. The bar stays up while a full-page layer
        is open now that layers render inside the pane, so the frame never blinks. */}
    {shellVisible && mode === "gm" && <div className="frame-tabbar rim-gm"><Tabs
      className="gm-tabs"
      ariaLabel="GM sections"
      tabs={GM_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
      activeId={gmTab}
      onChange={(id) => setGmTab(id as GmTab)}
    /></div>}
    {/* D4 — the player Codex is a VIEW of the player app, not a modal over the table. The
        views are a switcher, at real addresses (`/table` and `/codex/*`), so the Android
        back gesture walks between them and a player can be sent a link to a page.
        CT-3: the recap count rides INSIDE the switching affordance, so it is part of its
        accessible name ("Codex, 2 new") rather than a coloured dot a screen reader never
        reaches. */}
    {shellVisible && mode === "player" && <div className="frame-tabbar rim-player"><Tabs
      className="player-view-tabs"
      ariaLabel="Player sections"
      tabs={[
        /* D9/ruling 20 — the player's FIRST tab. It replaces the character bar that used to ride
           over the map: who you are playing, how they are doing, the door to the sheet, the party,
           and the builder doors (ruling 18). The map got its 69px back. */
        { id: "mine", label: "My character" },
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
        const home = id === "codex" ? "/codex" : id === "settings" ? "/settings" : id === "mine" ? "/me" : "/table";
        if (id === playerView) { navigate(home); return; }
        navigate(id === "codex" ? lastLocationForTab("player", "codex") ?? "/codex" : home);
      }}
    /></div>}
    {/* Row 3 — the pane: one always-rendered element owning the canvas for whatever the
        address says. Every surface below owns its frame now (§7): it is the pane's one child,
        a `.frame-col` whose chrome rows sit above one `.scroll-y` region, so the pane hands
        out its height and the surface divides it. Nothing here wraps a surface in a staged
        scroller any more — the temporary staging rule the refresh shipped with is drained. */}
    <div className="app-pane">
    {(preAuth || entry === "drive") && <div className={entry === "drive" ? "landing landing--drive" : "landing"}>
      {/* D30's full statement — the 80s retro-cyber title screen, layer by layer: star field, the
          slatted sun rising behind the horizon line, the grid rolling toward the viewer, analog
          grain, and the CRT vignette + scanlines the `.landing` pseudo-elements paint over it all.
          Every colour is a --landing-* token, re-skinned by the theme toggle: night, the sunset
          hour, daybreak — same composition, three skies (client call, 2026-08-04). */}
      <div className="landing-scene" aria-hidden="true">
        <span className="landing-stars-far" /><span className="landing-stars" />
        <span className="landing-skyband"><span className="landing-sun" /></span>
        <span className="landing-planet" /><span className="landing-horizon" /><span className="landing-grid" />
        <span className="landing-noise" />
      </div>
      {/* Dormant at rest; the entry drive blooms it to clear the frame. A sibling of the scene rather
          than a layer inside it, because it has to paint over the CRT dressing and the content both,
          and the scene layer is its own stacking context. */}
      <span className="landing-flare" aria-hidden="true" />
      <header className="home-hero anim-view">
        {/* The one bold thing on the view: no eyebrow, no subtext, nothing beside it (D30). */}
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
      {/* Auth errors are the sanctioned inline exception to toast-only feedback (§D6). */}
      <Notice notice={notice} />
      <div className="home-theme-switch"><ThemeToggle /></div>
    </div>}
    {/* D29 — the FULL-PAGE layers. Each was component state (`builderOpen`, five sheet openers,
        `?archive=`); each is an address now, so a refresh keeps you where you were and Back closes
        the layer instead of leaving the tab. Under the locked frame they render INSIDE the pane —
        rows 1-2 stay up — and each owns (or stages) its internal scroll; post-auth feedback that
        used to render as an inline Notice here rides the toast channel instead (convention (e)). */}
    {shellVisible && state && layer?.kind === "builder" && (mode === "gm" || state.builderPolicy.playerBuilder === "open"
      ? <CharacterBuilder
          state={state}
          sessionKey={mode === "gm" ? "gm" : "player"}
          /* The connection strip is frame row 1 and visible above the wizard now, but the wizard
             still gates its own final step on this prop — a disabled Create button beats a banner
             the player has to notice. */
          connection={connection}
          onClose={() => navigate(mode === "gm" ? pathForGmTab("roster") : "/table")}
          onCreated={(name) => succeed(`${name} joined the roster — ready to claim.`)}
        />
      : /* The builder is closed to players at this table, so the address answers with a scene
           moment (§9) rather than a card in a scrolling stage: one line and one door back. */
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
    {/* The replay viewer owns its frame (§7, B3): header + transport + step label above one
        region row, so it takes the pane directly — the staging wrapper drained with it. */}
    {shellVisible && state && layer?.kind === "replay" && mapToken && <ReplayViewer
      role={mode === "gm" ? "gm" : "player"}
      token={mapToken}
      archiveId={layer.archiveId}
      onBack={() => navigate("/replays")}
      onLaunched={() => navigate("/table")}
    />}
    {shellVisible && state && layer?.kind === "sheet" && (() => {
      const actor = state.actors.find((entry) => entry.id === layer.actorId);
      // A player asking for someone else's sheet gets the not-found view: their projection does not
      // carry it, so "no such character" is both the true answer and the indistinguishable one.
      if (!actor) return <NotFoundPage role={mode === "gm" ? "gm" : "player"} />;
      /* The sheet is its own frame (§7): the workspace fills the pane and its pane scrolls. The two
         page-level doors used to hang BELOW that 100dvh box — the whole of this route's overflow —
         and now ride inside it as the frame's bottom row. They are passed only from here: they
         navigate to app addresses, and `sheet.html` has no router to honour them. */
      return <div className="anim-view sheet-page frame-col">
        <CharacterSheet actor={actor} role={mode === "gm" ? "gm" : "player"} state={state} standalone onClose={() => navigate(mode === "gm" ? pathForGmTab("roster") : "/table")}
          standaloneActions={<>
            <Button variant="secondary" onClick={() => navigate(`/characters/${layer.actorId}/level`)}>Level up or down…</Button>
            {mapToken && <Button variant="secondary" onClick={() => setTokenPickerFor(layer.actorId)}>Set token image…</Button>}
          </>} />
      </div>;
    })()}
    {shellVisible && state && !fullPageLayer && <>
      {/* D3: an address the app does not answer, and a GM-only address asked for by a player, both land
          here — indistinguishable on purpose (invariant §3.2). */}
      {mode === "gm" && gmToken && gmAddressUnknown && <NotFoundPage role="gm" />}

      {/* THE CODEX OWNS ITS FRAME (B2), player half. No staging wrapper: the shell is a rail beside a
          column of chrome rows over one scrolling region, and it stands on its own sky. */}
      {mode === "player" && playerView === "codex" && mapToken && <PlayerCodex token={mapToken} />}
      {/* D24 — one Settings surface, one component, both roles. A player is handed no GM group at
          all: `SettingsPage` renders `TableGroup`/`PlayersGroup` only for a GM token, so the GM-only
          controls are absent from the tree rather than hidden in it.
          Settings owns its frame now (heading row + one scrolling region + its own sky), so it
          takes the pane directly — no staging wrapper. */}
      {mode === "player" && playerView === "settings" && !isGmOnlyPath(route.path) && isKnownPath(route.path) && <SettingsPage role="player" state={state} />}
      {/* D9 — MY CHARACTER, the player's first tab. It replaces the character bar over the map
          (ruling 20) and carries the release verb the bar used to own. */}
      {mode === "player" && playerView === "mine" && <MyCharacter
        state={state as PlayerView}
        onOpenSheet={(actorId) => navigate(`/characters/${actorId}`)}
        onCreateCharacter={() => navigate("/builder")}
        onLevel={(actorId) => navigate(`/characters/${actorId}/level`)}
        onGoToTable={() => navigate("/table")}
      />}
      {/* A player on a GM-only or unknown address: the not-found view, indistinguishable from each other
          and from a genuinely unknown address (invariant §3.2). It covers the SETTINGS view too since
          ruling 61 put a GM-only address under `/settings` — without that, `/settings/api` painted the
          player's own settings page, which volunteers that the address means something. */}
      {mode === "player" && (playerView === "table" || playerView === "settings") && (isGmOnlyPath(route.path) || !isKnownPath(route.path)) && <NotFoundPage role="player" />}

      {/* THE TABLE OWNS ITS FRAME (B1), at every width since C1: above the rung two columns share one
          height and the map takes what the rows above it leave; below it the same rows stack into a
          frame whose map is a fixed band and whose sheet takes the rest.
          `.scroll-y` IS THE FRAME'S ESCAPE HATCH, and on most cells it declares a scroll nothing
          uses. C1 dropped it on the reasoning that a frame does not scroll, and two arrangements
          disproved that: the docked arm below is a bare panel stack no flex arrangement fits (294px
          of PAGE scroll at 1280x900, 429 for a player, until it came back), and below the rung a
          pane shorter than the frame's floors — landscape, or a soft keyboard — cannot hold the
          rows at all, where a scroll is the difference between content one flick away and content
          that does not exist. See styles.css's phone block for the order of yielding.
          The player half excludes `/replays`: that address renders the shared-replays page (below),
          and without the exclusion the live table stacked on top of it — the census's one
          stacking anomaly, which the lock forces fixed (the audit's player `/replays` row is its
          regression check). */}
      {((mode === "player" && playerView === "table" && route.segments[0] !== "replays" && !isGmOnlyPath(route.path) && isKnownPath(route.path)) || (mode === "gm" && !gmAddressUnknown && gmTab === "table" && route.segments[0] !== "codex")) && <div className={`table-layout anim-view scroll-y${showDocked ? " docked" : ""}`}>
        <section className="table">
          {/* THE TOP LINE. One 44px row below the rung — the scene door or your own character, and the
              party beside it — and `display: contents` above it, so the laptop keeps the separate rows
              it already had. The wrapper exists for that one job, and hides itself when it is empty
              (an unclaimed player in combat has nothing to put in it). */}
          {/* RULING 12 — ONE DOOR TO THE SCENES, not two. The top-left scenes row is gone (56px back
              to the map); its function is a "View all scenes" entry in the map's own Scenes menu,
              bottom-right, where the GM's hand already is. RULING 20 took the character bar with it
              (69px) — the My character tab holds its three facts now. What is left in this wrapper is
              the party strip, which is why it still exists and why it still hides when empty. */}
          <div className="table-topline">
            {/* D15/D32 — the party is part of the TABLE, out of combat only: in combat the turn order
                already carries the same people. */}
            {!previewScene && !state.combat.active && (mode === "gm"
              ? <PartyStrip role="gm" state={state as GmView} onOpenRoster={() => navigate(pathForGmTab("roster"))} />
              : playerHasClaimed ? <PartyStrip role="player" state={state as PlayerView} /> : null)}
          </div>
          {/* A player who has claimed nobody gets the picker, never stranded by the roster's removal.
              WHERE it goes is the one thing about it that changed (decision Q3): 539px of cards is more
              than a phone's whole map band, so below the rung it is the SHEET's body (rendered in the
              sheet row below) and the band stays live above it — an unclaimed player in a running fight
              still gets a map, and hiding a fight to show a picker is the worse trade. */}
          {mode === "player" && !playerHasClaimed && !phoneTable && <ClaimCharacter state={state as PlayerView} />}
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
            {...(mode === "gm" && Array.isArray((state as GmView).combat.scenes) ? { onViewAllScenes: () => setScenesModalOpen(true), ...(activeScene ? { activeSceneName: activeScene.name } : {}) } : {})}
            {...(mode === "gm" && gmToken ? { viewerPreview: { on: showViewerPreview, onToggle: () => setShowViewerPreview((current) => !current) } } : {})}
            healthDisplay={mode === "gm" ? (state as GmView).combat.healthDisplay : undefined}
            state={state}
          /> : <div className="empty map-empty-hero scanlines"><div className="empty-atmos" aria-hidden="true"><span className="home-hero-bloom" /><span className="home-hero-grid grid-floor" /></div><strong>No map loaded yet</strong><span>{mode === "gm" ? "Prepare a scene from the Scenes tab - pick a map and who's in it, then go live." : "The GM will load the battle map when combat begins."}</span>{mode === "gm" && <Button variant="secondary" className="empty-scene-prep" onClick={() => setScenePrepOpen(true)}><IconScene /> Prepare a scene</Button>}</div>}
          </>}
          {/* RULING 13 — the "Preview what players see" anchor row is gone (53.6px back to the map).
              Its trigger joined Draw / Fog / View in the map toolbar; nothing else had to change,
              because the payload was already a `position: fixed` draggable panel that never depended
              on the row that launched it. */}
        </section>
        {/* THE SHEET ROW (C1). Above the rung this is the sidebar column it has always been; below it,
            it is the one row that takes the leftover height and holds everything the band does not —
            `.table-sheet` is the frame class B1 owns and B2's tabbed sheet builds inside.
            The row is UNIFORM: every arm of it is a frame column that takes the row's height and
            divides it into its own regions, so the row itself never declares a scroll and no arm is
            special-cased. The staging arm was the last exception — `SceneBuilder` rendered its head,
            the prep panel and the tray at natural height (681px inside a 413px row at 390x844) and the
            ROW carried a conditional `.scroll-y` so the overflow stayed reachable. The panel is a
            frame now (`SceneBuilder.tsx`) and that bridge is gone.
            ONE ARM IS STILL NOT A FRAME, and it is the docked one: when the tracker is docked into
            the map this column renders `<DicePanel/><CombatLogPanel/>` bare, and `DicePanel` alone
            measures 787px (GM) / 850px (player) inside an ~856px column — no arrangement of flex
            fits that, so the column declares a scroll instead of pretending to. It is the arm that
            overflows, so it is the arm that scrolls: the map stays put and the dice+log column
            moves, which is the arrangement the GM asked for by docking. */}
        <div className={`table-sidebar table-sheet${showDocked ? " scroll-y" : ""}`}>
          {previewScene
            ? <SceneBuilder scene={previewScene} actors={(state as GmView).actors} revision={state.revision} stagingDefaults={(state as GmView).stagingDefaults} />
            /* Q3 again: on a phone an unclaimed player's sheet IS the picker. There is nothing else it
               could usefully be — you cannot take a turn, and the dice belong to a character. */
            : mode === "player" && !playerHasClaimed && phoneTable
              ? <ClaimCharacter state={state as PlayerView} />
            /* THE DOCK IS ONE ACCORDION (B1), in combat and out of it alike. Three headers always
               visible, one section holding the column's height. It replaces two different idioms that
               used to fight for the same space: a tracker that took what it wanted with dice and log
               hidden behind `<details>` mid-fight, and three panels stacked end to end out of combat.
               When the tracker is docked INTO the map the dock is not this column at all, so the
               accordion stands down and the map owns the arrangement. */
            : showDocked
              /* RULING 6 again: the log left this column too. What is left when the tracker is docked
                 into the map is the dice, and the drawer is one tap away from the map's own chrome. */
              ? <><DicePanel role={mode} state={state} /><Button variant="secondary" className="dock-log-door-standalone" onClick={() => setLogOpen(true)}>Combat log</Button></>
              : <DockAccordion role={mode === "gm" ? "gm" : "player"} inCombat={state.combat.active}
                  turnLabel={state.combat.active ? "Turn order" : "The fight"}
                  turn={encounterPanel}
                  dice={<DicePanel role={mode} state={state} />}
                  onOpenLog={() => setLogOpen(true)} />}
          {/* §B4.4 — the shelf: the fights the GM shared, under the player's own sheet, out of combat.
              Renders nothing when nothing has been shared, so an empty shelf is never a thing to read. */}
          {mode === "player" && !state.combat.active && mapToken && <ReplayShelf token={mapToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />}
          {mode === "player" && <section className="gm-session-controls"><Button variant="secondary" onClick={leavePlayer}>Leave table</Button></section>}
        </div>
      </div>}

      {/* The Scenes tab is two addresses in one arm, and since C2 both own their own frame: the
          gallery (`surface`), and the map library (back row · heading · upload row over a
          rail | calibration body). The staging wrapper drained with it — this arm was the last thing
          in this file to ride the retired staged scroller. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "scenes" && Array.isArray((state as GmView).combat.scenes) && (scenesView === "maps"
        ? <MapManager gmToken={gmToken} preferredMapId={(state as GmView).combat.mapAssetId} onSelectionChange={setSelectedMap} onBack={() => navigate(pathForGmTab("scenes"))} />
        : <SceneGallery surface scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} liveCombatantCount={(state as GmView).combat.initiative.length} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} onNewScene={() => setScenePrepOpen(true)} onManageMaps={() => navigate("/scenes/maps")} onClose={() => navigate(pathForGmTab("table"))} onFeedback={failToast} />)}

      {/* The shared-screen controls own their frame (§7, B3): a heading row over a body that is one
          region below the laptop rung and two self-owning columns at it — the staging wrapper
          drained with it. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "viewer" && <ViewerControls gmToken={gmToken} {...(selectedMap ? { map: { assetId: selectedMap.id, width: selectedMap.width, height: selectedMap.height, altText: selectedMap.name, calibration: selectedMap.calibration, scale: selectedMap.scale, ...(selectedMap.previewUrl ? { previewUrl: selectedMap.previewUrl } : {}) } } : {})} />}

      {/* The roster owns its frame (heading row + one region + its own sky), so it takes the pane
          directly — the staging wrapper drained with it. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "roster" && <PartyRosterTab state={state as GmView} onCreateCharacter={() => navigate("/builder")} />}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "replay" && <ReplayList role="gm" token={gmToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />}
      {/* D27 — a player reaches the shared list at the same address, as its own page, with the Table
          tab lit and a way back to it (the surface's own frame row now, not a button stranded above
          it). Unshared ids are 404 at the server, so the list is the truth. */}
      {mode === "player" && playerView === "table" && route.segments[0] === "replays" && mapToken &&
        <ReplayList role="player" token={mapToken} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} onBack={() => navigate("/table")} />}
      {/* THE CODEX OWNS ITS FRAME (B2), GM half — same shell, same regions, one more section list. */}
      {mode === "gm" && gmToken && route.segments[0] === "codex" && <CodexShell gmToken={gmToken}
        scenes={(state as GmView | null)?.combat?.scenes?.map((scene) => ({ id: scene.id, name: scene.name })) ?? []}
        actors={(state as GmView | null)?.actors?.map((actor) => ({ id: actor.id, name: actor.name })) ?? []}
        activeSceneId={(state as GmView | null)?.combat?.activeSceneId ?? null}
        onActivateScene={(sceneId: string) => { makeSceneLive(sceneId); navigate(pathForGmTab("table")); }}
        onOpenReplay={(archiveId: number) => navigate(`/replays/${archiveId}`)} />}

      {/* HOMEBREW OWNS ITS FRAME (B2): a modebar row over a master-detail workspace whose two panes
          each scroll themselves. */}
      {mode === "gm" && gmToken && !gmAddressUnknown && gmTab === "homebrew" && <HomebrewPanel gmToken={gmToken} />}

      {mode === "gm" && gmToken && showViewerPreview &&<ViewerPreviewPanel gmToken={gmToken} onClose={() => setShowViewerPreview(false)} />}

      {mode === "gm" && gmToken && scenePrepOpen && state && <Modal open onClose={() => setScenePrepOpen(false)} size="lg" className="scene-prep-modal" title="New scene" ariaLabel="New scene">
        <ScenePanel actors={(state as GmView).actors} selectedMap={selectedMap} mapLibrary={mapLibrary} stagingDefaults={(state as GmView).stagingDefaults} onCreated={(sceneId) => { setScenePrepOpen(false); if (sceneId) setPendingStageSceneId(sceneId); }} />
      </Modal>}

      {mode === "gm" && gmToken && scenesModalOpen && state && Array.isArray((state as GmView).combat.scenes) && <Modal open onClose={() => setScenesModalOpen(false)} size="lg" className="scenes-modal" title="Scenes" ariaLabel="Scenes">
        <SceneGallery scenes={(state as GmView).combat.scenes} activeSceneId={(state as GmView).combat.activeSceneId ?? null} combatActive={state.combat.active} liveCombatantCount={(state as GmView).combat.initiative.length} mapLibrary={mapLibrary} previewingSceneId={previewSceneId} token={mapToken} hideHeading onNewScene={() => { setScenesModalOpen(false); setScenePrepOpen(true); }} onManageMaps={() => { setScenesModalOpen(false); navigate("/scenes/maps"); }} onClose={() => setScenesModalOpen(false)} onFeedback={failToast} />
      </Modal>}

      {/* A7/D24 — Settings replaces "VTT Setup", and nothing /setup held is lost: theme moved to Mine,
          credentials and session security to The table → Access & integrations (§B9.4).
          The GM's page is the two-column one at ≥1280 (settings.css); the surface owns the
          frame either way, so it takes the pane directly. */}
      {/* RULING 61 — A6 as a real address. `/settings/api` is the reference given the whole pane,
          bookmarkable and deep-linkable, with an "open in a new tab" action. The new tab lands on the
          app's own GM sign-in card and takes the password once: the GM token is deliberately
          memory-only, and every alternative copies a credential somewhere it should not go. */}
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
    {/* RULING 6 — the combat log's drawer. It lives OUTSIDE the pane for the same reason the token
        picker does: it is `position: fixed`, and the pane is where transforms happen. Non-modal by
        design, so the table stays live behind it — which is the whole requirement. */}
    {shellVisible && <CombatLogDrawer open={logOpen} onClose={() => setLogOpen(false)} />}
    {/* A11/D18 — the token picker, opened from the sheet or from Settings → Players. The server
        decides who may set which token; this is the door, not the gate. Dialogs live outside the
        pane: open they are top-layer, closed they render no box — neither takes a frame row. */}
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
