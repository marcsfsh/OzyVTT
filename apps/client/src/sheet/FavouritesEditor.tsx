import { IconPin } from "@vtt/ui";
import type { TurnOption } from "./turn-options";

/** The most pins the server keeps. */
export const MOST_PINS = 8;

/** The favourites' editor: every option as a toggle, up to the server's most, kept in the order they are pinned. */
export function FavouritesEditor({
  options,
  pins,
  busy,
  onSetPins
}: Readonly<{
  options: readonly TurnOption[];
  pins: readonly string[] | null;
  busy: boolean;
  onSetPins: (ids: readonly string[]) => void;
}>) {
  const pinned = (pins ?? []).filter((id) => options.some((option) => option.id === id));
  const togglePin = (id: string) =>
    onSetPins(pinned.includes(id) ? pinned.filter((entry) => entry !== id) : [...pinned, id].slice(0, MOST_PINS));
  return (
    <div className="cs-turn-edit" role="group" aria-label="Choose the favourites">
      <p className="cs-sub">Pin up to {MOST_PINS}. Favourites come first, in the order you pin them.</p>
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
    </div>
  );
}
