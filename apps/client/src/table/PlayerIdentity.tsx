import type { PlayerView } from "@vtt/domain";
import { ActorPortrait } from "../actors/ActorPortrait";
import { BandPlate } from "../sheet/SheetBand";
import { armorClassOf } from "../sheet/sheet-model";
import "../sheet/sheet.css";
import "./player-identity.css";

/**
 * A player's phone header on the table and its log: the character they play, then its AC and hit points with the life
 * bar in the sheet band's cells (ADR-0047), so the character reads the same here as on its sheet.
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
      <BandPlate armorClass={armorClass} hp={hp} className="player-identity-plate" />
    </header>
  );
}
