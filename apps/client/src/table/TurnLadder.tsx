import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { GmView, PlayerView } from "@vtt/domain";
import { IconEyeOff, cx } from "@vtt/ui";
import { ActorPortrait, frameOf } from "../actors/ActorPortrait";
import { healthBandFor } from "../encounter/conditions";
import { useMediaQuery } from "../lib/useMediaQuery";
import { focusTokenOnMap } from "../scene/tableGeometry";
import { BAND_WORDS, turnLadder, type LadderEntry } from "./ladderRows";
import { useOrderLight } from "./orderLight";
import "./turn-ladder.css";

type LadderProps = Readonly<
  { token: string | null; layout?: "rows" | "cards" } & (
    { role: "gm"; state: GmView } | { role: "player"; state: PlayerView }
  )
>;

/** What a row says under its name: the bar or the wound word, then its conditions as small tags. */
function RowLine({ entry }: Readonly<{ entry: LadderEntry }>) {
  return (
    <span className="ladder-line">
      {entry.hp ? (
        // A 4px bar, gold for the party and red for a foe (table spec 4); the numbers are the GM's on the sheet.
        <span className={cx("ladder-bar", entry.party ? "is-party" : "is-foe")}>
          <span
            className="ladder-bar-fill"
            style={{
              width: `${Math.max(0, Math.min(100, (entry.hp.current / Math.max(1, entry.hp.maximum)) * 100))}%`
            }}
          />
        </span>
      ) : entry.band ? (
        <span className="ladder-word">{BAND_WORDS[entry.band]}</span>
      ) : null}
      {entry.conditions.map((condition) => (
        <span key={condition.id} className={cx("ladder-cond", condition.harmful && "is-harmful")}>
          {condition.label}
        </span>
      ))}
    </span>
  );
}

/**
 * The turn order as a Ladder (table spec 2.2, ADR-0050): a row per combatant with its face, name and initiative, its hit
 * points by role and its conditions under the name. The acting row is tinted amber with the horizon ink down its left
 * edge, NEXT sits under the next initiative, and before a fight the initiative reads "--". A row brings the token into
 * view. In the 72px dock a row shows its face and initiative, and a pointer or focus shows it whole beside the dock.
 * On a phone the rows are cards in one line that scrolls sideways, the acting card inked along its bottom.
 */
export function TurnLadder(props: LadderProps) {
  const entries = turnLadder(props);
  const cards = props.layout === "cards";
  const fighting = props.state.combat.active;
  const hiddenTurn = props.role === "player" && props.state.combat.hiddenTurn;
  const wide = useMediaQuery("(min-width: 1280px)");
  const [peek, setPeek] = useState<Readonly<{ key: string; top: number; left: number }> | null>(null);
  const show = (key: string, target: HTMLElement) => {
    if (wide || cards) return;
    const box = target.getBoundingClientRect();
    setPeek({ key, top: box.top, left: box.right + 4 });
  };
  const peeked = peek ? entries.find((entry) => entry.actorId === peek.key) : undefined;
  return (
    <>
      <ol
        className={cx("turn-ladder", cards && "turn-ladder--cards")}
        aria-label={`Turn order, round ${props.state.combat.round}`}
      >
        {hiddenTurn && (
          <li className="ladder-item">
            <span className="ladder-row is-acting is-gm-turn">The GM is taking a turn</span>
          </li>
        )}
        {entries.map((entry) => {
          const actor = props.state.actors.find((candidate) => candidate.id === entry.actorId);
          const placed = props.state.combat.tokens.some((token) => token.actorId === entry.actorId && token.position);
          return (
            <li key={entry.actorId} className="ladder-item" data-key={entry.actorId}>
              <button
                type="button"
                className={cx(
                  "ladder-row",
                  "interactive",
                  entry.acting && "is-acting",
                  entry.acted && "is-done",
                  entry.hidden && "is-hidden"
                )}
                aria-current={entry.acting ? "true" : undefined}
                aria-label={`${entry.name}, initiative ${fighting ? entry.score : "not rolled"}${entry.acting ? ", acting" : entry.next ? ", next" : ""}${entry.hidden ? ", hidden from players" : ""}`}
                disabled={!placed}
                onClick={() => focusTokenOnMap(entry.actorId)}
                onPointerEnter={(event) => show(entry.actorId, event.currentTarget)}
                onPointerLeave={() => setPeek(null)}
                onFocus={(event) => show(entry.actorId, event.currentTarget)}
                onBlur={() => setPeek(null)}
              >
                <span className="ladder-face">
                  {actor && (
                    <ActorPortrait
                      actor={actor}
                      token={props.token}
                      definitions={props.role === "gm" ? props.state.definitions : undefined}
                      frame={entry.hidden ? "hidden" : frameOf(actor, props.role)}
                      now={entry.acting}
                      dim={entry.acted}
                      down={healthBandFor(actor.hp) === "down"}
                      size="sm"
                    />
                  )}
                </span>
                <span className="ladder-body" aria-hidden="true">
                  <span className="ladder-name">
                    {entry.hidden && <IconEyeOff />}
                    {entry.name}
                  </span>
                  <RowLine entry={entry} />
                </span>
                <span className="ladder-init" aria-hidden="true">
                  <span className="ladder-score">{fighting ? entry.score : "--"}</span>
                  {entry.next && <span className="ladder-next">NEXT</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {peek &&
        peeked &&
        createPortal(
          <div className="ladder-peek" style={{ top: peek.top, left: peek.left }} aria-hidden="true">
            <span className="ladder-name">{peeked.name}</span>
            <RowLine entry={peeked} />
          </div>,
          document.body
        )}
    </>
  );
}

/** The phone's turn order (table spec 2.2 and 2.4): the Ladder's cards, with the order's light running along them. */
export function LadderCards(props: LadderProps) {
  const strip = useRef<HTMLDivElement>(null);
  const { state } = props;
  const fighting = state.combat.active;
  const hiddenTurn = props.role === "player" && props.state.combat.hiddenTurn;
  const card = (key: string) =>
    strip.current?.querySelector<HTMLElement>(`.turn-ladder > li[data-key="${CSS.escape(key)}"]`) ?? null;
  useOrderLight(strip, {
    keys: fighting ? state.combat.initiative.map((entry) => entry.actorId) : [],
    acting: fighting && !hiddenTurn ? state.combat.turnActorId : null,
    round: fighting ? state.combat.round : null,
    item: card,
    point: (key) => card(key)?.querySelector<HTMLElement>(".ladder-face") ?? null,
    frame: (key) => card(key)?.querySelector<HTMLElement>(".nh-portrait") ?? null,
    axis: "x",
    rail: (host) => host.clientHeight - 1,
    lamps: true
  });
  return (
    <div ref={strip} className="ladder-cards">
      {props.role === "gm" ? (
        <TurnLadder role="gm" state={props.state} token={props.token} layout="cards" />
      ) : (
        <TurnLadder role="player" state={props.state} token={props.token} layout="cards" />
      )}
    </div>
  );
}
