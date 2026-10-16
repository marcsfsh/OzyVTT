import { useCallback, useEffect, useMemo, useState } from "react";
import { RulesButton } from "../reference/RulesReference";
import type { GmView } from "@vtt/domain";
import { Modal, Tabs, useToast, Wordmark } from "@vtt/ui";
import { PartyRosterTab } from "../actors/PartyRosterTab";
import { useConfirm } from "../components/feedback";
import { lazySurface } from "../components/lazySurface";
import { NotFoundPage } from "../components/NotFoundView";
import { command } from "../lib/command";
import { listMaps } from "../maps/map-catalog";
import type { MapSelection } from "../maps/MapManager";
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
import { SceneGallery } from "../scenes/SceneGallery";
import { ScenePanel } from "../scenes/ScenePanel";
import { setPreviewScene, usePreviewScene } from "../scenes/scenePreview";
import { useAutoArrange } from "../settings/preferences";
import { isFullPageLayer, LayerView } from "./LayerView";
import { TableView } from "./TableView";
import type { Connection } from "./useSession";

const CodexShell = lazySurface(() => import("../codex/CodexShell").then((m) => m.CodexShell));
const HomebrewPanel = lazySurface(() => import("../homebrew/HomebrewPanel").then((m) => m.HomebrewPanel));
const SettingsPage = lazySurface(() => import("../settings/SettingsPage").then((m) => m.SettingsPage));
const ApiReferencePage = lazySurface(() => import("../integrations/ApiReference").then((m) => m.ApiReferencePage));
const MapManager = lazySurface(() => import("../maps/MapManager").then((m) => m.MapManager));
const ReplayList = lazySurface(() => import("../replay/ReplayList").then((m) => m.ReplayList));
const ViewerControls = lazySurface(() => import("../viewer/ViewerControls").then((m) => m.ViewerControls));
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

/**
 * The GM's tab bar. The tab is read from the address, which names one; addresses that name none
 * (`/`, `/codex/pages/x`) resolve to "table". A tab returns you to where you were in it, and re-tapping
 * the current tab goes to its front door. It stays up while a full-page layer is open.
 */
export function GmTabBar() {
  const route = useRoute();
  const gmTab: GmTab = litGmTab(route.path) ?? "table";
  return (
    <div className="frame-tabbar rim-gm">
      <Wordmark variant="solid" sun className="app-logo" aria-hidden="true" />
      <Tabs
        className="gm-tabs"
        ariaLabel="GM sections"
        tabs={GM_TABS.map((tab) => ({ id: tab.id, label: tab.label }))}
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
      <RulesButton />
    </div>
  );
}

/** The GM's pane: the surface the address names, and the scene dialogs over the table. */
export function GmShell({
  state,
  token,
  connection,
  busy,
  onOpenLog,
  onSignOut,
  onRevokeAll
}: Readonly<{
  state: GmView;
  token: string;
  connection: Connection;
  busy: boolean;
  onOpenLog: () => void;
  onSignOut: () => void;
  onRevokeAll: () => void;
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
  // The maps library is its own address.
  const scenesView: "gallery" | "maps" = layer?.kind === "maps" ? "maps" : "gallery";
  const [selectedMap, setSelectedMap] = useState<MapSelection | null>(null);
  const [mapLibrary, setMapLibrary] = useState<readonly MapSelection[]>([]);
  const [showViewerPreview, setShowViewerPreview] = useState(false);
  const [scenePrepOpen, setScenePrepOpen] = useState(false);
  const [scenesModalOpen, setScenesModalOpen] = useState(false);
  // A new scene auto-opens for private staging, but it can only be staged once it lands in GameState
  // (the preview guard below would drop its id), so hold the id and stage on arrival.
  const [pendingStageSceneId, setPendingStageSceneId] = useState<string | null>(null);
  const previewSceneId = usePreviewScene();
  const autoArrange = useAutoArrange();
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  /**
   * Read defensively: the first `state:updated` a signing-in GM receives can still be the player-shaped
   * projection, which has no scenes. The scene surfaces wait for the GM's.
   */
  const scenesLoaded = Array.isArray(state.combat.scenes);
  const scenes = useMemo(() => state.combat.scenes ?? [], [state.combat.scenes]);

  // The map library loads with the GM session (refreshed when returning to Table or Scenes, and after an
  // upload from a picker), so starting a fight or the shared screen never needs a visit to the library.
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
          /* the maps view surfaces library errors; setup just stays empty */
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
    // Re-fetch when the maps view closes, so a just-uploaded battlemap appears in the scene pickers.
  }, [loadMaps, gmTab, scenesView]);

  // GM-private scene staging: while previewing a prepared scene, the table map renders that scene for
  // arranging. Players and the shared screen are unaffected.
  const previewScene = previewSceneId ? (scenes.find((scene) => scene.id === previewSceneId) ?? null) : null;
  useEffect(() => {
    // Drop the preview if its scene was removed or went live.
    if (
      previewSceneId &&
      !scenes.some((scene) => scene.id === previewSceneId && scene.id !== state.combat.activeSceneId)
    )
      setPreviewScene(null);
  }, [previewSceneId, scenes, state.combat.activeSceneId]);
  useEffect(() => {
    // Open a just-created scene for arranging once it appears in state, unless the GM turned that off
    // (Settings → The table → New tokens).
    if (pendingStageSceneId && scenes.some((scene) => scene.id === pendingStageSceneId)) {
      if (autoArrange) setPreviewScene(pendingStageSceneId);
      setPendingStageSceneId(null);
    }
  }, [pendingStageSceneId, scenes, autoArrange]);
  useEffect(() => {
    // Staging renders on the table map, so switch to it and close the pickers.
    if (previewScene) {
      navigate(pathForGmTab("table"));
      setScenePrepOpen(false);
      setScenesModalOpen(false);
    }
  }, [previewScene]);
  const makeSceneLive = (sceneId: string) =>
    void command("scene:activate", { sceneId }).then(() => setPreviewScene(null));
  const revokeAll = async () => {
    const ok = await confirm({
      title: "Revoke every GM session?",
      body: "This signs out every GM browser, including this one. Everyone will need to sign in again.",
      confirmLabel: "Revoke all",
      danger: true
    });
    if (ok) onRevokeAll();
  };
  const failToast = (text: string) => toast(text, { tone: "error" });

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
          onOpenLog={onOpenLog}
          gm={{
            selectedMap,
            mapLibrary,
            onSelectMap: setSelectedMap,
            stagedScene: previewScene,
            onPrepareScene: () => setScenePrepOpen(true),
            onViewAllScenes: () => setScenesModalOpen(true),
            onBackToLive: () => setPreviewScene(null),
            onMakeLive: makeSceneLive,
            viewerPreview: { on: showViewerPreview, onToggle: () => setShowViewerPreview((current) => !current) }
          }}
        />
      )}

      {/* The Scenes tab is two addresses: the gallery and the map library, each owning its frame. */}
      {tab("scenes") &&
        scenesLoaded &&
        (scenesView === "maps" ? (
          <MapManager
            gmToken={token}
            preferredMapId={state.combat.mapAssetId}
            onSelectionChange={setSelectedMap}
            onBack={() => navigate(pathForGmTab("scenes"))}
          />
        ) : (
          <SceneGallery
            surface
            scenes={scenes}
            activeSceneId={state.combat.activeSceneId ?? null}
            combatActive={state.combat.active}
            liveCombatantCount={state.combat.initiative.length}
            mapLibrary={mapLibrary}
            previewingSceneId={previewSceneId}
            token={token}
            onNewScene={() => setScenePrepOpen(true)}
            onManageMaps={() => navigate("/scenes/maps")}
            onClose={() => navigate(pathForGmTab("table"))}
            onFeedback={failToast}
          />
        ))}

      {/* The shared-screen controls own their frame. */}
      {tab("viewer") && (
        <ViewerControls
          gmToken={token}
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
      {tab("roster") && <PartyRosterTab state={state} onCreateCharacter={() => navigate("/builder")} />}
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
          onActivateScene={(sceneId: string) => {
            makeSceneLive(sceneId);
            navigate(pathForGmTab("table"));
          }}
          onOpenReplay={(archiveId: number) => navigate(`/replays/${archiveId}`)}
        />
      )}

      {/* Homebrew owns its frame: a modebar row over a master-detail workspace. */}
      {tab("homebrew") && <HomebrewPanel gmToken={token} />}

      {showViewerPreview && <ViewerPreviewPanel gmToken={token} onClose={() => setShowViewerPreview(false)} />}

      {scenePrepOpen && (
        <Modal
          open
          onClose={() => setScenePrepOpen(false)}
          size="lg"
          className="scene-prep-modal"
          title="New scene"
          ariaLabel="New scene"
        >
          <ScenePanel
            actors={state.actors}
            selectedMap={selectedMap}
            mapLibrary={mapLibrary}
            stagingDefaults={state.stagingDefaults}
            onCreated={(sceneId) => {
              setScenePrepOpen(false);
              if (sceneId) setPendingStageSceneId(sceneId);
            }}
            onMapUploaded={() => void loadMaps()}
          />
        </Modal>
      )}

      {scenesModalOpen && scenesLoaded && (
        <Modal
          open
          onClose={() => setScenesModalOpen(false)}
          size="lg"
          className="scenes-modal"
          title="Scenes"
          ariaLabel="Scenes"
        >
          <SceneGallery
            scenes={scenes}
            activeSceneId={state.combat.activeSceneId ?? null}
            combatActive={state.combat.active}
            liveCombatantCount={state.combat.initiative.length}
            mapLibrary={mapLibrary}
            previewingSceneId={previewSceneId}
            token={token}
            hideHeading
            onNewScene={() => {
              setScenesModalOpen(false);
              setScenePrepOpen(true);
            }}
            onManageMaps={() => {
              setScenesModalOpen(false);
              navigate("/scenes/maps");
            }}
            onClose={() => setScenesModalOpen(false)}
            onFeedback={failToast}
          />
        </Modal>
      )}

      {/* `/settings/api`: the API reference at full pane width. Opening it in a new tab asks for the GM
        password once, since the GM token is memory-only. The Settings page is two columns at 1280px+. */}
      {tab("settings") &&
        (route.path === "/settings/api" ? (
          <ApiReferencePage gmToken={token} onBack={() => navigate(pathForGmTab("settings"))} />
        ) : (
          <SettingsPage
            role="gm"
            state={state}
            gmToken={token}
            busy={busy}
            onPreviewPlayers={() => {
              navigate(pathForGmTab("table"));
              setShowViewerPreview(true);
            }}
            onSignOut={onSignOut}
            onRevokeAll={() => void revokeAll()}
          />
        ))}
      {dialog}
    </>
  );
}
