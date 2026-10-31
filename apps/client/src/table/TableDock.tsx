import { useRef } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { VcrCounter } from "@vtt/ui";
import { useOrderLight } from "./orderLight";
import { TurnLadder } from "./TurnLadder";
import { idleStatus } from "./status";
import "./table-dock.css";

type DockProps = Readonly<{
  token: string;
  /** The tools row, which the map fills with its tools through a portal. */
  toolsRef?: (node: HTMLElement | null) => void;
}> &
  Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>;

/**
 * The laptop table's left dock (table spec 2.1, ADR-0050): the round on the VCR counter at its head, the turn order as
 * a column that fills the dock and scrolls itself, and the map's tools under it. Before a fight it says what the table
 * is doing in one line under the head. The strip that crossed the map is gone: the encounter picker is the top bar's
 * live chip, and the Encounter menu, the sound and Join live in the Encounter tab.
 */
export function TableDock(props: DockProps) {
  const { state } = props;
  const fighting = state.combat.active;
  const dock = useRef<HTMLElement>(null);
  const row = (key: string) =>
    dock.current?.querySelector<HTMLElement>(`.turn-ladder > li[data-key="${CSS.escape(key)}"]`) ?? null;
  const hiddenTurn = props.role === "player" && props.state.combat.hiddenTurn;
  // The turn order's light runs down the order, from the round counter to the acting row (ADR-0045).
  useOrderLight(dock, {
    keys: fighting ? state.combat.initiative.map((entry) => entry.actorId) : [],
    acting: fighting && !hiddenTurn ? state.combat.turnActorId : null,
    round: fighting ? state.combat.round : null,
    item: row,
    point: (key) => row(key)?.querySelector<HTMLElement>(".ladder-face") ?? null,
    frame: (key) => row(key)?.querySelector<HTMLElement>(".nh-portrait") ?? null,
    counter: () => dock.current?.querySelector<HTMLElement>(".table-dock-counter") ?? null,
    axis: "y",
    rail: () => 1,
    lamps: true
  });
  const view =
    props.role === "gm" ? { role: "gm" as const, state: props.state } : { role: "player" as const, state: props.state };
  const idle = idleStatus(view);
  return (
    <aside ref={dock} className={`table-dock${fighting ? " is-fighting" : ""}`} aria-label="Turn order and tools">
      <div className="table-dock-head">
        <VcrCounter round={fighting ? state.combat.round : null} className="table-dock-counter" />
      </div>
      {!fighting && (
        <p className="table-dock-status">
          <b>{idle.lead}</b> {idle.detail}
        </p>
      )}
      <div className="table-dock-order scroll-y">
        {props.role === "gm" ? (
          <TurnLadder role="gm" state={props.state} token={props.token} />
        ) : (
          <TurnLadder role="player" state={props.state} token={null} />
        )}
      </div>
      <div className="table-dock-tools" ref={props.toolsRef} />
    </aside>
  );
}
