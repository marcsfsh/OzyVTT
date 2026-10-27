import { useState } from "react";
import { rosterActors, type PlayerActor, type PlayerView } from "@vtt/domain";
import { Alert, Badge, Button, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { PdfImportModal } from "./PdfImportModal";
import { CLAIM_WORD, claimStateOf } from "./actor-display";
import { command } from "../lib/command";
import { noteClaimReleased, useClaimReleased } from "../lib/claim-notice";
import { navigate } from "../router";
import "./claim-character.css";
import { ActorAvatar } from "./ActorAvatar";

/**
 * "Dwarf Fighter 7 · HP 74": who a character is, from what the projection gives an unclaimed character (its species
 * and class line, and a player character's exact hit points). Parts the sheet doesn't record are left out.
 */
export function pickLine(actor: PlayerActor): string {
  const who = [actor.species, actor.classLine].filter(Boolean).join(" ");
  const hp = actor.hp.kind === "exact" ? `HP ${actor.hp.maximum}` : null;
  return [who, hp].filter(Boolean).join(" · ");
}

/**
 * The table view for a player who has not claimed a character yet: each character with who they are, and Claim.
 * A character claimed on another device says so, with what to do. After a claim the player lands on My character.
 */
export function ClaimCharacter({ state }: Readonly<{ state: PlayerView }>) {
  const [claiming, setClaiming] = useState<string | null>(null);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();
  const released = useClaimReleased();
  // Excludes a launched replay's clones: they are unowned and would look claimable. The server
  // refuses such a claim anyway (character-claims.ts).
  const characters = rosterActors(state.actors).filter((actor) => actor.kind === "player-character");

  const claim = async (actorId: string, name: string) => {
    if (
      !(await confirm({
        title: `Claim ${name}?`,
        body: `You play ${name} at this table until you release ${name}.`,
        confirmLabel: "Claim"
      }))
    )
      return;
    setClaiming(actorId);
    const result = await command("character:claim", { actorId, expectedRevision: state.revision });
    setClaiming(null);
    if (result.ok) {
      noteClaimReleased(null);
      toast(`You're playing ${name}.`, { tone: "success" });
      navigate("/me");
    } else
      toast(result.message ?? `Couldn't claim ${name}. Someone may have claimed ${name} first.`, { tone: "error" });
  };

  /* A scroll region at every width, so the picker never pushes the map down its column. */
  return (
    <section className="claim-view scroll-y" aria-labelledby="claim-heading">
      <div className="claim-heading">
        <h2 id="claim-heading">Choose your character</h2>
        <p>Pick who you'll play at the table.</p>
      </div>
      {released && (
        <Alert tone="info" title={`The GM released ${released.name}`}>
          Choose a character to keep playing.
        </Alert>
      )}
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
            const line = pickLine(actor);
            return (
              <li key={actor.id} className={`claim-card${taken ? " is-taken" : ""}`}>
                <ActorAvatar actor={actor} name={actor.name} size="lg" />
                <div className="claim-card-text">
                  <h3 className="claim-card-name">{actor.name}</h3>
                  {line && <span className="claim-card-line">{line}</span>}
                </div>
                {taken ? (
                  <>
                    <Badge tone="info">{CLAIM_WORD[claimState]}</Badge>
                    <p className="claim-card-taken">Claimed on another device. Ask the GM to release it.</p>
                  </>
                ) : (
                  // Secondary: every card has one, and a view has at most one primary.
                  <Button
                    variant="secondary"
                    block
                    className="claim-card-action"
                    aria-label={`Claim ${actor.name}`}
                    disabled={claiming !== null}
                    onClick={() => claim(actor.id, actor.name)}
                  >
                    {claiming === actor.id ? "Claiming…" : "Claim"}
                  </Button>
                )}
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
