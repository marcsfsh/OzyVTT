import { useState, type ReactNode } from "react";
import type { GmView, PlayerView } from "@vtt/domain";
import { Button, Modal, ToastOutlet, VcrCounter } from "@vtt/ui";
import { JoinAddress } from "../components/JoinAddress";
import { NowPlaying } from "../sound/NowPlaying";
import { LiveScenePicker } from "./LiveScenePicker";
import { idleStatus } from "./status";
import "./table-strip.css";

type StripProps = Readonly<{
  token: string;
  /** Where the GM's Fight menu lands during a fight. */
  endRef?: (node: HTMLElement | null) => void;
}> &
  Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>;

/**
 * The table's header below 980px (table spec 2.4): the VCR counter, then for the GM the live scene picker, the sound,
 * Join before a fight and the Encounter menu during one; for a player the table's newest notice, or what it is doing
 * between fights. The turn order is the Switch's cards under it, so a notice never floats over the map.
 */
export function TableStrip(props: StripProps) {
  const { state } = props;
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
  return (
    <header className={`table-strip is-header${fighting ? " is-fighting" : ""}`} aria-label="The table" data-horizon="">
      <div className="table-strip-row">
        {counter}
        {props.role === "gm" ? (
          <>
            <LiveScenePicker state={props.state} compact />
            <NowPlaying token={props.token} compact />
            {!fighting && <JoinButton token={props.token} />}
            <div className="table-strip-end" ref={props.endRef} />
          </>
        ) : (
          /* During a fight the cards say who acts, so the line holds only the newest notice. */
          <p className="table-status">{fighting ? <ToastOutlet /> : <ToastOutlet fallback={status} />}</p>
        )}
      </div>
    </header>
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
