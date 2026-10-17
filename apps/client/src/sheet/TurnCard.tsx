import { useState, type ReactNode } from "react";
import { Button, IconList, IconPin } from "@vtt/ui";
import { ActionList, ConcentrationTag } from "./ActionList";
import { COST_GROUPS, type TurnOption } from "./turn-options";

/** How many tiles the card shows before anything is pinned. */
const TILES = 6;
/** The most pins the server keeps. */
export const MOST_PINS = 8;

/** Rolls something at a creature: an attack, a save or damage. */
const strikes = (option: TurnOption) =>
  option.summary.attackBonus !== null || option.summary.saveAbility !== null || option.summary.damage.length > 0;

/** The order a card fills itself in with no history: what can be used now first, what strikes before what doesn't, a
 *  caster's spells before its weapons, the cheapest spell first. */
const fillOrder = (left: TurnOption, right: TurnOption) =>
  Number(left.reason !== null) - Number(right.reason !== null) ||
  Number(!strikes(left)) - Number(!strikes(right)) ||
  Number(left.kind === "weapon") - Number(right.kind === "weapon") ||
  (left.spell?.level ?? 0) - (right.spell?.level ?? 0);

/**
 * The tiles before anything is pinned: the options used most, then a spread of the rest (four actions, a Bonus Action
 * and a Reaction, what strikes first), so a character with no history still gets a full card in the list's order.
 */
export function defaultTiles(options: readonly TurnOption[], counts: Readonly<Record<string, number>>): TurnOption[] {
  const used = [...options]
    .filter((option) => (counts[option.id] ?? 0) > 0)
    .sort((left, right) => (counts[right.id] ?? 0) - (counts[left.id] ?? 0))
    .slice(0, TILES);
  const rest = options.filter((option) => !used.includes(option));
  const of = (costs: readonly string[]) => rest.filter((option) => costs.includes(option.cost)).sort(fillOrder);
  const spread = [
    ...of(["action", "magic"]).slice(0, 4),
    ...of(["bonus-action"]).slice(0, 1),
    ...of(["reaction"]).slice(0, 1)
  ];
  const fill = [...rest.filter((option) => !spread.includes(option))].sort(fillOrder);
  const chosen = [...used, ...spread, ...fill].slice(0, TILES);
  return COST_GROUPS.flatMap(([cost]) => chosen.filter((option) => option.cost === cost));
}

/** The tiles the card shows: the pinned options in their order, else the default fill. */
export function tilesOf(
  options: readonly TurnOption[],
  pins: readonly string[] | null | undefined,
  counts: Readonly<Record<string, number>>
): TurnOption[] {
  const pinned = (pins ?? []).flatMap((id) => options.filter((option) => option.id === id));
  return pinned.length > 0 ? pinned : defaultTiles(options, counts);
}

/** One tile: what it costs in words, its name, one line, and for a levelled spell its slots and lowest level. */
function Tile({
  option,
  waits,
  disabled,
  onUse
}: Readonly<{ option: TurnOption; waits: boolean; disabled: boolean; onUse: (option: TurnOption) => void }>) {
  const reason = option.reason ?? (waits ? "Waits for your turn" : null);
  return (
    <button
      type="button"
      className={`cs-turntile is-${option.cost} is-${option.kind}`}
      disabled={disabled}
      onClick={() => onUse(option)}
    >
      <span className="cs-turntile-cost">{option.costWords}</span>
      <strong className="cs-turntile-name">
        {option.name}
        {option.mastery && (
          <>
            {" · "}
            <span className="cs-action-mastery">{option.mastery}</span>
          </>
        )}
        {option.concentration && <ConcentrationTag />}
      </strong>
      {option.effect && <span className="cs-turntile-line">{option.effect}</span>}
      {option.slot && (
        <span className="cs-turntile-slots">
          <span className="cs-pips" aria-hidden="true">
            {Array.from({ length: option.slot.max }, (_, index) => (
              <i key={index} className={index < option.slot!.remaining ? "is-on" : undefined} />
            ))}
          </span>
          level {option.slot.level}
        </span>
      )}
      {reason && <span className="cs-turntile-reason">{reason}</span>}
    </button>
  );
}

/**
 * A player's turn on a phone: the favourite options as tiles, two to a row, each coloured by what it costs and saying
 * it in words; every option a tap away; and the pins chosen here. Off the character's turn it names who acts, and only
 * a Reaction stays live. Until the player pins some, the tiles are the options used most, filled from the list's order.
 */
export function TurnCard({
  options,
  myTurn,
  round,
  acting,
  busy,
  unavailable,
  header,
  pins,
  counts,
  onSetPins,
  onUse
}: Readonly<{
  options: readonly TurnOption[];
  myTurn: boolean;
  round: number | null;
  /** Who acts now, off the character's turn. */
  acting: string | null;
  busy: boolean;
  unavailable?: string;
  /** The turn's resources, on the sheet's own page; the table keeps them in its bar. */
  header?: ReactNode;
  pins: readonly string[] | null;
  counts: Readonly<Record<string, number>>;
  /** Stores the pins on the character; absent where they can't be changed. */
  onSetPins?: (ids: readonly string[]) => void;
  onUse: (option: TurnOption) => void;
}>) {
  const [view, setView] = useState<"tiles" | "all" | "edit">("tiles");
  const tiles = tilesOf(options, pins, counts);
  const pinned = (pins ?? []).filter((id) => options.some((option) => option.id === id));
  const togglePin = (id: string) => {
    if (!onSetPins) return;
    const next = pinned.includes(id) ? pinned.filter((entry) => entry !== id) : [...pinned, id].slice(0, MOST_PINS);
    onSetPins(next);
  };
  return (
    <section className="cs-turn" aria-label={myTurn ? "Your turn" : "The turn"}>
      <div className="cs-turn-head">
        <h2 className="cs-turn-title">{myTurn ? "Your turn" : `${acting ?? "Someone else"} is acting`}</h2>
        {round !== null && <span className="cs-turn-round">Round {round}</span>}
      </div>
      {!myTurn && <p className="cs-sub">Your Reaction stays ready. Everything else waits for your turn.</p>}
      {unavailable && <p className="cs-sub is-caution">{unavailable}.</p>}
      {header}
      {view === "all" ? (
        <div className="cs-turn-all">
          <Button size="sm" variant="ghost" onClick={() => setView("tiles")}>
            Back to the favourites
          </Button>
          <ActionList
            options={options}
            myTurn={myTurn}
            busy={busy}
            {...(unavailable ? { unavailable } : {})}
            onUse={onUse}
          />
        </div>
      ) : view === "edit" ? (
        <div className="cs-turn-edit" role="group" aria-label="Choose the favourites">
          <p className="cs-sub">Pin up to {MOST_PINS}. The card shows the pinned ones in the order you pin them.</p>
          <ul className="cs-pin-list">
            {options.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className={`cs-toggle interactive${pinned.includes(option.id) ? " is-on" : ""}`}
                  aria-pressed={pinned.includes(option.id)}
                  disabled={busy || (!pinned.includes(option.id) && pinned.length >= MOST_PINS)}
                  onClick={() => togglePin(option.id)}
                >
                  <IconPin /> {option.name}
                  <span className="cs-pin-cost">{option.costWords}</span>
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" onClick={() => setView("tiles")}>
            Done
          </Button>
        </div>
      ) : (
        <div className="cs-turntiles">
          {tiles.map((option) => (
            <Tile
              key={option.id}
              option={option}
              waits={!myTurn && option.cost !== "reaction"}
              disabled={busy || unavailable !== undefined || (!myTurn && option.cost !== "reaction")}
              onUse={onUse}
            />
          ))}
        </div>
      )}
      {view === "tiles" && (
        <div className="cs-turn-foot">
          <Button size="sm" variant="secondary" onClick={() => setView("all")}>
            <IconList /> All {options.length} options
          </Button>
          {onSetPins && (
            <Button size="sm" variant="secondary" onClick={() => setView("edit")}>
              <IconPin /> Edit favourites
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
