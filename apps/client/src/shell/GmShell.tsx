import { useCallback, useEffect, useMemo, useState } from "react";
import type { GmView } from "@vtt/domain";
import { ThemeSwitch, Wordmark } from "@vtt/ui";
import { PartyRosterTab } from "../actors/PartyRosterTab";
import { useConfirm } from "../components/feedback";
import { lazySurface } from "../components/lazySurface";
import { NotFoundPage } from "../components/NotFoundView";
import { listMaps, type MapAsset, type MapSelection } from "../maps/map-catalog";
import {
  isKnownPath,
  isPlayerOnlyPath,
  lastLocationForTab,
  layerOf,
  litGmTab,
  navigate,
  pathForGmTab,
  useRoute,
  type GmTab
} from "../router";
import { useSceneActions } from "../scenes/sceneActions";
import { AppTabs, type TabFit } from "./AppTabs";
import { isFullPageLayer, LayerView } from "./LayerView";
import { TableView } from "./TableView";
import type { Connection } from "./useSession";

const CodexShell = lazySurface(() => import("../codex/CodexShell").then((m) => m.CodexShell));
const HomebrewPanel = lazySurface(() => import("../homebrew/HomebrewPanel").then((m) => m.HomebrewPanel));
const SettingsPage = lazySurface(() => import("../settings/SettingsPage").then((m) => m.SettingsPage));
const ScenesShell = lazySurface(() => import("../scenes/ScenesShell").then((m) => m.ScenesShell));
const ReplayList = lazySurface(() => import("../replay/ReplayList").then((m) => m.ReplayList));
const ViewerControls = lazySurface(() => import("../viewer/ViewerControls").then((m) => m.ViewerControls));
const SoundBoard = lazySurface(() => import("../sound/SoundBoard").then((m) => m.SoundBoard));
// A floating panel over the table: nothing to hold its place while it loads.
const ViewerPreviewPanel = lazySurface(
  () => import("../viewer/ViewerPreviewPanel").then((m) => m.ViewerPreviewPanel),
  null
);

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

/** All eight tabs from 980px; then five, four, and three on a phone, the rest in the More menu. */
const GM_TAB_FIT: TabFit = [GM_TABS.length, 5, 4, 3];

/**
 * The GM's tab bar. The tab is read from the address, which names one; addresses that name none
 * (`/`, `/codex/pages/x`) resolve to "table". A tab returns you to where you were in it, and re-tapping
 * the current tab goes to its front door. It stays up while a full-page layer is open, with the theme switch at its
 * end.
 */
export function GmTabBar() {
  const route = useRoute();
  const gmTab: GmTab = litGmTab(route.path) ?? "table";
  return (
    <div className="frame-tabbar rim-gm">
      <Wordmark variant="solid" sun className="app-logo" aria-hidden="true" />
      <AppTabs
        className="gm-tabs"
        ariaLabel="GM sections"
        tabs={GM_TABS.map((tab) => ({ id: tab.id, label: tab.label, name: tab.label }))}
        fits={GM_TAB_FIT}
        activeId={gmTab}
        onChange={(id) => {
          const next = id as GmTab;
          navigate(
            next === gmTab
              ? pathForGmTab(next)
              : (lastLocationForTab("gm", pathForGmTab(next).slice(1)) ?? pathForGmTab(next))
          );
        }}
      />
      <ThemeSwitch className="app-theme-switch" />
    </div>
  );
}

/** The GM's pane: the surface the address names, and the scene dialogs over the table. */
export function GmShell({
  state,
  token,
  connection,
  busy,
  onSignOut,
  onRevokeAll,
  onChangePassword
}: Readonly<{
  state: GmView;
  token: string;
  connection: Connection;
  busy: boolean;
  onSignOut: () => void;
  onRevokeAll: () => void;
  onChangePassword: (currentPassword: string, newPassword: string) => Promise<string | null>;
}>) {
  const route = useRoute();
  const gmTab: GmTab = litGmTab(route.path) ?? "table";
  const layer = layerOf(route.path);
  /**
   * An address the app does not answer:
   * (1) Inside the Codex, `CodexShell` owns not-found (its sidebar stays usable), so the shell stands
   *     down on any `/codex/*` address.
   * (2) Elsewhere the tab arms must stand down too: `litGmTab` falls back to "table", which would
   *     otherwise paint the whole table under the not-found card.
   * (3) Player-only addresses (`/me`) are unknown to the GM.
   */
  const addressUnknown = (!isKnownPath(route.path) || isPlayerOnlyPath(route.path)) && route.segments[0] !== "codex";
  const [selectedMap, setSelectedMap] = useState<MapSelection | null>(null);
  const [mapLibrary, setMapLibrary] = useState<readonly MapSelection[]>([]);
  const [showViewerPreview, setShowViewerPreview] = useState(false);
  const { confirm, dialog } = useConfirm();
  /**
   * Read defensively: the first `state:updated` a signing-in GM receives can still be the player-shaped
   * projection, which has no scenes. The scene surfaces wait for the GM's.
   */
  const scenesLoaded = Array.isArray(state.combat.scenes);
  const scenes = useMemo(() => state.combat.scenes ?? [], [state.combat.scenes]);
  const sceneActions = useSceneActions(scenes, { combatActive: state.combat.active });
  // One way to make a scene live from anywhere: asked first while a fight is on, since that fight is parked.
  const makeSceneLive = async (sceneId: string): Promise<boolean> => {
    const scene = scenes.find((candidate) => candidate.id === sceneId);
    return scene ? sceneActions.makeLive(scene) : false;
  };

  // The map library loads with the GM session (refreshed when returning to Table or Scenes, and after a change in
  // Scenes), so starting a fight or the shared screen never needs a visit to the library.
  const loadMaps = useCallback(
    (isCancelled: () => boolean = () => false) =>
      listMaps(token)
        .then((library) => {
          if (isCancelled()) return;
          setMapLibrary(library);
          // Default to the newest battlemap so Start is one click away on first login.
          setSelectedMap((current) =>
            current && library.some((map) => map.id === current.id)
              ? current
              : (library.find((map) => map.kind === "battlemap") ?? null)
          );
        })
        .catch(() => {
          /* the Maps section surfaces library errors; setup just stays empty */
        }),
    [token]
  );
  useEffect(() => {
    if (gmTab !== "table" && gmTab !== "scenes") return;
    let cancelled = false;
    void loadMaps(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadMaps, gmTab]);
  const onLibraryChanged = useCallback(() => void loadMaps(), [loadMaps]);
  // A map opened in Scenes becomes the shared screen's map choice, as the library's selection was.
  const onOpenMap = useCallback(
    (map: MapAsset) =>
      setSelectedMap((current) =>
        current?.id === map.id && current.calibration === map.calibration && current.scale === map.scale
          ? current
          : {
              id: map.id,
              name: map.name,
              kind: map.kind,
              width: map.width,
              height: map.height,
              calibration: map.calibration,
              scale: map.scale
            }
      ),
    []
  );
  const revokeAll = async () => {
    const ok = await confirm({
      title: "Revoke every GM session?",
      body: "This signs out every GM browser, including this one. Everyone will need to sign in again.",
      confirmLabel: "Revoke all",
      danger: true
    });
    if (ok) onRevokeAll();
  };

  if (isFullPageLayer(layer))
    return <LayerView layer={layer} role="gm" state={state} token={token} connection={connection} />;
  const tab = (id: GmTab) => !addressUnknown && gmTab === id;
  return (
    <>
      {/* An unknown address and a player-only address both land here, indistinguishably. */}
      {addressUnknown && <NotFoundPage role="gm" />}

      {tab("table") && route.segments[0] !== "codex" && (
        <TableView
          role="gm"
          state={state}
          token={token}
          gm={{
            selectedMap,
            mapLibrary,
            onSelectMap: setSelectedMap,
            onMakeLive: (sceneId) => void makeSceneLive(sceneId),
            viewerPreview: { on: showViewerPreview, onToggle: () => setShowViewerPreview((current) => !current) }
          }}
        />
      )}

      {/* The Scenes tab owns its frame: Overview, Scenes and Maps, and a scene or a map as one document. */}
      {tab("scenes") && scenesLoaded && (
        <ScenesShell state={state} token={token} onLibraryChanged={onLibraryChanged} onOpenMap={onOpenMap} />
      )}

      {/* The shared-screen controls own their frame: what the table screen shows, or at `/sound` what it plays. */}
      {tab("viewer") && route.segments[1] === "sound" && (
        <SoundBoard
          gmToken={token}
          scenes={scenes.map((scene) => ({ id: scene.id, name: scene.name }))}
          activeSceneId={state.combat.activeSceneId ?? null}
        />
      )}
      {tab("viewer") && route.segments[1] !== "sound" && (
        <ViewerControls
          gmToken={token}
          onPreview={() => setShowViewerPreview(true)}
          {...(selectedMap
            ? {
                map: {
                  assetId: selectedMap.id,
                  width: selectedMap.width,
                  height: selectedMap.height,
                  altText: selectedMap.name,
                  calibration: selectedMap.calibration,
                  scale: selectedMap.scale
                }
              }
            : {})}
        />
      )}

      {/* The roster owns its frame. */}
      {tab("roster") && <PartyRosterTab state={state} token={token} onCreateCharacter={() => navigate("/builder")} />}
      {tab("replay") && (
        <ReplayList role="gm" token={token} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />
      )}

      {/* The GM Codex. `actors` carries `archived` and `kind` too: the Codex's character pickers order
        archived characters last, and "archived" is a table flag with no Codex equivalent (see
        `codex/characters.ts`). */}
      {route.segments[0] === "codex" && (
        <CodexShell
          gmToken={token}
          scenes={scenes.map((scene) => ({ id: scene.id, name: scene.name }))}
          actors={(state.actors ?? []).map((actor) => ({
            id: actor.id,
            name: actor.name,
            archived: actor.archived,
            kind: actor.kind
          }))}
          activeSceneId={state.combat.activeSceneId ?? null}
          gameHours={state.rest?.clockHours ?? null}
          onActivateScene={(sceneId: string) =>
            void makeSceneLive(sceneId).then((live) => {
              if (live) navigate(pathForGmTab("table"));
            })
          }
          onOpenReplay={(archiveId: number) => navigate(`/replays/${archiveId}`)}
        />
      )}

      {/* Homebrew owns its frame: a modebar row over a master-detail workspace. */}
      {tab("homebrew") && <HomebrewPanel gmToken={token} />}

      {showViewerPreview && <ViewerPreviewPanel gmToken={token} onClose={() => setShowViewerPreview(false)} />}

      {/* Settings owns its addresses: a section at `/settings/<section>` and an operation of the API reference at
        `/settings/api/<operation id>`. Opening the reference in a new tab asks for the GM password once, since the GM
        token is memory-only. */}
      {tab("settings") && (
        <SettingsPage
          role="gm"
          state={state}
          gmToken={token}
          busy={busy}
          onPreviewPlayers={() => setShowViewerPreview(true)}
          onSignOut={onSignOut}
          onRevokeAll={() => void revokeAll()}
          onChangePassword={onChangePassword}
        />
      )}
      {dialog}
      {sceneActions.dialogs}
    </>
  );
}
