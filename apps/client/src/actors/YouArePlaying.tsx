import { useState } from "react";
import type { PlayerView } from "@vtt/domain";
import { Button, Eyebrow, Input, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { ConditionEditor } from "../encounter/conditions";
import { hpLabel } from "./actor-display";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/** Players track their own sheet: damage, healing, and temporary HP for the claimed character only. */
function OwnHpTracker({ actorId }: Readonly<{ actorId: string }>) {
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();
  const send = (event: "actor:apply-damage" | "actor:heal" | "actor:set-temp-hp", verb: string) => {
    const value = Number(amount.trim());
    const minimum = event === "actor:set-temp-hp" ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum || value > 1000) { toast(`Enter a whole number (${minimum}-1000).`, { tone: "error" }); return; }
    setSending(true);
    socket.emit(event, { commandId: newId(), actorId, amount: value }, (result: { ok: boolean; message?: string }) => {
      setSending(false);
      if (result.ok) { toast(`${verb} ${value}.`, { tone: "success" }); setAmount(""); }
      else toast(result.message ?? "The hit point change was rejected.", { tone: "error" });
    });
  };
  return <div className="own-hp-tracker" role="group" aria-label="Track your hit points">
    <Input type="number" min="0" max="1000" placeholder="0" aria-label="Hit point amount" value={amount} onChange={(event) => setAmount(event.target.value)} />
    <Button size="sm" variant="destructive" disabled={sending} onClick={() => send("actor:apply-damage", "Took")}>Damage</Button>
    <Button size="sm" disabled={sending} onClick={() => send("actor:heal", "Healed")}>Heal</Button>
    <Button size="sm" disabled={sending} onClick={() => send("actor:set-temp-hp", "Temp HP set to")}>Temp</Button>
  </div>;
}

/**
 * The player's own-character bar. It used to ride the app shell above every tab, below a full-size
 * roster; it now leads the player's **table**, which is the only place it means anything (D15/D32).
 *
 * Inline HP tracking + a labelled Conditions editor; "View sheet" opens the full sheet (rests, spell
 * slots, and inventory live there). Renders nothing until the player has claimed a character.
 */
export function YouArePlaying({ state }: Readonly<{ state: PlayerView }>) {
  const [releasing, setReleasing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const ownedActor = state.actors.find((actor) => actor.kind === "player-character" && actor.claimStatus === "mine") ?? null;
  if (!ownedActor) return null;
  const release = async (name: string) => {
    // D28's claim verbs: you RELEASE a character, you do not "leave" one.
    if (!(await confirm({ title: `Release ${name}?`, body: "Someone else will be able to play them.", confirmLabel: "Release" }))) return;
    setReleasing(true);
    socket.emit("character:release", { commandId: newId(), expectedRevision: state.revision }, (result) => {
      setReleasing(false);
      if (result.ok) toast(`You released ${name}. Pick another when you're ready.`, { tone: "success" });
      else toast(result.message ?? "Couldn't release the character.", { tone: "error" });
    });
  };
  return <section className="you-are-playing" aria-label={`Playing ${ownedActor.name}`}>
    <div className="you-are-playing-head">
      <Eyebrow className="you-are-playing-label">YOU'RE PLAYING</Eyebrow><strong>{ownedActor.name}</strong>
      <span className="own-hp" role="status">HP {hpLabel(ownedActor.hp)}</span>
    </div>
    <div className="you-are-playing-conditions">
      <span className="you-are-playing-cond-label">Conditions</span>
      <ConditionEditor actorId={ownedActor.id} conditions={ownedActor.conditions} onFeedback={(text) => toast(text)} />
    </div>
    <OwnHpTracker actorId={ownedActor.id} />
    <div className="you-are-playing-buttons">
      <Button variant="secondary" disabled={releasing} onClick={() => setSheetOpen(true)}>View sheet</Button>
      <Button variant="secondary" disabled={releasing} onClick={() => release(ownedActor.name)}>Release character</Button>
    </div>
    {sheetOpen && <CharacterSheet actor={ownedActor} role="player" state={state} onClose={() => setSheetOpen(false)} />}
    {dialog}
  </section>;
}
