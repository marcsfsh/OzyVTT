import type { GmActor, GmView } from "@vtt/domain";
import { LifeBar } from "@vtt/ui";
import { ActorPortrait, frameOf } from "../actors/ActorPortrait";
import "./acting-card.css";

/** Who runs the acting creature (table spec 2.3): the GM runs a monster or an NPC, a player their character. */
const ACTING_WORD: Readonly<Record<GmActor["kind"], string>> = {
  "player-character": "Acting · from the player's device",
  npc: "Acting · you run it",
  monster: "Acting · you run it"
};

/**
 * Who acts, at the top of the GM's Encounter tab (table spec 2.3): the 44px face in the sun frame, the name in Chakra
 * Petch capitals (YOUR TURN is the table's one chrome lettering), who runs it, then the life bar with AC and speed. A
 * legendary creature acting off-turn takes the card while it acts.
 */
export function ActingCard({
  state,
  actor,
  token,
  speedFeet
}: Readonly<{
  state: GmView;
  actor: GmActor;
  token: string | null;
  /** This turn's speed as the server counts it, or the creature's own while that loads. */
  speedFeet?: number;
}>) {
  const hidden = actor.visibility === "gm-only";
  return (
    <section className="acting-card" aria-label={`Now acting · ${actor.name}`}>
      <div className="acting-card-head">
        <ActorPortrait
          actor={actor}
          token={token}
          definitions={state.definitions}
          frame={frameOf(actor, "gm")}
          now
          down={actor.hp.current <= 0}
          size="md"
        />
        <div className="acting-card-who">
          <h2 className="acting-card-name">{actor.name}</h2>
          <p className="acting-card-side">
            {ACTING_WORD[actor.kind]}
            {hidden && " · hidden from players"}
          </p>
        </div>
      </div>
      <div className="acting-card-numbers">
        <LifeBar hp={actor.hp} className="acting-card-life" />
        {actor.armorClass !== undefined && (
          <span className="acting-card-box">
            <b>{actor.armorClass}</b>
            <span>AC</span>
          </span>
        )}
        {speedFeet !== undefined && (
          <span className="acting-card-box">
            <b>{speedFeet}</b>
            <span>FT</span>
          </span>
        )}
      </div>
    </section>
  );
}
