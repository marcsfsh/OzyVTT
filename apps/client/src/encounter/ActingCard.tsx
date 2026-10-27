import type { GmActor, GmView } from "@vtt/domain";
import { LifeBar } from "@vtt/ui";
import { ActorPortrait, frameOf } from "../actors/ActorPortrait";
import "./acting-card.css";

const SIDE_WORD: Readonly<Record<GmActor["kind"], string>> = {
  "player-character": "Party",
  npc: "NPC",
  monster: "Monster"
};

/**
 * Who acts, at the top of the GM's Fight tab: the portrait in the sun frame, the name in chrome, then the life bar
 * with AC and speed. A legendary creature acting off-turn takes the card while it acts.
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
          size="lg"
        />
        <div className="acting-card-who">
          <h2 className="acting-card-name chrome">{actor.name}</h2>
          <p className="acting-card-side">{hidden ? "Hidden from players" : SIDE_WORD[actor.kind]}</p>
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
