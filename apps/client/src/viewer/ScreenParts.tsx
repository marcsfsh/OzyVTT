import { useRef } from "react";
import { Portrait, VcrCounter, Wordmark, cx, defaultAvatarFor, useDragSurface, type PictureSource } from "@vtt/ui";
import { frameOf } from "../actors/ActorPortrait";
import type { Presentation, ViewerRollCard } from "./ViewerApp";
import "./screen-parts.css";

type Entry = Presentation["initiative"]["entries"][number];
type ScreenToken = Presentation["encounter"]["tokens"][number];

export type ScreenTile = Readonly<{ entry: Entry; acting: boolean; next: boolean; acted: boolean }>;

/**
 * The turn order as the table screen shows it, from the presentation alone. NEXT wraps at the round's end. During a
 * hidden turn the screen can't tell where the round is, so nothing is marked acting, next or done.
 */
export function screenTiles(initiative: Presentation["initiative"]): readonly ScreenTile[] {
  const { entries, hiddenTurn } = initiative;
  const at = hiddenTurn ? -1 : entries.findIndex((entry) => entry.active);
  const nextAt = at === -1 || entries.length < 2 ? -1 : (at + 1) % entries.length;
  return entries.map((entry, index) => ({
    entry,
    acting: index === at,
    next: index === nextAt,
    acted: at !== -1 && index < at && index !== nextAt
  }));
}

/**
 * An entry's picture: its placed token's art on the shown map, over the general avatar its actor id picks. The
 * screen's feed carries no classes, and an entry without a placed token keeps the fallback.
 */
function pictureFor(actorId: string, tokens: readonly ScreenToken[]): PictureSource {
  const token = tokens.find((candidate) => candidate.actorId === actorId);
  return {
    src: token?.tokenAssetId ? `/api/v1/token-assets/${encodeURIComponent(token.tokenAssetId)}/content` : null,
    fallback: defaultAvatarFor(actorId)
  };
}

/** The tokens on the map the screen shows: the only ones whose art and side it may use. */
function shownTokens(presentation: Presentation): readonly ScreenToken[] {
  const onMap = presentation.activeMap && presentation.encounter.mapAssetId === presentation.activeMap.assetId;
  return onMap ? presentation.encounter.tokens : [];
}

/** A character by first name, as the table calls them. */
function shortName(entry: Entry, token: ScreenToken | undefined): string {
  return token?.kind === "player-character" ? (entry.name.split(/\s+/)[0] ?? entry.name) : entry.name;
}

/**
 * The screen's top strip: the mark, the VCR counter, and a tile per turn with its picture, name and initiative.
 * Between fights the counter reads STOP and no tiles show.
 */
export function ScreenTop({ presentation }: Readonly<{ presentation: Presentation }>) {
  const { initiative } = presentation;
  const tokens = shownTokens(presentation);
  return (
    <header className="screen-top">
      <Wordmark variant="cabinet" className="screen-mark" />
      <VcrCounter round={initiative.visible ? initiative.round : null} size="lg" className="screen-vcr" />
      {initiative.visible && (
        <ol className="screen-tiles" aria-label={`Turn order, round ${initiative.round}`}>
          {initiative.hiddenTurn && (
            <li className="screen-tile is-acting is-gm-turn">
              <span className="screen-tile-gm">GM turn</span>
            </li>
          )}
          {screenTiles(initiative).map((tile) => {
            const token = tokens.find((candidate) => candidate.actorId === tile.entry.actorId);
            return (
              <li
                key={tile.entry.actorId}
                className={cx("screen-tile", tile.acting && "is-acting", tile.acted && "is-done")}
                aria-current={tile.acting ? "step" : undefined}
                aria-label={`${tile.entry.name}, initiative ${tile.entry.initiative}${tile.acting ? ", acting" : tile.next ? ", next" : ""}`}
              >
                <span className="screen-tile-face">
                  <Portrait
                    picture={pictureFor(tile.entry.actorId, tokens)}
                    frame={token ? frameOf(token) : "neutral"}
                    now={tile.acting}
                    dim={tile.acted}
                    size="lg"
                  />
                  {tile.next && (
                    <span className="screen-tile-next" aria-hidden="true">
                      NEXT
                    </span>
                  )}
                </span>
                <span className="screen-tile-text" aria-hidden="true">
                  <span className="screen-tile-name">{shortName(tile.entry, token)}</span>
                  <span className="screen-tile-score">{tile.entry.initiative}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </header>
  );
}

/** Who acts now on the screen, in the column's top card: the GM's turn, the acting creature, or the scene between fights. */
function ActingNow({ presentation }: Readonly<{ presentation: Presentation }>) {
  const { initiative } = presentation;
  if (!initiative.visible)
    return (
      <section className="screen-card screen-acting is-idle" aria-label="No encounter running">
        <p className="screen-card-label">No encounter running</p>
        <p className="screen-acting-name chrome">{presentation.activeMap?.altText || "The table"}</p>
      </section>
    );
  if (initiative.hiddenTurn)
    return (
      <section className="screen-card screen-acting is-gm-turn" aria-label="GM turn" aria-live="polite">
        <p className="screen-card-label">Acting now</p>
        <p className="screen-acting-name">GM turn</p>
      </section>
    );
  const tiles = screenTiles(initiative);
  const acting = tiles.find((tile) => tile.acting)?.entry;
  const next = tiles.find((tile) => tile.next)?.entry;
  if (!acting)
    return (
      <section className="screen-card screen-acting" aria-label="Waiting for the first turn">
        <p className="screen-card-label">Round {initiative.round}</p>
        <p className="screen-acting-name chrome">Waiting for the first turn</p>
      </section>
    );
  const tokens = shownTokens(presentation);
  const token = tokens.find((candidate) => candidate.actorId === acting.actorId);
  return (
    <section className="screen-card screen-acting" aria-label={`Acting now: ${acting.name}`} aria-live="polite">
      <div className="screen-acting-head">
        <Portrait
          picture={pictureFor(acting.actorId, tokens)}
          frame={token ? frameOf(token) : "neutral"}
          now
          size="xl"
        />
        <div className="screen-acting-who">
          <p className="screen-card-label">Acting now</p>
          <p className="screen-acting-name chrome">{acting.name}</p>
        </div>
      </div>
      {next && <p className="screen-acting-next">Next: {next.name}</p>}
    </section>
  );
}

/** The dice as the card reads them: "d20 12 +7", a die left out of the total in brackets. */
export function diceWords(card: ViewerRollCard): string {
  const dice = card.dice.map((die) => (die.kept ? `d${die.sides} ${die.face}` : `(d${die.sides} ${die.face})`));
  const modifier = card.modifier === 0 ? [] : [card.modifier > 0 ? `+${card.modifier}` : `${card.modifier}`];
  return [...dice, ...modifier].join(" ");
}

/** The newest public roll, as the room reads it across the table: who and what, the total, the dice. */
function LatestRoll({ card }: Readonly<{ card: ViewerRollCard | null }>) {
  if (!card)
    return (
      <section className="screen-card screen-roll" aria-label="Latest roll">
        <p className="screen-card-label">Latest roll</p>
        <p className="screen-roll-empty">No roll to show yet.</p>
      </section>
    );
  return (
    <section
      key={card.id}
      className="screen-card screen-roll is-rolled"
      aria-label={`Latest roll: ${card.who}, ${card.what}, ${card.total}`}
      aria-live="polite"
    >
      <p className="screen-roll-who">
        <b>{card.who}</b> {card.what}
      </p>
      <p className="screen-roll-line">
        <span className="screen-roll-total">{card.total}</span>
        <span className="screen-roll-dice">{diceWords(card)}</span>
      </p>
    </section>
  );
}

/**
 * The column beside the map: who acts now, and the latest public roll. Dragging its inner edge resizes it; left grows it.
 */
export function ScreenColumn({
  presentation,
  onResize
}: Readonly<{ presentation: Presentation; onResize?: (width: number) => void }>) {
  const columnRef = useRef<HTMLElement | null>(null);
  const resizeSurface = useDragSurface<HTMLDivElement>();
  const startResize = (event: React.PointerEvent) => {
    if (!onResize) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = columnRef.current?.offsetWidth ?? 320;
    const onMove = (move: PointerEvent) =>
      onResize(Math.max(240, Math.min(window.innerWidth * 0.6, startWidth + (startX - move.clientX))));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <aside ref={columnRef} className="screen-column" aria-label="The turn and the latest roll">
      {onResize && (
        <div
          ref={resizeSurface}
          className="screen-column-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize the column"
          onPointerDown={startResize}
        />
      )}
      <div className="screen-column-scroll scroll-y">
        <ActingNow presentation={presentation} />
        <LatestRoll card={presentation.latestRoll ?? null} />
      </div>
    </aside>
  );
}
