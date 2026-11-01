import { useRef, useState } from "react";
import { rosterActors, type PlayerActor, type PlayerView } from "@vtt/domain";
import {
  Alert,
  Button,
  EmptyState,
  IconPage,
  IconPlus,
  StatusLamp,
  burst,
  canMove,
  fill,
  useOnChange,
  useToast
} from "@vtt/ui";
import { useConfirm } from "../components/feedback";
import { LandingScene } from "../shell/Landing";
import { PdfImportModal } from "./PdfImportModal";
import { claimStateOf } from "./actor-display";
import { ClaimCard } from "./ClaimCard";
import { command } from "../lib/command";
import { noteClaimReleased, useClaimReleased } from "../lib/claim-notice";
import { navigate } from "../router";
import "./claim-character.css";

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
 * The table view for a player who has not claimed a character yet (arrival spec 2.3, ADR-0052): Pick your character
 * shows the party as a lineup of cards, one is chosen, and Play as claims it. A character claimed on another device
 * says so, with what to do. After a claim the player lands on My character. With `art` (no map live), the cards stand
 * on the horizon of the title screen's sunset, with no logo; with a map live they sit in the table's panel.
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
  // The picked card's top edge fills outward from its centre with a burst, and the others dim for a moment (ADR-0045).
  const list = useRef<HTMLUListElement>(null);
  useOnChange(chosen?.id ?? null, (_was, id) => {
    const rows = list.current ? [...list.current.querySelectorAll<HTMLElement>(":scope > .claim-card")] : [];
    const picked = rows.find((row) => row.dataset.actor === id)?.querySelector<HTMLElement>(".claim-card-pick");
    if (!id || !picked || !canMove()) return;
    const edge = picked.ownerDocument.createElement("span");
    edge.className = "lr-part claim-card-edge";
    edge.setAttribute("aria-hidden", "true");
    picked.append(edge);
    const lit = fill(edge, { origin: "50%", delay: 0, dur: 220 });
    const remove = () => edge.remove();
    if (lit) lit.finished.then(remove, remove);
    else remove();
    burst(picked, { at: picked.clientWidth / 2, line: picked.clientHeight, delay: 40, w: 100 });
    for (const row of rows)
      if (row.dataset.actor !== id)
        row.animate([{ opacity: 1 }, { offset: 0.4, opacity: 0.55 }, { opacity: 1 }], { duration: 300 });
  });

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
    <section className={art ? "claim-view is-stage" : "claim-view scroll-y"} aria-labelledby="claim-heading">
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
        <EmptyState>
          Nothing to claim yet. Your GM is setting up the party. You can send them a character sheet in the meantime.
        </EmptyState>
      ) : (
        <ul ref={list} className="claim-lineup" role="radiogroup" aria-labelledby="claim-heading">
          {characters.map((actor) => (
            <ClaimCard
              key={actor.id}
              actor={actor}
              chosen={chosen?.id === actor.id}
              busy={claiming}
              compact={!art}
              onChoose={() => setChosenId(actor.id)}
            />
          ))}
        </ul>
      )}
      {/* The glass foot: Make a new character and the import as Base line controls, Play as as the Cup at the right. */}
      <div className="claim-foot">
        <span className="claim-foot-tools">
          {builderOpen && (
            <Button onClick={() => navigate("/builder")}>
              <IconPlus /> Make a new character
            </Button>
          )}
          <Button onClick={() => setPdfImportOpen(true)}>
            <IconPage /> Import from D&amp;D Beyond (PDF)
          </Button>
        </span>
        {open.length > 0 && (
          <Button
            variant="primary"
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
  if (!art) return picker;
  // With no map live the page is the sunset with no logo (arrival rule 2): its horizon at 50%, the sun 300px.
  return (
    <div className="claim-stage">
      <div className="claim-stage-scene" aria-hidden="true">
        <LandingScene />
      </div>
      {picker}
    </div>
  );
}
