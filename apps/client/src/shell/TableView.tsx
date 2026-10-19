import { useRef, useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { Button, IconScene } from "@vtt/ui";
import { ClaimCharacter } from "../actors/ClaimCharacter";
import { JoinAddress } from "../components/JoinAddress";
import { partyVisibilityOf } from "../actors/MyCharacter";
import { PartyStrip } from "../actors/PartyStrip";
import { DicePanel } from "../dice/DicePanel";
import { CombatLogPanel } from "../encounter/CombatLog";
import { EncounterPanel } from "../encounter/EncounterPanel";
import { useTargeting } from "../encounter/targeting";
import { lazySurface } from "../components/lazySurface";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { MapSelection } from "../maps/map-catalog";
import { ReplayShelf } from "../replay/ReplayShelf";
import { EncounterMap } from "../scene/EncounterMap";
import { navigate, pathForGmTab } from "../router";
import { SCENES_PATHS } from "../scenes/routes";
import { PartyRest } from "../rest/PartyRest";
import { RestPrompt } from "../rest/RestPrompt";
import { needsItems } from "../table/needs";
import { NeedsYou } from "../table/NeedsYou";
import { PaneDivider, useMomentShare } from "../table/PaneDivider";
import { PromptSlot } from "../table/PromptSlot";
import { TableHeader } from "../table/TableHeader";
import { TokenTab } from "../table/TokenTab";
import { useCodexNotice } from "../table/useCodexNotice";
import "./table-view.css";

// The Codex's two table tabs load on first use, like the Codex itself, so the table's first paint stays small.
const TonightTab = lazySurface(() => import("../table/TonightTab").then((m) => m.TonightTab), null);
const CodexTab = lazySurface(() => import("../table/CodexTab").then((m) => m.CodexTab), null);

/** What only the GM's table has: the map choice and the shared-screen preview. Scenes are prepared on the Scenes tab. */
export type GmTable = Readonly<{
  selectedMap: MapSelection | null;
  mapLibrary: readonly MapSelection[];
  onSelectMap: (map: MapSelection | null) => void;
  /** Makes a prepared scene live, asked first while a fight is on: Tonight's board names its fights' scenes. */
  onMakeLive: (sceneId: string) => void;
  viewerPreview: Readonly<{ on: boolean; onToggle: () => void }>;
}>;

// Leave table is in Settings, confirmed, away from the fight's controls.
type TableViewProps = Readonly<
  { token: string } & ({ role: "gm"; state: GmView; gm: GmTable } | { role: "player"; state: PlayerView })
>;

/** The phone table, below 980px (the stylesheet's breakpoint): the map pane over the panel, a bar under the thumb. */
const PHONE_TABLE_QUERY = "(max-width: 979px)";

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
  // A player who has claimed nobody while no map is live sees the picker across the whole table, never under an empty
  // map box.
  const claimingOnly = props.role === "player" && !playerHasClaimed && !state.combat.mapAssetId;
  // The phone's split between the map pane and the panel. Choosing a target lowers the divider so the map takes
  // most of the height, and the player's sheet raises it so the sheet does; the person's own split comes back after.
  const splitRef = useRef<HTMLDivElement | null>(null);
  const targeting = useTargeting();
  const myId =
    props.role === "player" ? (props.state.actors.find((actor) => actor.claimStatus === "mine")?.id ?? null) : null;
  const choosing = phone && targeting !== null && (role === "gm" || targeting.attackerId === myId);
  const [sheetShown, setSheetShown] = useState(false);
  const moment = choosing ? "choosing" : phone && sheetShown && playerHasClaimed ? "sheet" : null;
  const [mapShare, moveSplit] = useMomentShare(moment);
  const liveMapName = gm?.selectedMap?.id === state.combat.mapAssetId ? (gm?.selectedMap?.name ?? null) : null;
  // A player hears, in the status line, when the Codex gives them something new.
  useCodexNotice(role === "player" ? token : null);
  const party = state.actors
    .filter((actor) => actor.kind === "player-character" && !("archived" in actor && actor.archived))
    .map((actor) => ({ id: actor.id, name: actor.name }));

  const header =
    props.role === "gm" ? (
      <TableHeader role="gm" state={props.state} gm={{ token, liveMapName, viewerPreview: props.gm.viewerPreview }} />
    ) : (
      <TableHeader role="player" state={props.state} />
    );

  const map = state.combat.mapAssetId ? (
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
  ) : claimingOnly ? null : (
    /* No map yet. The GM's box is the first evening's start: the scene, and the address players open. */
    <div className={`empty map-empty-hero scanlines${gm ? " map-empty-hero--gm scroll-y" : ""}`}>
      <div className="empty-atmos" aria-hidden="true">
        <span className="home-hero-bloom" />
        <span className="home-hero-grid grid-floor" />
      </div>
      <strong>No map loaded yet</strong>
      <span>
        {role === "gm"
          ? "Prepare a scene: pick a map and who is in it, then make it live."
          : "The map appears here when the GM makes a scene live."}
      </span>
      {gm && (
        <Button variant="secondary" className="empty-scene-prep" onClick={() => navigate(SCENES_PATHS.newScene)}>
          <IconScene /> Prepare a scene
        </Button>
      )}
      {gm && <JoinAddress token={token} layout="hero" />}
    </div>
  );

  const dice = <DicePanel role={role} state={state} />;
  const log = <CombatLogPanel />;
  let panel;
  if (props.role === "gm") {
    panel = (
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
          rest: <PartyRest state={props.state} token={token} />,
          tonight: (
            <TonightTab
              token={token}
              party={party}
              scenes={props.state.combat.scenes}
              liveSceneId={props.state.combat.activeSceneId}
              onMakeLive={props.gm.onMakeLive}
            />
          ),
          codex: <CodexTab role="gm" token={token} party={party} />
        }}
      />
    );
  } else if (!playerHasClaimed) {
    // A player who has claimed nobody gets the picker where their panel would be.
    panel = (
      <section className="table-panel table-panel-claim" aria-label="Choose your character">
        <ClaimCharacter state={props.state} />
      </section>
    );
  } else {
    panel = (
      <EncounterPanel
        role="player"
        state={props.state}
        phone={phone}
        onSheetShown={setSheetShown}
        slots={{
          top: (
            <>
              {/* The party's Short Rest on this player's own device: their Hit Dice to spend, and Done. */}
              <RestPrompt state={props.state} />
              <PromptSlot state={props.state} />
            </>
          ),
          dice,
          log,
          codex: <CodexTab role="player" token={token} />,
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
            </div>
          )
        }}
      />
    );
  }

  return (
    <div className={`table-bench anim-view ${role}${claimingOnly ? " is-claiming" : ""}`}>
      {header}
      <div
        className="table-bench-split"
        ref={splitRef}
        style={phone ? ({ "--map-share": `${mapShare}%` } as React.CSSProperties) : undefined}
      >
        {map && <div className="table-bench-map">{map}</div>}
        {phone && map && <PaneDivider value={mapShare} onChange={moveSplit} container={() => splitRef.current} />}
        <div className="table-bench-panel">{panel}</div>
      </div>
    </div>
  );
}
