import { useState } from "react";
import { rosterActors, type PlayerActor, type PlayerView } from "@vtt/domain";
import { Alert, Button, IconUser, StatusLamp, Tag, Wordmark, useToast } from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { LandingScene } from "../shell/Landing";
import { PdfImportModal } from "./PdfImportModal";
import { CLAIM_WORD, claimStateOf } from "./actor-display";
import { command } from "../lib/command";
import { noteClaimReleased, useClaimReleased } from "../lib/claim-notice";
import { navigate } from "../router";
import "./claim-character.css";
import { ActorPortrait } from "./ActorPortrait";

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
 * The table view for a player who has not claimed a character yet: Pick your character lists each one with who they
 * are, one is chosen, and Play as claims it. A character claimed on another device says so, with what to do. After a
 * claim the player lands on My character. With `art`, the title screen's sunset stands beside the list (above it on a
 * phone), as the picker is then the whole screen.
 */
export function ClaimCharacter({ state, art = false }: Readonly<{ state: PlayerView; art?: boolean }>) {
  const [claiming, setClaiming] = useState(false);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [pdfImportOpen, setPdfImportOpen] = useState(false);
  const { toast } = useToast();
  const { confirm, dialog } = useConfirm();
  const released = useClaimReleased();
  // Excludes a launched replay's clones: they are unowned and would look claimable. The server
  // refuses such a claim anyway (character-claims.ts).
  const characters = rosterActors(state.actors).filter((actor) => actor.kind === "player-character");
  const open = characters.filter((actor) => claimStateOf(actor) !== "claimed");
  const claimedCount = characters.length - open.length;
  // One open character is chosen from the start, so Play as is one tap away.
  const chosen = open.find((actor) => actor.id === chosenId) ?? (open.length === 1 ? open[0] : undefined);
  const builderOpen = state.builderPolicy?.playerBuilder === "open";

  const claim = async (actorId: string, name: string) => {
    // Claiming binds the character to this device, so it is confirmed in the table's claim words.
    if (
      !(await confirm({
        title: `Claim ${name}?`,
        body: `You play ${name} at this table until you release ${name}.`,
        confirmLabel: "Claim"
      }))
    )
      return;
    setClaiming(true);
    const result = await command("character:claim", { actorId, expectedRevision: state.revision });
    setClaiming(false);
    if (result.ok) {
      noteClaimReleased(null);
      toast(`You're playing ${name}.`, { tone: "success" });
      navigate("/me");
    } else
      toast(result.message ?? `Couldn't claim ${name}. Someone may have claimed ${name} first.`, { tone: "error" });
  };

  const picker = (
    <section className="claim-view scroll-y" aria-labelledby="claim-heading">
      <div className="claim-heading">
        <h2 id="claim-heading">Pick your character</h2>
        {characters.length > 0 && (
          <p className="claim-status">
            <StatusLamp lit={claimedCount > 0} />
            {claimedCount === 0
              ? `Nobody has claimed a character yet.`
              : `${claimedCount} of ${characters.length} characters are claimed.`}
          </p>
        )}
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
        <ul className="claim-list" role="radiogroup" aria-labelledby="claim-heading">
          {characters.map((actor) => {
            const claimState = claimStateOf(actor);
            const taken = claimState === "claimed";
            const line = pickLine(actor);
            const on = chosen?.id === actor.id;
            return (
              <li key={actor.id} className={`claim-row${taken ? " is-taken" : ""}${on ? " is-chosen" : ""}`}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="claim-row-pick interactive"
                  disabled={taken || claiming}
                  onClick={() => setChosenId(actor.id)}
                >
                  <ActorPortrait actor={actor} frame="party" size="md" />
                  <span className="claim-row-text">
                    <b className="claim-row-name">{actor.name}</b>
                    {line && <span className="claim-row-line">{line}</span>}
                    {taken && (
                      <span className="claim-row-taken">Claimed on another device. Ask the GM to release it.</span>
                    )}
                  </span>
                  {taken ? (
                    <Tag tone="done" size="sm">
                      {CLAIM_WORD[claimState]}
                    </Tag>
                  ) : (
                    <span className="claim-row-tick" aria-hidden="true" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="claim-actions">
        {builderOpen && (
          <Button variant="secondary" onClick={() => navigate("/builder")}>
            <IconUser /> Make a new character
          </Button>
        )}
        <Button variant="ghost" onClick={() => setPdfImportOpen(true)}>
          Import from D&amp;D Beyond (PDF)
        </Button>
      </div>
      {open.length > 0 && (
        <Button
          variant="primary"
          block
          className="claim-play"
          disabled={!chosen || claiming}
          onClick={() => chosen && void claim(chosen.id, chosen.name)}
        >
          {claiming
            ? "Claiming…"
            : chosen
              ? `Play as ${chosen.name.split(/\s+/)[0] ?? chosen.name}`
              : "Pick a character to play"}
        </Button>
      )}
      <PdfImportModal
        open={pdfImportOpen}
        role="player"
        onClose={() => setPdfImportOpen(false)}
        onImported={() => toast("Sent to your GM for approval.", { tone: "success" })}
      />
      {dialog}
    </section>
  );
  if (!art) return picker;
  return (
    <div className="claim-screen">
      <div className="claim-art landing-scene-host" aria-hidden="true">
        <LandingScene />
        <Wordmark variant="cabinet" className="claim-art-mark" />
      </div>
      {picker}
    </div>
  );
}
