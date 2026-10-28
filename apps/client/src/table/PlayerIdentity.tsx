import type { PlayerView } from "@vtt/domain";
import { LifeBar } from "@vtt/ui";
import { ActorPortrait } from "../actors/ActorPortrait";
import { armorClassOf } from "../sheet/sheet-model";
import "./player-identity.css";

/**
 * A player's phone header on the table and its log: the character they play, its AC and hit points and its life bar.
 * On a phone the top bar belongs to the page, and this is the table's. The numbers are the player's own projection.
 */
export function PlayerIdentity({ state, token }: Readonly<{ state: PlayerView; token: string }>) {
  const actor = state.actors.find((candidate) => candidate.claimStatus === "mine");
  if (!actor) return null;
  const hp = actor.hp.kind === "exact" ? actor.hp : null;
  const armorClass = armorClassOf(actor);
  return (
    <header className="player-identity" aria-label={`Playing ${actor.name}`} data-horizon="">
      <ActorPortrait actor={actor} token={token} frame="party" size="sm" />
      <div className="player-identity-who">
        <b className="player-identity-name">{actor.name}</b>
        {actor.classLine && <span className="player-identity-line">{actor.classLine}</span>}
      </div>
      {armorClass !== null && armorClass !== undefined && (
        <span className="player-identity-box">
          <b>{armorClass}</b>
          <span>AC</span>
        </span>
      )}
      {hp && (
        <span className="player-identity-box is-wide">
          <b>
            {hp.current}/{hp.maximum}
          </b>
          <span>HP</span>
        </span>
      )}
      {hp && <LifeBar hp={hp} showNumbers={false} className="player-identity-life" />}
    </header>
  );
}
