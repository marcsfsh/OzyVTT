import { useState } from "react";
import type { GmActor, GmView, PlayerActor, PlayerView } from "@vtt/domain";
import { Avatar, Button } from "@vtt/ui";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { CLAIM_WORD, claimStateOf, hpLabel, presenceDot, presenceLabel } from "./actor-display";

/**
 * **The party, as one row (D15).**
 *
 * The roster used to be a wall of cards the app shell painted above EVERY tab — above the map, above
 * the Codex, and (twice) above the Roster tab itself. This is what replaces it on the table: one
 * horizontally scrolling strip of portraits, ~56px tall, out of combat only, because in combat the
 * turn order already carries the same people.
 *
 * Both roles get the same shape and it renders **only projection-carried fields** — a player's own HP
 * is exact, everyone else's is whatever their projection said (exact for characters, a band otherwise),
 * and archived characters are absent by construction for a player and filtered here for the GM.
 *
 * Tapping an entry opens that character's sheet. A player may open **their own** entry only: the
 * projection carries no definition for anyone else's character, so there is no sheet to show and no
 * pretend door to offer.
 */
type Props = ({ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }) & {
  /** GM only: the empty state's way out. Absent ⇒ no button is offered. */
  onOpenRoster?: () => void;
};

export function PartyStrip(props: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const actors = props.state.actors.filter(
    (actor) => actor.kind === "player-character" && !("archived" in actor && actor.archived)
  ) as ReadonlyArray<GmActor | PlayerActor>;
  const openActor = openId ? actors.find((actor) => actor.id === openId) ?? null : null;

  if (actors.length === 0) {
    // A player who has claimed nobody never reaches this component (the claim surface owns that state),
    // so the only empty party is the GM's, and its way out is the Roster tab.
    return <section className="party-strip party-strip-empty" aria-label="The party">
      <p>No characters yet — create or import them on the Roster tab.</p>
      {props.onOpenRoster && <Button variant="ghost" size="sm" onClick={props.onOpenRoster}>Open Roster</Button>}
    </section>;
  }

  return <section className="party-strip" aria-label="The party">
    <ul className="party-strip-row">
      {actors.map((actor) => {
        const claim = claimStateOf(actor);
        const hp = hpLabel(actor.hp);
        const openable = props.role === "gm" || claim === "mine";
        const label = `${actor.name} — ${hp} — ${CLAIM_WORD[claim]}${actor.presence ? ` — ${presenceLabel(actor.presence)}` : ""}`;
        const body = <>
          <Avatar name={actor.name} size="sm" presence={actor.presence ? presenceDot(actor.presence) : undefined} />
          <span className="party-strip-name">{actor.name}</span>
          <span className="party-strip-hp">{hp}</span>
          <span className={`party-strip-claim party-strip-claim--${claim}`} />
        </>;
        return <li key={actor.id} className={`party-strip-item${claim === "mine" ? " is-mine" : ""}`}>
          {openable
            ? <button type="button" className="party-strip-entry" aria-label={`${label}. Open sheet.`} onClick={() => setOpenId(actor.id)}>{body}</button>
            /* Not a disabled button: a player cannot open someone else's sheet, and a control that looks
               broken reads worse than a plain readout of the same facts. */
            : <span className="party-strip-entry is-static" role="group" aria-label={label}>{body}</span>}
        </li>;
      })}
    </ul>
    {openActor && <CharacterSheet
      actor={openActor}
      role={props.role}
      state={props.state}
      onClose={() => setOpenId(null)}
    />}
  </section>;
}
