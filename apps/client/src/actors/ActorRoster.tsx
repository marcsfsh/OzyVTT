import { useState } from "react";
import type { GmView, PlayerActor, PlayerView, PresenceStatus } from "@vtt/domain";
import { useConfirm } from "../components/feedback";
import { socket } from "../socket";

type Props = { role: "gm"; state: GmView } | { role: "player"; state: PlayerView };

function statusForGm(ownerSessionId: string | null) { return ownerSessionId ? "Claimed" : "Available"; }
function statusForPlayer(actor: PlayerActor) { return actor.claimStatus === "mine" ? "Your character" : actor.claimStatus === "claimed" ? "Taken" : "Available"; }
function presenceLabel(presence: PresenceStatus) { return presence === "online" ? "Online" : presence === "reconnecting" ? "Reconnecting" : "Offline"; }

export function ActorRoster(props: Props) {
  const [feedback, setFeedback] = useState("");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const { confirm, dialog } = useConfirm();
  const actors = props.state.actors.filter((actor) => actor.kind === "player-character");
  const ownedActor = props.role === "player" ? actors.find((actor) => "claimStatus" in actor && actor.claimStatus === "mine") ?? null : null;
  const busy = claiming !== null || releasing;

  const claim = (actorId: string, name: string) => {
    setClaiming(actorId);
    setFeedback(`Claiming ${name}…`);
    socket.emit("character:claim", { commandId: crypto.randomUUID(), actorId, expectedRevision: props.state.revision }, (result) => {
      setClaiming(null);
      setFeedback(result.ok ? `You're playing ${name}.` : result.message ?? `Couldn't claim ${name} — someone may have taken it first.`);
    });
  };

  // The server rejects claiming a second character, so switching is release-then-claim.
  // expectedRevision is omitted on the chained commands since the revision advances mid-switch.
  const switchTo = async (actorId: string, name: string, fromName: string) => {
    if (!(await confirm({ title: `Switch to ${name}?`, body: `You'll leave ${fromName} and play ${name} instead.`, confirmLabel: `Play ${name}` }))) return;
    setClaiming(actorId);
    setFeedback(`Switching to ${name}…`);
    socket.emit("character:release", { commandId: crypto.randomUUID() }, (released) => {
      if (!released.ok) { setClaiming(null); setFeedback(released.message ?? "Couldn't switch characters."); return; }
      socket.emit("character:claim", { commandId: crypto.randomUUID(), actorId }, (result) => {
        setClaiming(null);
        setFeedback(result.ok ? `You're playing ${name}.` : result.message ?? `Left ${fromName}, but ${name} was just taken. Pick another.`);
      });
    });
  };

  const release = async (name: string) => {
    if (!(await confirm({ title: `Leave ${name}?`, body: "You'll release this character so someone else can play it.", confirmLabel: "Leave character" }))) return;
    setReleasing(true);
    setFeedback(`Leaving ${name}…`);
    socket.emit("character:release", { commandId: crypto.randomUUID(), expectedRevision: props.state.revision }, (result) => {
      setReleasing(false);
      setFeedback(result.ok ? `You left ${name}. Pick another when you're ready.` : result.message ?? "Couldn't release the character.");
    });
  };

  const forceRelease = (actorId: string) => {
    setFeedback("Releasing player claim…");
    socket.emit("character:force-release", { commandId: crypto.randomUUID(), actorId, expectedRevision: props.state.revision }, (result) => {
      setFeedback(result.ok ? "Player claim released." : result.message ?? "The player claim could not be released.");
    });
  };

  return <section className="roster" aria-labelledby="roster-heading">
    <div className="roster-heading">
      <div><span className="eyebrow">CHARACTER ROSTER</span><h2 id="roster-heading">Choose your place at the table.</h2></div>
      <p>{props.role === "player" ? "Pick the character you'll play at the table." : "Claims update here live. Release a stale claim when someone changes devices."}</p>
    </div>
    {props.role === "player" && ownedActor && <div className="you-are-playing">
      <div><span className="eyebrow">YOU'RE PLAYING</span><strong>{ownedActor.name}</strong></div>
      <button className="secondary" disabled={busy} onClick={() => release(ownedActor.name)}>Leave character</button>
    </div>}
    {actors.length === 0 ? <p className="roster-empty">No characters have been added yet.</p> : <div className="actor-grid">
      {actors.map((actor) => {
        const playerActor = "claimStatus" in actor ? actor : null;
        const mine = playerActor?.claimStatus === "mine";
        const unavailable = playerActor?.claimStatus === "claimed";
        const status = "ownerSessionId" in actor ? statusForGm(actor.ownerSessionId) : statusForPlayer(actor);
        return <article className={`actor-card${mine ? " actor-card-owned" : ""}`} key={actor.id}>
          <div className="actor-card-title"><div className="actor-monogram" aria-hidden="true">{actor.name.slice(0, 1)}</div><div><h3>{actor.name}{mine && <span className="you-badge">YOU</span>}</h3><span className={`claim-status${mine ? " claim-status-owned" : ""}`}>{status}</span>{actor.presence && <span className={`presence presence-${actor.presence}`} role="status"><span className="presence-dot" aria-hidden="true"></span>{presenceLabel(actor.presence)}</span>}</div></div>
          <dl><div><dt>HP</dt><dd>{actor.hp.current}/{actor.hp.maximum}</dd></div><div><dt>AC</dt><dd>{actor.armorClass ?? "—"}</dd></div><div><dt>Initiative</dt><dd>{actor.initiative === undefined ? "—" : actor.initiative >= 0 ? `+${actor.initiative}` : actor.initiative}</dd></div></dl>
          {props.role === "player" && (mine
            ? <button className="actor-action actor-release" disabled={busy} onClick={() => release(actor.name)}>Release character</button>
            : <button className="actor-action" disabled={unavailable || busy} onClick={() => ownedActor ? switchTo(actor.id, actor.name, ownedActor.name) : claim(actor.id, actor.name)}>{claiming === actor.id ? (ownedActor ? "Switching…" : "Claiming…") : unavailable ? "Already claimed" : ownedActor ? "Switch to this" : "Claim character"}</button>)}
          {props.role === "gm" && "ownerSessionId" in actor && actor.ownerSessionId && <button className="actor-action actor-release" onClick={() => forceRelease(actor.id)}>Force release</button>}
        </article>;
      })}
    </div>}
    <p className="roster-feedback" aria-live="polite">{feedback}</p>
    {dialog}
  </section>;
}
