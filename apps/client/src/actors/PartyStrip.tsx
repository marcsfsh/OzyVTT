import { useState } from "react";
import type { GmActor, GmView, PlayerActor, PlayerView } from "@vtt/domain";
import { Avatar, Button } from "@vtt/ui";
import { CharacterSheet } from "../encounter/CharacterSheet";
import { CLAIM_WORD, claimStateOf, classLine, hpLabel, presenceDot, presenceLabel } from "./actor-display";
import { partyVisibilityOf } from "./MyCharacter";

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
 * **THIS IS A PARTY SURFACE, so a player's copy answers to the party-visibility tier (rulings
 * 5/8/19), and it reads the tier rather than inferring one from which fields arrived.** At `off`
 * there is no strip at all — `main.tsx` does not mount it and the guard below is the second lock —
 * because `off` means "no party surface", not "delete my players from the battle map": every ally
 * stays in `state.actors` at every tier so `combat.initiative` and `combat.tokens` stay coherent, and
 * their presence is not permission to list them. Above `off` the strip shows what the GM was promised
 * it would (`SettingsPage.tsx`'s four help strings): `name-and-class` says *who is in the party and
 * what they play*, which is a name and a class line and **not** a number off somebody's sheet, so
 * exact HP starts at `full-sheet` — the tier where a player may open the sheet that carries it. The
 * GM's own strip is never gated: the tier governs what a player sees of ANOTHER player's character.
 *
 * Tapping an entry opens that character's sheet. **A player may open their own entry only, and that
 * is stricter than the tier allows on purpose** — `CharacterSheet` is the owner's sheet and renders
 * damage/heal controls the server correctly refuses on someone else's character. The read-only twin
 * for another player's sheet is `MyCharacter`'s `PartyMemberSheet`, on the My character tab, at
 * `full-sheet` and above. (An earlier version of this note claimed the projection carries no
 * definition for anyone else's character; `projections.ts`'s field table marks `definition` **Y at
 * `full-sheet` and `sheet-and-resources`**, so the behaviour was right and the reason was not.)
 */
type Props = ({ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }) & {
  /** GM only: the empty state's way out. Absent ⇒ no button is offered. */
  onOpenRoster?: () => void;
};

export function PartyStrip(props: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  /** `null` for the GM — there is no tier over the GM's own view of their own table. */
  const tier = props.role === "player" ? partyVisibilityOf(props.state) : null;
  const actors = props.state.actors.filter(
    (actor) => actor.kind === "player-character" && !("archived" in actor && actor.archived)
  ) as ReadonlyArray<GmActor | PlayerActor>;
  const openActor = openId ? actors.find((actor) => actor.id === openId) ?? null : null;

  // The second lock on `off`. The mount in `main.tsx` is the first; this one means a future call site
  // cannot reintroduce the leak by rendering the component without consulting the tier.
  if (tier === "off") return null;

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
        // Your own HP is always yours (the projection's `mine` column is not negotiable), and the GM
        // reads every number on their own table. Everyone else's exact HP is the SHEET tiers' fact.
        const showsHp = tier === null || claim === "mine" || tier === "full-sheet" || tier === "sheet-and-resources";
        // "Who's in the party and what they play": the server derives `classLine` for another
        // player's character (a player projection has no `definitions` list to read one off); your
        // own falls back to the sheet you already hold. Only a player projection has either, and it
        // is only ever asked for below `full-sheet` — the GM's rows always read HP.
        const line = "claimStatus" in actor ? actor.classLine ?? classLine(actor.definition) : null;
        const detail = showsHp ? hpLabel(actor.hp) : line;
        const openable = props.role === "gm" || claim === "mine";
        const label = [actor.name, detail, CLAIM_WORD[claim], actor.presence ? presenceLabel(actor.presence) : null]
          .filter((part): part is string => Boolean(part))
          .join(" — ");
        const body = <>
          <Avatar name={actor.name} size="sm" presence={actor.presence ? presenceDot(actor.presence) : undefined} />
          <span className="party-strip-name">{actor.name}</span>
          {detail && <span className={showsHp ? "party-strip-hp" : "party-strip-line"}>{detail}</span>}
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
