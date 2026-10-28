import type { GmView, PlayerView } from "@vtt/domain";
import { IconEyeOff, cx } from "@vtt/ui";
import { ActorPortrait, frameOf } from "../actors/ActorPortrait";
import { healthBandFor } from "../encounter/conditions";
import { focusTokenOnMap } from "../scene/tableGeometry";
import "./turn-tiles.css";

type Tile = Readonly<{
  actorId: string;
  name: string;
  score: number;
  acting: boolean;
  next: boolean;
  acted: boolean;
  hidden: boolean;
}>;

/**
 * The turn order as this audience sees it. The GM gets the real order; a player gets only the entries their
 * projection holds. NEXT is the next entry in that list after the acting one, wrapping at the round's end; during a
 * hidden turn a player can't tell where the round is, so nothing is marked acting, next or done.
 */
export function turnTiles(
  view: Readonly<{ role: "gm"; state: GmView } | { role: "player"; state: PlayerView }>
): readonly Tile[] {
  const { combat } = view.state;
  const entries =
    view.role === "gm"
      ? combat.initiative.map((entry) => ({
          actorId: entry.actorId,
          name: view.state.actors.find((actor) => actor.id === entry.actorId)?.name ?? "Unknown",
          score: entry.score
        }))
      : view.state.combat.initiative.map((entry) => ({ actorId: entry.actorId, name: entry.name, score: entry.score }));
  const hiddenTurn = view.role === "player" && view.state.combat.hiddenTurn;
  const at = hiddenTurn ? -1 : entries.findIndex((entry) => entry.actorId === combat.turnActorId);
  const nextAt = at === -1 || entries.length < 2 ? -1 : (at + 1) % entries.length;
  return entries.map((entry, index) => {
    const actor = view.state.actors.find((candidate) => candidate.id === entry.actorId);
    return {
      ...entry,
      acting: index === at,
      next: index === nextAt,
      // The next one at the round's end leads the next round, so it isn't dimmed as done.
      acted: at !== -1 && index < at && index !== nextAt,
      hidden: view.role === "gm" && actor?.visibility === "gm-only"
    };
  });
}

/**
 * The turn order across the top of the map: a tile per entry with its portrait, name and initiative. The acting tile
 * wears the sun frame, the next carries NEXT beside its portrait, and the ones that have acted this round dim their
 * portrait. Hidden creatures show the dashed violet frame and the crossed eye, to the GM only. A tile brings the token
 * into view.
 */
export function TurnTiles(
  props: Readonly<{ token: string | null } & ({ role: "gm"; state: GmView } | { role: "player"; state: PlayerView })>
) {
  const tiles = turnTiles(props);
  const hiddenTurn = props.role === "player" && props.state.combat.hiddenTurn;
  return (
    <ol className="turn-tiles" aria-label={`Turn order, round ${props.state.combat.round}`}>
      {hiddenTurn && (
        <li className="turn-tile is-acting is-gm-turn">
          <span className="turn-tile-gm">GM turn</span>
        </li>
      )}
      {tiles.map((tile) => {
        const actor = props.state.actors.find((candidate) => candidate.id === tile.actorId);
        const placed = props.state.combat.tokens.some((entry) => entry.actorId === tile.actorId && entry.position);
        return (
          <li key={tile.actorId} data-key={tile.actorId}>
            <button
              type="button"
              className={cx(
                "turn-tile",
                "interactive",
                tile.acting && "is-acting",
                tile.acted && "is-done",
                tile.hidden && "is-hidden"
              )}
              aria-current={tile.acting ? "true" : undefined}
              aria-label={`${tile.name}, initiative ${tile.score}${tile.acting ? ", acting" : tile.next ? ", next" : ""}${tile.hidden ? ", hidden from players" : ""}`}
              disabled={!placed}
              onClick={() => focusTokenOnMap(tile.actorId)}
            >
              <span className="turn-tile-face">
                {actor && (
                  <ActorPortrait
                    actor={actor}
                    token={props.token}
                    definitions={props.role === "gm" ? props.state.definitions : undefined}
                    frame={tile.hidden ? "hidden" : frameOf(actor, props.role)}
                    now={tile.acting}
                    dim={tile.acted}
                    down={healthBandFor(actor.hp) === "down"}
                    size="sm"
                  />
                )}
                {tile.next && (
                  <span className="turn-tile-next" aria-hidden="true">
                    NEXT
                  </span>
                )}
              </span>
              <span className="turn-tile-text" aria-hidden="true">
                {tile.hidden && <IconEyeOff />}
                {/* A character by first name, as the table calls them; the label above keeps the whole name. */}
                <span className="turn-tile-name">
                  {actor?.kind === "player-character" ? (tile.name.split(/\s+/)[0] ?? tile.name) : tile.name}
                </span>
                <span className="turn-tile-score">{tile.score}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
