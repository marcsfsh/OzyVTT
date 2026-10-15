import { useState } from "react";
import { rosterActors, type PlayerView } from "@vtt/domain";
import { Avatar, Badge, Button, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { PdfImportModal } from "./PdfImportModal";
import { CLAIM_WORD, claimStateOf } from "./actor-display";
import { command } from "../lib/command";

/**
 * The table view for a player who has not claimed a character yet.
 * A player's projection carries no definition for characters they do not own, so a card shows only
 * portrait, name and claim state.
 */
export function ClaimCharacter({ state }: Readonly<{ state: PlayerView }>) {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  // Excludes a launched replay's clones: they are unowned and would look claimable. The server
  // refuses such a claim anyway (character-claims.ts).
  const characters = rosterActors(state.actors).filter((actor) => actor.kind === "player-character");

  const claim = async (actorId: string, name: string) => {
    if (
      !(await confirm({
        title: `Claim ${name}?`,
        body: "You'll play them at this table until you release them.",
        confirmLabel: "Claim"
      }))
    )
      return;
    setClaiming(actorId);
    const result = await command("character:claim", { actorId, expectedRevision: state.revision });
    setClaiming(null);
    if (result.ok) toast(`You're playing ${name}.`, { tone: "success" });
    else toast(result.message ?? `Couldn't claim ${name} — someone may have claimed them first.`, { tone: "error" });
  };

  /* A scroll region at every width, so the picker never pushes the map down its column. */
  return (
    <section className="claim-view scroll-y" aria-labelledby="claim-heading">
      <div className="claim-heading">
        <h2 id="claim-heading">Choose your character</h2>
        <p>Pick who you'll play at the table.</p>
      </div>
      {characters.length === 0 ? (
        <div className="nh-empty">
          <span className="nh-empty-title">Nothing to claim yet</span>
          <span className="nh-empty-text">
            Your GM is setting up the party. You can send them a character sheet in the meantime.
          </span>
        </div>
      ) : (
        <ul className="claim-grid">
          {characters.map((actor) => {
            const claimState = claimStateOf(actor);
            const taken = claimState === "claimed";
            return (
              <li key={actor.id} className="claim-card">
                <Avatar name={actor.name} size="lg" />
                <h3 className="claim-card-name">{actor.name}</h3>
                <Badge tone={taken ? "info" : "neutral"}>{CLAIM_WORD[claimState]}</Badge>
                <Button
                  variant="primary"
                  block
                  className="claim-card-action"
                  disabled={taken || claiming !== null}
                  onClick={() => claim(actor.id, actor.name)}
                >
                  {claiming === actor.id ? "Claiming…" : taken ? "Claimed" : "Claim"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="claim-actions">
        <Button variant="ghost" onClick={() => setPdfImportOpen(true)}>
          Import from D&amp;D Beyond (PDF)
        </Button>
      </div>
      <PdfImportModal
        open={pdfImportOpen}
        role="player"
        onClose={() => setPdfImportOpen(false)}
        onImported={() => toast("Sent to your GM for approval.", { tone: "success" })}
      />
      {dialog}
    </section>
  );
}
