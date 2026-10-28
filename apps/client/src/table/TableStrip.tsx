import { useState, type ReactNode } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { Button, IconLocate, Modal, ToastOutlet, VcrCounter } from "@vtt/ui";
import { JoinAddress } from "../components/JoinAddress";
import { focusTokenOnMap } from "../scene/tableGeometry";
import { NowPlaying } from "../sound/NowPlaying";
import { LiveScenePicker } from "./LiveScenePicker";
import { TurnTiles } from "./TurnTiles";
import { idleStatus } from "./status";
import "./table-strip.css";

type StripProps = Readonly<{
  phone: boolean;
  token: string;
  /** Where the GM's Fight menu lands during a fight. */
  endRef?: (node: HTMLElement | null) => void;
}> &
  Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>;

/**
 * The strip above the map: the VCR counter, then what the table is doing. Before a fight that is "No fight running"
 * with who is on the map and, for the GM, the join address; in a fight, the turn order and the GM's Fight menu. The
 * newest notice shows in the strip, so a toast never floats over the map. On a GM's phone the strip is Play's
 * header, with the live scene picker and Join, and the turn order as its second row.
 */
export function TableStrip(props: StripProps) {
  const { state, phone } = props;
  const fighting = state.combat.active;
  const view =
    props.role === "gm" ? { role: "gm" as const, state: props.state } : { role: "player" as const, state: props.state };
  const idle = idleStatus(view);
  const status: ReactNode = (
    <>
      <b>{idle.lead}</b> {idle.detail}
    </>
  );
  const counter = <VcrCounter round={fighting ? state.combat.round : null} className="table-strip-counter" />;
  const tiles =
    props.role === "gm" ? (
      <TurnTiles role="gm" state={props.state} token={props.token} />
    ) : (
      <TurnTiles role="player" state={props.state} token={null} />
    );
  const end = <div className="table-strip-end" ref={props.endRef} />;

  if (props.role === "gm" && phone)
    return (
      <header className={`table-strip is-header${fighting ? " is-fighting" : ""}`} aria-label="The table">
        <div className="table-strip-row">
          {counter}
          <LiveScenePicker state={props.state} compact />
          <NowPlaying token={props.token} compact />
          {!fighting && <JoinButton token={props.token} />}
          {end}
        </div>
        {fighting && <div className="table-strip-row is-tiles">{tiles}</div>}
      </header>
    );
  if (fighting)
    return (
      <header className="table-strip is-fighting" aria-label="The table">
        {counter}
        <span className="table-strip-divider" aria-hidden="true" />
        {tiles}
        {/* Notices land here during a fight, so a toast never floats over the map. */}
        <ToastOutlet className="table-strip-notice" />
        {props.role === "gm" && <NowPlaying token={props.token} compact />}
        {props.role === "player" && <MeButton state={props.state} />}
        {end}
      </header>
    );
  return (
    <header className="table-strip" aria-label="The table">
      {counter}
      <span className="table-strip-divider" aria-hidden="true" />
      <p className="table-status">
        <ToastOutlet fallback={status} />
      </p>
      {props.role === "gm" ? (
        <>
          {/* With no map the empty table shows the join address large, with its QR code. */}
          {!fighting && state.combat.mapAssetId && <JoinAddress token={props.token} layout="strip" />}
          <NowPlaying token={props.token} compact />
        </>
      ) : (
        <MeButton state={props.state} />
      )}
      {end}
    </header>
  );
}

/** A player's Me: brings their own token into view once it is on the map. */
function MeButton({ state }: Readonly<{ state: PlayerView }>) {
  const mine = state.actors.find((actor) => actor.claimStatus === "mine");
  const placed = mine && state.combat.tokens.some((entry) => entry.actorId === mine.id && entry.position);
  if (!mine || !placed) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      className="table-strip-me"
      title="Bring your token into view"
      onClick={() => focusTokenOnMap(mine.id)}
    >
      <IconLocate />
      Me
    </Button>
  );
}

/** The phone's Join: the join address, its Copy and QR code, in a sheet under the thumb. */
function JoinButton({ token }: Readonly<{ token: string }>) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" className="table-strip-join" onClick={() => setOpen(true)}>
        Join
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Join the table" align="bottom">
        <JoinAddress token={token} layout="row" />
      </Modal>
    </>
  );
}
