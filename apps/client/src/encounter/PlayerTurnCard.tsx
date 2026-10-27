import type { ReactNode } from "react";
import type { PlayerView } from "@vtt/domain";
import { VcrCounter } from "@vtt/ui";
import { ActorPortrait, frameOf } from "../actors/ActorPortrait";
import "./player-turn-card.css";

/**
 * When this player's character acts next, from the order their projection holds: later this round, next, or in the
 * next round. Nothing while a hidden turn hides where the round is, or while the character isn't in the order.
 */
export function nextTurnWords(combat: PlayerView["combat"], myId: string): string | null {
  if (combat.hiddenTurn) return null;
  const order = combat.initiative;
  const mine = order.findIndex((entry) => entry.actorId === myId);
  const acting = order.findIndex((entry) => entry.active);
  if (mine === -1 || acting === -1 || mine === acting) return null;
  if (mine === (acting + 1) % order.length) return "Your turn is next";
  return mine > acting ? "Your turn comes later this round" : `Your next turn is in round ${combat.round + 1}`;
}

/**
 * The head of a player's turn card on the table: YOUR TURN in chrome with the VCR counter on their turn; off it, who
 * is acting in the sun frame and when they act next. The lamps sit under it.
 */
export function PlayerTurnCard({
  state,
  myId,
  myTurn,
  title,
  lamps,
  children
}: Readonly<{
  state: PlayerView;
  myId: string | null;
  myTurn: boolean;
  /** Whose turn it is when it isn't the character's own (a creature its character commands). */
  title?: string;
  lamps: ReactNode;
  children?: ReactNode;
}>) {
  const { combat } = state;
  const counter = <VcrCounter round={combat.round} className="player-turn-card-counter" />;
  const actingEntry = combat.initiative.find((entry) => entry.active);
  const actingActor = actingEntry ? state.actors.find((actor) => actor.id === actingEntry.actorId) : undefined;
  const when = myId ? nextTurnWords(combat, myId) : null;
  const own = myTurn || title !== undefined;
  return (
    <section className={`player-turn-card${own ? " is-own" : ""}`}>
      {own ? (
        <div className="player-turn-card-head">
          <h2 className="player-turn-title chrome">{title ?? "Your turn"}</h2>
          {counter}
        </div>
      ) : (
        <div className="player-turn-card-head is-waiting">
          {actingActor && <ActorPortrait actor={actingActor} frame={frameOf(actingActor)} now size="sm" />}
          <div className="player-turn-card-who">
            <p className="player-turn-card-acting">
              {combat.hiddenTurn ? "The GM is taking a turn" : `${actingEntry?.name ?? "Someone"} is acting`}
            </p>
            {when && <p className="player-turn-card-when">{when}</p>}
          </div>
          {counter}
        </div>
      )}
      {lamps}
      {children}
    </section>
  );
}
