import { useEffect, useRef, useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { Button, IconScene } from "@vtt/ui";
import { ClaimCharacter } from "../actors/ClaimCharacter";
import { partyVisibilityOf } from "../actors/MyCharacter";
import { PartyStrip } from "../actors/PartyStrip";
import { DicePanel } from "../dice/DicePanel";
import { CombatLogPanel } from "../encounter/CombatLog";
import { EncounterPanel } from "../encounter/EncounterPanel";
import { useTargeting } from "../encounter/targeting";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { MapSelection } from "../maps/MapManager";
import { ReplayShelf } from "../replay/ReplayShelf";
import { EncounterMap } from "../scene/EncounterMap";
import { SceneBuilder } from "../scenes/SceneBuilder";
import { navigate, pathForGmTab } from "../router";
import { PartyRest } from "../rest/PartyRest";
import { ShortRestPrompt } from "../rest/ShortRestPrompt";
import { needsItems } from "../table/needs";
import { NeedsYou } from "../table/NeedsYou";
import { PaneDivider, useTableSplit } from "../table/PaneDivider";
import { PromptSlot } from "../table/PromptSlot";
import { TableHeader } from "../table/TableHeader";
import { TokenTab } from "../table/TokenTab";
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
  { token: string } & (
    { role: "gm"; state: GmView; gm: GmTable } | { role: "player"; state: PlayerView; onLeave: () => void }
  )
>;

/** The phone table, below 980px (the stylesheet's breakpoint): the map pane over the panel, a bar under the thumb. */
const PHONE_TABLE_QUERY = "(max-width: 979px)";
/** While a target is being chosen on a phone, the map pane takes at least this share of the height. */
const TARGETING_SHARE = 55;

/**
 * The table, for both roles: a docked workbench where nothing floats over the map but tokens and marks. A header bar
 * over the map holds the scene and the table's status; the map has its tools beside it; the panel holds what must be
 * answered, the tabs, and a footer with the view's one primary button. On a laptop the panel is a column on the right;
 * on a phone it sits under the map pane.
 */
export function TableView(props: TableViewProps) {
  const { role, state, token } = props;
  const gm = props.role === "gm" ? props.gm : null;
  const phone = useMediaQuery(PHONE_TABLE_QUERY);
  /**
   * Whether this player has claimed anyone, which decides between the pre-claim picker and their own
   * character. Read from the projection's `claimStatus`.
   */
  const playerHasClaimed =
    props.role === "player" &&
    props.state.actors.some((actor) => actor.kind === "player-character" && actor.claimStatus === "mine");
  const staged = gm?.stagedScene ?? null;
  // The phone's split between the map pane and the panel. Choosing a target lowers the divider so the map takes
  // most of the height; the person's own split comes back when the choice ends, unless they move it meanwhile.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const [split, setSplit] = useTableSplit();
  const targeting = useTargeting();
  const myId =
    props.role === "player" ? (props.state.actors.find((actor) => actor.claimStatus === "mine")?.id ?? null) : null;
  const choosing = phone && targeting !== null && (role === "gm" || targeting.attackerId === myId);
  const [movedWhileChoosing, setMovedWhileChoosing] = useState(false);
  useEffect(() => {
    if (!choosing) setMovedWhileChoosing(false);
  }, [choosing]);
  const mapShare = choosing && !movedWhileChoosing ? Math.max(split, TARGETING_SHARE) : split;
  const liveMapName = gm?.selectedMap?.id === state.combat.mapAssetId ? (gm?.selectedMap?.name ?? null) : null;

  const header =
    props.role === "gm" ? (
      <TableHeader
        role="gm"
        state={props.state}
        gm={{
          token,
          stagedScene: staged,
          liveMapName,
          onPrepareScene: props.gm.onPrepareScene,
          onViewAllScenes: props.gm.onViewAllScenes,
          onBackToLive: props.gm.onBackToLive,
          onMakeLive: props.gm.onMakeLive,
          viewerPreview: props.gm.viewerPreview
        }}
      />
    ) : (
      <TableHeader role="player" state={props.state} />
    );

  const map = staged ? (
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
      vision={staged.combat.vision}
      moveSceneId={staged.id}
      healthDisplay={staged.combat.healthDisplay}
      state={state}
    />
  ) : state.combat.mapAssetId ? (
    <EncounterMap
      assetId={state.combat.mapAssetId}
      token={token}
      altText={liveMapName ?? "Battle map"}
      role={role}
      actors={state.actors}
      tokens={state.combat.tokens}
      annotations={state.combat.annotations}
      revision={state.revision}
      activeActorId={state.combat.turnActorId}
      reactionsUsed={state.combat.reactionsUsed}
      fog={state.combat.fog}
      terrain={state.combat.terrain}
      vision={state.combat.vision}
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
          ? "Prepare a scene from the Scenes tab. Pick a map and who's in it, then make it live."
          : "The map appears here when the GM makes a scene live."}
      </span>
      {gm && (
        <Button variant="secondary" className="empty-scene-prep" onClick={gm.onPrepareScene}>
          <IconScene /> Prepare a scene
        </Button>
      )}
    </div>
  );

  const dice = <DicePanel role={role} state={state} />;
  const log = <CombatLogPanel />;
  let panel;
  if (props.role === "gm") {
    panel = staged ? (
      <section className="table-panel table-panel-staging scroll-y" aria-label={`Staging ${staged.name}`}>
        <SceneBuilder
          scene={staged}
          actors={props.state.actors}
          revision={state.revision}
          stagingDefaults={props.state.stagingDefaults}
        />
      </section>
    ) : (
      <EncounterPanel
        role="gm"
        state={props.state}
        selectedMap={props.gm.selectedMap}
        mapLibrary={props.gm.mapLibrary}
        onSelectMap={props.gm.onSelectMap}
        phone={phone}
        slots={{
          needs: <NeedsYou state={props.state} token={token} />,
          needsCount: needsItems(props.state).length,
          dice,
          log,
          token: <TokenTab state={props.state} token={token} />,
          party: <PartyStrip role="gm" state={props.state} onOpenRoster={() => navigate(pathForGmTab("roster"))} />,
          rest: <PartyRest state={props.state} />
        }}
      />
    );
  } else if (!playerHasClaimed) {
    // A player who has claimed nobody gets the picker where their panel would be.
    panel = (
      <section className="table-panel table-panel-claim" aria-label="Choose your character">
        <ClaimCharacter state={props.state} />
        <Button variant="secondary" className="table-leave" onClick={props.onLeave}>
          Leave table
        </Button>
      </section>
    );
  } else {
    panel = (
      <EncounterPanel
        role="player"
        state={props.state}
        phone={phone}
        slots={{
          top: (
            <>
              {/* The party's Short Rest on this player's own device: their Hit Dice to spend, and Done. */}
              <ShortRestPrompt state={props.state} />
              <PromptSlot state={props.state} />
            </>
          ),
          dice,
          log,
          // The party is a party surface, so the `off` tier removes it for players.
          ...(partyVisibilityOf(props.state) !== "off"
            ? { party: <PartyStrip role="player" state={props.state} /> }
            : {}),
          sheetFooter: (
            <div className="table-sheet-foot">
              {/* The fights the GM shared. Renders nothing when nothing is shared. */}
              {!state.combat.active && (
                <ReplayShelf token={token} onOpen={(archiveId) => navigate(`/replays/${archiveId}`)} />
              )}
              <Button variant="secondary" className="table-leave" onClick={props.onLeave}>
                Leave table
              </Button>
            </div>
          )
        }}
      />
    );
  }

  return (
    <div className={`table-bench anim-view ${role}${staged ? " is-staging" : ""}`}>
      {header}
      <div
        className="table-bench-split"
        ref={splitRef}
        style={phone ? ({ "--map-share": `${mapShare}%` } as React.CSSProperties) : undefined}
      >
        <div className="table-bench-map">{map}</div>
        {phone && (
          <PaneDivider
            value={mapShare}
            onChange={(next) => {
              setSplit(next);
              if (choosing) setMovedWhileChoosing(true);
            }}
            container={() => splitRef.current}
          />
        )}
        <div className="table-bench-panel">{panel}</div>
      </div>
    </div>
  );
}
