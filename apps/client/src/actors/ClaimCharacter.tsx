import { useState } from "react";
import type { PlayerView } from "@vtt/domain";
import { Avatar, Badge, Button, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { PdfImportModal } from "./PdfImportModal";
import { CLAIM_WORD, claimStateOf } from "./actor-display";
import { newId } from "../lib/ids";
import { socket } from "../socket";

/**
 * **Choose your character (B4.2)** — what a player sees at the table before they have claimed anyone.
 *
 * This is the half of the old shell roster that was legitimately load-bearing: removing the roster from
 * every screen must not strand a player who has not claimed yet. So it moves here, onto the table, and
 * only for the pre-claim state — once you are playing someone, the table is your character's, not a
 * picker's.
 *
 * **Projection honesty.** A player's projection carries no definition for a character they do not own
 * (`projections.ts` — `PlayerActor.definition` is owner-only), so a card shows portrait, name and claim
 * state and nothing else. Class · level would be a guess, and a guess about someone else's sheet is
 * exactly the sort of thing the projection boundary exists to refuse.
 */
export function ClaimCharacter({ state }: Readonly<{ state: PlayerView }>) {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  // Archived characters never reach a player projection at all, so this is every character the table has.
  const characters = state.actors.filter((actor) => actor.kind === "player-character");

  const claim = async (actorId: string, name: string) => {
    if (!(await confirm({ title: `Claim ${name}?`, body: "You'll play them at this table until you release them.", confirmLabel: "Claim" }))) return;
    setClaiming(actorId);
    socket.emit("character:claim", { commandId: newId(), actorId, expectedRevision: state.revision }, (result) => {
      setClaiming(null);
      if (result.ok) toast(`You're playing ${name}.`, { tone: "success" });
      else toast(result.message ?? `Couldn't claim ${name} — someone may have claimed them first.`, { tone: "error" });
    });
  };

  return <section className="claim-view" aria-labelledby="claim-heading">
    <div className="claim-heading">
      <h2 id="claim-heading">Choose your character</h2>
      <p>Pick who you'll play at the table.</p>
    </div>
    {characters.length === 0
      ? <div className="nh-empty">
          <span className="nh-empty-title">Nothing to claim yet</span>
          <span className="nh-empty-text">Your GM is setting up the party. You can send them a character sheet in the meantime.</span>
        </div>
      : <ul className="claim-grid">
        {characters.map((actor) => {
          const claimState = claimStateOf(actor);
          const taken = claimState === "claimed";
          return <li key={actor.id} className="claim-card">
            <Avatar name={actor.name} size="lg" />
            <h3 className="claim-card-name">{actor.name}</h3>
            <Badge tone={taken ? "info" : "neutral"}>{CLAIM_WORD[claimState]}</Badge>
            <Button
              variant="primary"
              block
              className="claim-card-action"
              disabled={taken || claiming !== null}
              onClick={() => claim(actor.id, actor.name)}
            >{claiming === actor.id ? "Claiming…" : taken ? "Claimed" : "Claim"}</Button>
          </li>;
        })}
      </ul>}
    <div className="claim-actions">
      <Button variant="ghost" onClick={() => setPdfImportOpen(true)}>Import from D&amp;D Beyond (PDF)</Button>
    </div>
    <PdfImportModal
      open={pdfImportOpen}
      role="player"
      onClose={() => setPdfImportOpen(false)}
      onImported={() => toast("Sent to your GM for approval.", { tone: "success" })}
    />
    {dialog}
  </section>;
}
