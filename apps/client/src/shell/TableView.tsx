import { useState } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { EmptyState } from "@vtt/ui";
import { ClaimCharacter } from "../actors/ClaimCharacter";
import { JoinAddress } from "../components/JoinAddress";
import { Lobby } from "../table/Lobby";
import { partyVisibilityOf } from "../actors/MyCharacter";
import { PartyStrip } from "../actors/PartyStrip";
import { DicePanel } from "../dice/DicePanel";
import { CombatLogPanel } from "../encounter/CombatLog";
import { EncounterPanel } from "../encounter/EncounterPanel";
import { lazySurface } from "../components/lazySurface";
import { useMediaQuery } from "../lib/useMediaQuery";
import type { MapSelection } from "../maps/map-catalog";
import { ReplayShelf } from "../replay/ReplayShelf";
import { EncounterMap } from "../scene/EncounterMap";
import { navigate, pathForGmTab } from "../router";
import { PartyRest } from "../rest/PartyRest";
import { RestPrompt } from "../rest/RestPrompt";
import { owedItems } from "../table/needs";
import { NeedsYou } from "../table/NeedsYou";
import { PromptSlot } from "../table/PromptSlot";
import { StripEndContext } from "../table/stripSlot";
import { TableStrip } from "../table/TableStrip";
import { DockToolsTarget } from "../table/dockTools";
import { PhoneSwitch } from "../table/phoneSwitch";
import { LadderCards } from "../table/TurnLadder";
import { TableDock } from "../table/TableDock";
import { NowPlaying } from "../sound/NowPlaying";
import { TokenTab } from "../table/TokenTab";
import { useCodexNotice } from "../table/useCodexNotice";
import "./table-view.css";

// The Codex's two table tabs load on first use, like the Codex itself, so the table's first paint stays small.
const TonightTab = lazySurface(() => import("../table/TonightTab").then((m) => m.TonightTab), "Tonight tab", null);
const CodexTab = lazySurface(() => import("../table/CodexTab").then((m) => m.CodexTab), "Codex tab", null);

/** What only the GM's table has: the map choice and the shared-screen preview. Scenes are prepared on the Scenes tab. */
export type GmTable = Readonly<{
  selectedMap: MapSelection | null;
  mapLibrary: readonly MapSelection[];
  onSelectMap: (map: MapSelection | null) => void;
  /** Makes a prepared scene live, asked first while a fight is on: Tonight's board names its fights' scenes. */
  onMakeLive: (encounterId: string) => void;
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
  // The dock's tools row, where the map renders its tools on a laptop (table spec 2.1).
  const [dockTools, setDockTools] = useState<HTMLElement | null>(null);
  // The strip's right end, where the GM's Fight menu lands during a fight.
  const [stripEnd, setStripEnd] = useState<HTMLElement | null>(null);
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
  const liveMapName = gm?.selectedMap?.id === state.combat.mapAssetId ? (gm?.selectedMap?.name ?? null) : null;
  // A player hears, in the status line, when the Codex gives them something new.
  useCodexNotice(role === "player" ? token : null);
  const party = state.actors
    .filter((actor) => actor.kind === "player-character" && !("archived" in actor && actor.archived))
    .map((actor) => ({ id: actor.id, name: actor.name }));

  // A laptop's table is Two docks (table spec 2.1): the dock with the order, the map, the panel. A phone keeps the
  // strip as its header, and the panel is the Switch (table spec 2.4) with the map as its Map view.
  const header = !phone ? (
    props.role === "gm" ? (
      <TableDock role="gm" state={props.state} token={token} toolsRef={setDockTools} />
    ) : (
      <TableDock role="player" state={props.state} token={token} toolsRef={setDockTools} />
    )
  ) : props.role === "gm" ? (
    <TableStrip role="gm" state={props.state} token={token} endRef={setStripEnd} />
  ) : (
    <TableStrip role="player" state={props.state} token={token} />
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
  ) : claimingOnly ? null : gm && props.role === "gm" ? (
    /* No map yet: the GM's empty table is the lobby (arrival spec 2.4). */
    <Lobby state={props.state} token={token} />
  ) : (
    <EmptyState>The map appears here when the GM makes an encounter live.</EmptyState>
  );

  const dice = <DicePanel role={role} state={state} />;
  // The GM may remove any chat line; a player, what their own characters said.
  const myCharacters = new Set(
    role === "gm"
      ? []
      : state.actors.filter((actor) => "claimStatus" in actor && actor.claimStatus === "mine").map((a) => a.id)
  );
  const log = (
    <CombatLogPanel
      canRemove={(entry) =>
        entry.kind === "chat" &&
        (role === "gm" || (entry.author?.role === "player" && myCharacters.has(entry.author.actorId ?? "")))
      }
    />
  );
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
        token={token}
        slots={{
          // On a laptop the Encounter tab's head holds what the strip did: the sound and, before a fight on a live
          // map, the join address (the Encounter menu joins them during a fight).
          head: phone ? undefined : (
            <>
              <NowPlaying token={token} compact />
              {!state.combat.active && state.combat.mapAssetId && <JoinAddress token={token} layout="row" />}
            </>
          ),
          needs: <NeedsYou state={props.state} token={token} />,
          waiting: <NeedsYou state={props.state} token={token} alone />,
          needsCount: owedItems(props.state).length,
          dice,
          log,
          token: <TokenTab state={props.state} token={token} />,
          party: <PartyStrip role="gm" state={props.state} onOpenRoster={() => navigate(pathForGmTab("roster"))} />,
          rest: <PartyRest state={props.state} token={token} />,
          tonight: (
            <TonightTab
              token={token}
              party={party}
              scenes={props.state.combat.encounters}
              liveSceneId={props.state.combat.activeEncounterId}
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
        slots={{
          top: (
            <>
              {/* The party's Short Rest on this player's own device: their Hit Dice to spend, and Done. */}
              <RestPrompt state={props.state} />
              {/* With no map live the prompt has no map to sit over, so it leads the panel. */}
              {!map && <PromptSlot state={props.state} />}
            </>
          ),
          // On a phone the prompt sits on glass at the foot of whichever Switch view is open (C4 spec 2.1).
          ...(map && phone ? { overlay: <PromptSlot state={props.state} /> } : {}),
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
                <ReplayShelf
                  token={token}
                  onOpen={(archiveId) => navigate(`/replays/${archiveId}`)}
                  onAll={() => navigate("/replays")}
                />
              )}
            </div>
          )
        }}
      />
    );
  }

  // A phone's panel is the Switch once a character is claimed (or for the GM): the map is its Map view, and the turn
  // order's cards sit under the Switch.
  const switching = phone && (role === "gm" || playerHasClaimed);
  const ladder =
    props.role === "gm" ? (
      <LadderCards role="gm" state={props.state} token={token} />
    ) : (
      <LadderCards role="player" state={props.state} token={token} />
    );
  const switchParts = switching && map ? { map: <div className="table-bench-map is-view">{map}</div>, ladder } : null;
  // With no map live the picker is the whole table, beside the title screen's sunset.
  if (claimingOnly && props.role === "player")
    return (
      <div className="table-claim anim-view">
        <ClaimCharacter state={props.state} art />
      </div>
    );
  return (
    <div className={`table-bench anim-view ${role}${claimingOnly ? " is-claiming" : ""}`}>
      {header}
      <div className="table-bench-split">
        {map && !switching && (
          <div className="table-bench-map">
            <DockToolsTarget.Provider value={dockTools}>{map}</DockToolsTarget.Provider>
            {/* A player's prompt sits on glass at the map's foot; the map pans under it (C4 spec 2.1). */}
            {props.role === "player" && !phone && (
              <div className="prompt-glass">
                <PromptSlot state={props.state} />
              </div>
            )}
          </div>
        )}
        <div className="table-bench-panel">
          <PhoneSwitch.Provider value={switchParts}>
            <StripEndContext.Provider value={stripEnd}>{panel}</StripEndContext.Provider>
          </PhoneSwitch.Provider>
        </div>
      </div>
    </div>
  );
}
