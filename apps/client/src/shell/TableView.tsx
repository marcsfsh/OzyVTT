import { useEffect, useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { Button, IconScene } from "@vtt/ui";
import { ClaimCharacter } from "../actors/ClaimCharacter";
import { partyVisibilityOf } from "../actors/MyCharacter";
import { PartyStrip } from "../actors/PartyStrip";
import { DicePanel } from "../dice/DicePanel";
import { DockAccordion } from "../encounter/DockAccordion";
import { DOCK_POSITIONS, EncounterPanel, type DockPosition } from "../encounter/EncounterPanel";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { MapSelection } from "../maps/MapManager";
import { ReplayShelf } from "../replay/ReplayShelf";
import { EncounterMap } from "../scene/EncounterMap";
import { SceneBuilder } from "../scenes/SceneBuilder";
import { navigate, pathForGmTab } from "../router";
import "./table-view.css";

type StagedScene = GmView["combat"]["scenes"][number];

/** What only the GM's table has: the map choice, private scene staging and the shared-screen preview. */
export type GmTable = Readonly<{
  selectedMap: MapSelection | null;
  mapLibrary: readonly MapSelection[];
  onSelectMap: (map: MapSelection | null) => void;
  /** The prepared scene being staged privately on the GM's map, if any. */
  stagedScene: StagedScene | null;
  onPrepareScene: () => void;
  onViewAllScenes: () => void;
  onBackToLive: () => void;
  onMakeLive: (sceneId: string) => void;
  viewerPreview: Readonly<{ on: boolean; onToggle: () => void }>;
}>;

type TableViewProps = Readonly<
  { token: string; onOpenLog: () => void } & (
    { role: "gm"; state: GmView; gm: GmTable } | { role: "player"; state: PlayerView; onLeave: () => void }
  )
>;

/**
 * The phone table, below 980px (the stylesheet's breakpoint): the map is a fixed band and the sheet
 * takes the rest. Some arrangements cannot be expressed in CSS: which row the pre-claim picker
 * belongs to, and whether a side dock may be offered at all.
 */
const PHONE_TABLE_QUERY = "(max-width: 979px)";

/** Where the encounter panel docks on the map, and how wide; remembered per browser. */
function useDockPreference() {
  const [position, setPosition] = useState<DockPosition>(() => {
    const stored = localStorage.getItem("vtt.dock-position");
    if (stored === "top" || stored === "bottom") return "right"; // top/bottom docking no longer exists; the nearest edge is right.
    return DOCK_POSITIONS.includes(stored as DockPosition) ? (stored as DockPosition) : "sidebar";
  });
  const [width, setWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem("vtt.dock-width"));
    return Number.isFinite(stored) && stored >= 240 ? stored : 352; // 22rem default
  });
  useEffect(() => {
    localStorage.setItem("vtt.dock-position", position);
  }, [position]);
  useEffect(() => {
    localStorage.setItem("vtt.dock-width", String(width));
  }, [width]);
  return { position, setPosition, width, setWidth };
}

/**
 * The table, for both roles. It owns its frame at every width: above 980px two columns share one
 * height; below it the rows stack with the map as a fixed band and the sheet taking the rest.
 * `.scroll-y` is the frame's escape hatch: the docked arm is a bare panel stack that cannot fit, and on
 * a phone a pane shorter than the frame's floors (landscape, soft keyboard) must scroll.
 */
export function TableView(props: TableViewProps) {
  const { role, state, token, onOpenLog } = props;
  const gm = props.role === "gm" ? props.gm : null;
  const phoneTable = useMediaQuery(PHONE_TABLE_QUERY);
  const dock = useDockPreference();
  // Docking is available whenever a map is loaded (a live scene), not only once combat starts.
  // Players' projection nulls mapAssetId until combat, so this never affects them or the viewer.
  const combatMapActive = !!state.combat.mapAssetId;
  /**
   * Whether this player has claimed anyone, which decides between the pre-claim picker and their own
   * character. Read from the projection's `claimStatus`.
   */
  const playerHasClaimed =
    props.role === "player" &&
    props.state.actors.some((actor) => actor.kind === "player-character" && actor.claimStatus === "mine");
  /**
   * No docking below the phone breakpoint: a side dock would take most of the map band and render an
   * unbounded panel stack. So the phone forces `sidebar` and offers no dock picker. The stored
   * preference is untouched, so a wider screen still finds the dock where the GM left it.
   */
  const showDocked = combatMapActive && !phoneTable && dock.position !== "sidebar";
  const encounterDock =
    combatMapActive && !phoneTable ? { position: dock.position, onChange: dock.setPosition } : undefined;
  const encounterPanel =
    props.role === "gm" ? (
      <EncounterPanel
        role="gm"
        state={props.state}
        selectedMap={props.gm.selectedMap}
        mapLibrary={props.gm.mapLibrary}
        onSelectMap={props.gm.onSelectMap}
        dock={encounterDock}
      />
    ) : (
      <EncounterPanel role="player" state={props.state} dock={encounterDock} />
    );
  // The map dock exists whenever combat runs (even in sidebar mode), so its in-map control is
  // reachable from the enlarged map; `node` is the panel only when actually docked.
  const mapDock =
    combatMapActive && !phoneTable
      ? {
          position: dock.position,
          onChange: dock.setPosition,
          width: dock.width,
          onWidthChange: dock.setWidth,
          node: showDocked ? encounterPanel : null
        }
      : undefined;
  const staged = gm?.stagedScene ?? null;
  const activeScene =
    props.role === "gm"
      ? (props.state.combat.scenes?.find((scene) => scene.id === props.state.combat.activeSceneId) ?? null)
      : null;

  return (
    <div className={`table-layout anim-view scroll-y${showDocked ? " docked" : ""}`}>
      <section className="table">
        {/* The top line: one 44px row below 980px and `display: contents` above it. Hides itself when
          empty. */}
        <div className="table-topline">
          {/* The party strip, out of combat only (in combat the turn order shows the same people). It is
            a party surface, so the `off` tier removes it for players. Read the tier, not which fields
            arrived: every ally stays in `state.actors` at `off` because initiative and tokens need them.
            The GM's strip is not tier-gated. */}
          {!staged &&
            !state.combat.active &&
            (props.role === "gm" ? (
              <PartyStrip role="gm" state={props.state} onOpenRoster={() => navigate(pathForGmTab("roster"))} />
            ) : playerHasClaimed && partyVisibilityOf(props.state) !== "off" ? (
              <PartyStrip role="player" state={props.state} />
            ) : null)}
        </div>
        {/* A player who has claimed nobody gets the picker. On a phone it renders as the sheet's body
          (below), so the map band stays live in a running fight. */}
        {props.role === "player" && !playerHasClaimed && !phoneTable && <ClaimCharacter state={props.state} />}
        {staged ? (
          <>
            <div className="scene-preview-banner" role="status">
              Staging <strong>{staged.name}</strong> — GM only. Drag tokens from the tray to place them, then use the
              map buttons to go back or make it live.
            </div>
            <EncounterMap
              assetId={staged.mapAssetId}
              token={token}
              altText={`Staging ${staged.name}`}
              role="gm"
              actors={state.actors}
              tokens={staged.combat.tokens}
              annotations={[]}
              revision={state.revision}
              activeActorId={null}
              fog={staged.combat.fog}
              terrain={staged.combat.terrain}
              moveSceneId={staged.id}
              onScenePrep={gm?.onPrepareScene}
              staging={{
                onBackToLive: () => gm?.onBackToLive(),
                onMakeLive: () => gm?.onMakeLive(staged.id)
              }}
              healthDisplay={staged.combat.healthDisplay}
              state={state}
            />
          </>
        ) : (
          <>
            {!state.combat.active && state.combat.mapAssetId && (
              <p className="table-status">
                {role === "gm"
                  ? "Scene is live — add who's in it and start the fight from the panel below."
                  : "Waiting for the GM to start the fight."}
              </p>
            )}
            {!state.combat.active && !state.combat.mapAssetId && (
              <p className="table-status">
                {role === "gm"
                  ? "No fight running yet. Start one from the panel below."
                  : "No fight running yet. The GM will start one when everyone's ready."}
              </p>
            )}
            {/* Render the map once a scene is live, even before combat. Players still only get it once
              combat is active (their projection nulls mapAssetId until then). */}
            {state.combat.mapAssetId ? (
              <EncounterMap
                assetId={state.combat.mapAssetId}
                token={token}
                altText={gm?.selectedMap?.id === state.combat.mapAssetId ? gm.selectedMap.name : "Battle map"}
                role={role}
                actors={state.actors}
                tokens={state.combat.tokens}
                annotations={state.combat.annotations}
                revision={state.revision}
                activeActorId={state.combat.turnActorId}
                reactionsUsed={state.combat.reactionsUsed}
                fog={state.combat.fog}
                terrain={state.combat.terrain}
                dock={mapDock}
                onScenePrep={gm?.onPrepareScene}
                {...(props.role === "gm" && Array.isArray(props.state.combat.scenes)
                  ? {
                      onViewAllScenes: props.gm.onViewAllScenes,
                      ...(activeScene ? { activeSceneName: activeScene.name } : {})
                    }
                  : {})}
                {...(gm ? { viewerPreview: gm.viewerPreview } : {})}
                healthDisplay={props.role === "gm" ? props.state.combat.healthDisplay : undefined}
                state={state}
              />
            ) : (
              <div className="empty map-empty-hero scanlines">
                <div className="empty-atmos" aria-hidden="true">
                  <span className="home-hero-bloom" />
                  <span className="home-hero-grid grid-floor" />
                </div>
                <strong>No map loaded yet</strong>
                <span>
                  {role === "gm"
                    ? "Prepare a scene from the Scenes tab - pick a map and who's in it, then go live."
                    : "The GM will load the battle map when combat begins."}
                </span>
                {gm && (
                  <Button variant="secondary" className="empty-scene-prep" onClick={gm.onPrepareScene}>
                    <IconScene /> Prepare a scene
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </section>
      {/* The sheet row: the sidebar column above 980px; below it, the row that takes the leftover height
        (`.table-sheet`, where the tabbed sheet lives). Each arm is a frame column, so the row never
        scrolls, except the docked arm: with the tracker docked into the map, the dice panel renders bare
        and cannot fit, so the column declares a scroll. */}
      <div className={`table-sidebar table-sheet${showDocked ? " scroll-y" : ""}`}>
        {props.role === "gm" && staged ? (
          <SceneBuilder
            scene={staged}
            actors={props.state.actors}
            revision={state.revision}
            stagingDefaults={props.state.stagingDefaults}
          />
        ) : /* On a phone an unclaimed player's sheet is the claim picker. */
        props.role === "player" && !playerHasClaimed && phoneTable ? (
          <ClaimCharacter state={props.state} />
        ) : /* The dock accordion, in and out of combat. When the tracker is docked into the map, the map
             owns the arrangement instead. */
        showDocked ? (
          /* With the tracker docked into the map only the dice remain here; the log drawer is a tap away. */
          <>
            <DicePanel role={role} state={state} />
            <Button variant="secondary" className="dock-log-door-standalone" onClick={onOpenLog}>
              Combat log
            </Button>
          </>
        ) : (
          <DockAccordion
            role={role}
            inCombat={state.combat.active}
            turnLabel={state.combat.active ? "Turn order" : "The fight"}
            turn={encounterPanel}
            dice={<DicePanel role={role} state={state} />}
            onOpenLog={onOpenLog}
          />
        )}
        {/* The fights the GM shared, under the player's sheet, out of combat. Renders nothing when
          nothing is shared. */}
        {props.role === "player" && !state.combat.active && (
          <ReplayShelf token={token} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />
        )}
        {props.role === "player" && (
          <section className="gm-session-controls">
            <Button variant="secondary" onClick={props.onLeave}>
              Leave table
            </Button>
          </section>
        )}
      </div>
    </div>
  );
}
