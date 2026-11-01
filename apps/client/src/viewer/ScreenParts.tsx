import { useRef } from "react";
import {
  IconEyeOff,
  Portrait,
  Tag,
  VcrCounter,
  Wordmark,
  cx,
  defaultAvatarFor,
  useDragSurface,
  useOnChange,
  type PictureSource
} from "@vtt/ui";
import { frameOf } from "../actors/ActorPortrait";
import { natural, rollLands } from "../dice/rollLight";
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

/** The dice as the card reads them: "d20 12 +7", a die left out of the total in brackets. */
export function diceWords(card: ViewerRollCard): string {
  const dice = card.dice.map((die) => (die.kept ? `d${die.sides} ${die.face}` : `(d${die.sides} ${die.face})`));
  const modifier = card.modifier === 0 ? [] : [card.modifier > 0 ? `+${card.modifier}` : `${card.modifier}`];
  return [...dice, ...modifier].join(" ");
}

const SCREEN_ROLL_PARTS = { dice: ".screen-roll-dice", total: ".screen-roll-total", nat: ".screen-roll-nat" } as const;

/** The newest public roll, as the room reads it across the table: who and what, the total, the dice. */
function LatestRoll({ card }: Readonly<{ card: ViewerRollCard | null }>) {
  // A new roll lands on the card the way it does in the dice panel (ADR-0045).
  const shown = useRef<HTMLElement>(null);
  useOnChange(card?.id ?? null, (_was, id) => {
    if (id && card && shown.current) rollLands(shown.current, card.dice, card.total, SCREEN_ROLL_PARTS);
  });
  if (!card)
    return (
      <section className="screen-ladder-foot screen-roll" aria-label="Latest roll">
        <p className="screen-ladder-label">Latest roll</p>
        <p className="screen-roll-empty">No roll to show yet.</p>
      </section>
    );
  return (
    <section
      ref={shown}
      key={card.id}
      className="screen-ladder-foot screen-roll"
      aria-label={`Latest roll: ${card.who}, ${card.what}, ${card.total}`}
      aria-live="polite"
    >
      <p className="screen-ladder-label">Latest roll</p>
      <p className="screen-roll-who">
        <b>{card.who}</b> · {card.what}
        {natural(card.dice) && (
          <Tag tone={natural(card.dice) === "NAT 20" ? "hit" : "miss"} className="screen-roll-nat">
            {natural(card.dice)}
          </Tag>
        )}
      </p>
      <p className="screen-roll-line">
        <span className="screen-roll-total">{card.total}</span>
        <span className="screen-roll-dice">{diceWords(card)}</span>
      </p>
    </section>
  );
}

/**
 * The table screen in a fight is the turn ladder (table screen spec 2.1, ADR-0056): the wordmark and the round at its
 * head, one row a turn with its initiative, portrait and name in full, the acting row grown into a card with its name in
 * chrome, NEXT on the next row, and the latest roll at its foot. A long order scrolls with the turn so the acting row
 * stays in view. Dragging its edge sets its width for this screen.
 */
export function ScreenLadder({
  presentation,
  onResize
}: Readonly<{ presentation: Presentation; onResize?: (width: number) => void }>) {
  const { initiative } = presentation;
  const tokens = shownTokens(presentation);
  const ladderRef = useRef<HTMLElement | null>(null);
  const resizeSurface = useDragSurface<HTMLDivElement>();
  const tiles = initiative.visible ? screenTiles(initiative) : [];
  const acting = tiles.find((tile) => tile.acting);
  // The acting row and the next stay in view as the turn moves down a long order (table screen rule 3.4).
  useOnChange(acting?.entry.actorId ?? null, () => {
    ladderRef.current?.querySelector(".screen-rung.is-acting")?.scrollIntoView?.({ block: "nearest" });
  });
  const startResize = (event: React.PointerEvent) => {
    if (!onResize) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = ladderRef.current?.offsetWidth ?? 400;
    const onMove = (move: PointerEvent) =>
      onResize(Math.max(280, Math.min(window.innerWidth * 0.6, startWidth + (move.clientX - startX))));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const waiting = initiative.visible && !initiative.hiddenTurn && !acting;
  return (
    <aside ref={ladderRef} className="screen-ladder" aria-label="The turn and the latest roll">
      <header className="screen-ladder-head">
        <Wordmark variant="cabinet" className="screen-mark" />
        <VcrCounter round={initiative.visible ? initiative.round : null} size="lg" className="screen-vcr" />
      </header>
      {waiting && <p className="screen-ladder-waiting">Waiting for the first turn</p>}
      <div className="screen-ladder-rows scroll-y">
        {!initiative.visible ? (
          <section className="screen-rung is-acting is-idle" aria-label="No encounter running">
            <span className="screen-rung-who">
              <span className="screen-rung-label">No encounter running</span>
              <span className="screen-rung-name chrome">{presentation.activeMap?.altText || "The table"}</span>
            </span>
          </section>
        ) : (
          <ol className="screen-rungs" aria-label={`Turn order, round ${initiative.round}`}>
            {initiative.hiddenTurn && (
              <li className="screen-rung is-acting is-gm-turn" aria-label="Acting now: GM turn" aria-live="polite">
                <span className="screen-rung-face is-gm" aria-hidden="true">
                  <IconEyeOff />
                </span>
                <span className="screen-rung-who">
                  <span className="screen-rung-label">Acting now</span>
                  <span className="screen-rung-name">GM turn</span>
                </span>
              </li>
            )}
            {tiles.map((tile) => {
              const token = tokens.find((candidate) => candidate.actorId === tile.entry.actorId);
              return (
                <li
                  key={tile.entry.actorId}
                  className={cx("screen-rung", tile.acting && "is-acting", tile.acted && "is-done")}
                  aria-current={tile.acting ? "step" : undefined}
                  aria-label={`${tile.entry.name}, initiative ${tile.entry.initiative}${tile.acting ? ", acting" : tile.next ? ", next" : ""}`}
                  aria-live={tile.acting ? "polite" : undefined}
                >
                  <span className="screen-rung-init" aria-hidden="true">
                    {tile.entry.initiative}
                  </span>
                  <span className="screen-rung-face" aria-hidden="true">
                    <Portrait
                      picture={pictureFor(tile.entry.actorId, tokens)}
                      frame={token ? frameOf(token) : "neutral"}
                      now={tile.acting}
                      dim={tile.acted}
                      size={tile.acting ? "xl" : "lg"}
                    />
                  </span>
                  <span className="screen-rung-who" aria-hidden="true">
                    {tile.acting && <span className="screen-rung-label">Acting now</span>}
                    <span className={cx("screen-rung-name", tile.acting && "chrome")}>{tile.entry.name}</span>
                  </span>
                  {tile.next && (
                    <span className="screen-rung-next" aria-hidden="true">
                      NEXT
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <LatestRoll card={presentation.latestRoll ?? null} />
      {onResize && (
        <div
          ref={resizeSurface}
          className="screen-ladder-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize the column"
          onPointerDown={startResize}
        />
      )}
    </aside>
  );
}
