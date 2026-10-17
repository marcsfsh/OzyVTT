import type { ActorDerivedSheet } from "@vtt/domain";
import { rollModeNotes, type RollModeSummary } from "./roll-mode-notes";

/** Marks a roll button the rules give Advantage or Disadvantage; the reason is in the button's accessible name. */
export function RollModeTag({ mode }: Readonly<{ mode?: RollModeSummary | null }>) {
  if (!mode || mode.mode === "normal") return null;
  const advantage = mode.mode === "advantage";
  return (
    <span className={`roll-mode-tag ${advantage ? "is-advantage" : "is-disadvantage"}`} aria-hidden="true">
      {advantage ? "Adv" : "Dis"}
    </span>
  );
}

/** Why the sheet's rolls have Advantage or Disadvantage, readable before any roll (on a phone there is no hover). */
export function RollModeNotes({ derived }: Readonly<{ derived: ActorDerivedSheet | null }>) {
  const notes = rollModeNotes(derived);
  if (notes.length === 0) return null;
  return (
    <ul className="sheet-roll-notes" aria-label="Advantage and Disadvantage">
      {notes.map((note) => (
        <li
          key={`${note.side}:${note.source}`}
          className={note.side === "advantage" ? "is-advantage" : "is-disadvantage"}
        >
          <strong>{note.side === "advantage" ? "Advantage" : "Disadvantage"}</strong> on {note.rolls} · {note.source}
        </li>
      ))}
    </ul>
  );
}
