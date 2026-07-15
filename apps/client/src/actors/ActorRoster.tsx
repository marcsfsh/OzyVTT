import { useState } from "react";
import type { GmView, PlayerActor, PlayerView } from "@vtt/domain";
import { socket } from "../socket";

type Props = { role: "gm"; state: GmView } | { role: "player"; state: PlayerView };

function statusForGm(ownerSessionId: string | null) { return ownerSessionId ? "Claimed" : "Available"; }
function statusForPlayer(actor: PlayerActor) { return actor.claimStatus === "mine" ? "Your character" : actor.claimStatus === "claimed" ? "Claimed" : "Available"; }

export function ActorRoster(props: Props) {
  const [feedback, setFeedback] = useState("");
  const actors = props.state.actors.filter((actor) => actor.kind === "player-character");

  const claim = (actorId: string) => {
    setFeedback("Claiming character…");
    socket.emit("character:claim", { commandId: crypto.randomUUID(), actorId, expectedRevision: props.state.revision }, (result) => {
      setFeedback(result.ok ? "Character claimed." : result.message ?? "The character could not be claimed.");
    });
  };

  const release = () => {
    setFeedback("Releasing character…");
    socket.emit("character:release", { commandId: crypto.randomUUID(), expectedRevision: props.state.revision }, (result) => {
      setFeedback(result.ok ? "Character released." : result.message ?? "The character could not be released.");
    });
  };

  return <section className="roster" aria-labelledby="roster-heading">
    <div className="roster-heading">
      <div><span className="eyebrow">CHARACTER ROSTER</span><h2 id="roster-heading">Choose your place at the table.</h2></div>
      <p>{props.role === "player" ? "One character per player for this testing milestone." : "Player claims update here in real time. GM force-release is the next control."}</p>
    </div>
    {actors.length === 0 ? <p className="roster-empty">No player characters are available yet.</p> : <div className="actor-grid">
      {actors.map((actor) => {
        const playerActor = "claimStatus" in actor ? actor : null;
        const mine = playerActor?.claimStatus === "mine";
        const unavailable = playerActor?.claimStatus === "claimed";
        const status = "ownerSessionId" in actor ? statusForGm(actor.ownerSessionId) : statusForPlayer(actor);
        return <article className={`actor-card${mine ? " actor-card-owned" : ""}`} key={actor.id}>
          <div className="actor-card-title"><div className="actor-monogram" aria-hidden="true">{actor.name.slice(0, 1)}</div><div><h3>{actor.name}</h3><span className={`claim-status${mine ? " claim-status-owned" : ""}`}>{status}</span></div></div>
          <dl><div><dt>HP</dt><dd>{actor.hp.current}/{actor.hp.maximum}</dd></div><div><dt>AC</dt><dd>{actor.armorClass ?? "—"}</dd></div><div><dt>Initiative</dt><dd>{actor.initiative === undefined ? "—" : actor.initiative >= 0 ? `+${actor.initiative}` : actor.initiative}</dd></div></dl>
          {props.role === "player" && (mine ? <button className="actor-action actor-release" onClick={release}>Release character</button> : <button className="actor-action" disabled={unavailable} onClick={() => claim(actor.id)}>{unavailable ? "Already claimed" : "Claim character"}</button>)}
        </article>;
      })}
    </div>}
    <p className="roster-feedback" aria-live="polite">{feedback}</p>
  </section>;
}
