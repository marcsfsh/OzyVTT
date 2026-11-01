import { useId } from "react";
import type { PlayerActor } from "@vtt/domain";
import { Tag, cx } from "@vtt/ui";
import { ActorPortrait } from "./ActorPortrait";
import { CLAIM_WORD, claimStateOf } from "./actor-display";
import { pickLine } from "./ClaimCharacter";

/**
 * One character in the lineup (arrival spec 2.3): a tall card with the portrait on a wash of its colour and a Claimed
 * tag when someone else plays them, the name in capitals, the class line, and a plate of AC, HP and Speed. The card is
 * the radio, named by the character and described by what `pickLine` says. A claimed card is shown, not offered: it is
 * dimmed, cannot be chosen, and says what to do.
 */
export function ClaimCard({
  actor,
  chosen,
  busy,
  compact = false,
  onChoose
}: Readonly<{
  actor: PlayerActor;
  chosen: boolean;
  busy: boolean;
  /** In the table's panel with a map live: a smaller portrait, two cards to a row. */
  compact?: boolean;
  onChoose: () => void;
}>) {
  const describe = useId();
  const claimState = claimStateOf(actor);
  const taken = claimState === "claimed";
  const who = [actor.species, actor.classLine].filter(Boolean).join(" ");
  const ac = actor.armorClassOverride ?? actor.armorClass;
  const hp = actor.hp.kind === "exact" ? actor.hp.maximum : null;
  return (
    <li
      data-actor={actor.id}
      className={cx("claim-card", taken && "is-taken", chosen && "is-chosen", compact && "is-compact")}
    >
      <button
        type="button"
        role="radio"
        aria-checked={chosen}
        aria-label={actor.name}
        aria-describedby={describe}
        className="claim-card-pick interactive"
        disabled={taken || busy}
        onClick={onChoose}
      >
        <span className="claim-card-art">
          <ActorPortrait actor={actor} frame="party" size={compact ? "lg" : "xl"} />
          {taken && (
            <Tag size="sm" className="claim-card-tag">
              {CLAIM_WORD[claimState]}
            </Tag>
          )}
        </span>
        <span className="claim-card-body">
          <b className="claim-card-name">{actor.name}</b>
          {who && <span className="claim-card-line">{who}</span>}
          {taken && <span className="claim-card-taken">Claimed on another device. Ask the GM to release it.</span>}
          <span className="claim-card-plate" aria-hidden="true">
            <span>
              <i>AC</i>
              <b>{ac ?? "--"}</b>
            </span>
            <span className="is-hp">
              <i>HP</i>
              <b>{hp ?? "--"}</b>
            </span>
            <span>
              <i>Speed</i>
              <b>{actor.speedFeet ?? "--"}</b>
            </span>
          </span>
        </span>
        <span id={describe} className="nh-sr-only">
          {pickLine(actor)}
        </span>
      </button>
    </li>
  );
}
