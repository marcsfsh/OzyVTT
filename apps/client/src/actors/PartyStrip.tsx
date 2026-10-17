import { useState } from "react";
import { rosterActors, type GmActor, type GmView, type PlayerActor, type PlayerView } from "@vtt/domain";
import { Avatar, Button } from "@vtt/ui";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { navigate } from "../router";
import { CLAIM_WORD, claimStateOf, classLine, hpLabel, presenceDot, presenceLabel } from "./actor-display";
import { partyVisibilityOf } from "./MyCharacter";
import "./party-strip.css";

/**
 * The party as one scrolling row of portraits, shown out of combat (in combat the turn order
 * shows the same people).
 *
 * Renders only projection-carried fields. A player's copy follows the party-visibility tier, read
 * from the field rather than inferred: no strip at `off`, and other characters' exact HP only from
 * `full-sheet` up. The GM's strip is never gated.
 *
 * A player may open only their own entry: `CharacterSheet` renders damage/heal controls the server
 * refuses on someone else's character. `MyCharacter`'s `PartyMemberSheet` is the read-only view.
 */
type Props = ({ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }) & {
  /** GM only: the empty state's way out. Absent ⇒ no button is offered. */
  onOpenRoster?: () => void;
};

export function PartyStrip(props: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  /** `null` for the GM, whose view is never tier-gated. */
  const tier = props.role === "player" ? partyVisibilityOf(props.state) : null;
  // Excludes a launched replay's clones, which carry the party's own names.
  const actors = rosterActors(props.state.actors as ReadonlyArray<GmActor | PlayerActor>).filter(
    (actor) => actor.kind === "player-character" && !("archived" in actor && actor.archived)
  );
  const openActor = openId ? (actors.find((actor) => actor.id === openId) ?? null) : null;

  // Second guard on `off` (the table view also skips the mount), so a new call site cannot leak the party.
  if (tier === "off") return null;

  if (actors.length === 0) {
    // A player who has claimed nobody never gets here, so an empty party is always the GM's.
    return (
      <section className="party-strip party-strip-empty" aria-label="The party">
        <p>No characters yet. Create or import them on the Roster tab.</p>
        {props.onOpenRoster && (
          <Button variant="ghost" size="sm" onClick={props.onOpenRoster}>
            Open Roster
          </Button>
        )}
      </section>
    );
  }

  return (
    <section className="party-strip" aria-label="The party">
      <ul className="party-strip-row">
        {actors.map((actor) => {
          const claim = claimStateOf(actor);
          // Your own HP and the GM's view are always exact; other characters' exact HP needs a sheet tier.
          const showsHp = tier === null || claim === "mine" || tier === "full-sheet" || tier === "sheet-and-resources";
          // Below `full-sheet` a player sees a class line instead: the server-derived `classLine` for other
          // characters, the stored sheet for your own. GM rows always show HP.
          const line = "claimStatus" in actor ? (actor.classLine ?? classLine(actor.definition)) : null;
          const detail = showsHp ? hpLabel(actor.hp) : line;
          const openable = props.role === "gm" || claim === "mine";
          const label = [actor.name, detail, CLAIM_WORD[claim], actor.presence ? presenceLabel(actor.presence) : null]
            .filter((part): part is string => Boolean(part))
            .join(", ");
          const body = (
            <>
              <Avatar name={actor.name} size="sm" presence={actor.presence ? presenceDot(actor.presence) : undefined} />
              <span className="party-strip-name">{actor.name}</span>
              {detail && <span className={showsHp ? "party-strip-hp" : "party-strip-line"}>{detail}</span>}
              <span className={`party-strip-claim party-strip-claim--${claim}`} />
            </>
          );
          return (
            <li key={actor.id} className={`party-strip-item${claim === "mine" ? " is-mine" : ""}`}>
              {openable ? (
                <button
                  type="button"
                  className="party-strip-entry"
                  aria-label={`${label}. Open sheet.`}
                  onClick={() => setOpenId(actor.id)}
                >
                  {body}
                </button>
              ) : (
                /* A plain readout rather than a disabled button: a player cannot open someone else's sheet. */
                <span className="party-strip-entry is-static" role="group" aria-label={label}>
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {openActor && (
        <CharacterSheet
          actor={openActor}
          role={props.role}
          state={props.state}
          onClose={() => setOpenId(null)}
          /* The GM levels anyone here; a player only opens their own entry. */
          onLevel={() => {
            setOpenId(null);
            navigate(`/characters/${openActor.id}/level`);
          }}
        />
      )}
    </section>
  );
}
