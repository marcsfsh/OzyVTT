import { IconButton, IconX, RevealSwitch } from "@vtt/ui";
import "./staging-tray.css";

/**
 * The staging tray (D2/D3) — the one habit for putting anything on a map.
 *
 * Everything the GM adds lands HERE first, labelled and explicitly not yet on the map: the active
 * party is listed without anyone adding it, a monster from the browser drops in beside them, and a
 * Recent re-add joins the same list. Dragging a tray token onto the map is what places it.
 *
 * One visibility decision, at the top, in the product's words (D1/D28): "New tokens · Shown to
 * players / GM only". It governs what the NEXT add starts as; a row's own eye is a per-entry
 * override afterwards. The browser's old "Add as GM-only" checkbox is gone — that decision was made
 * in a modal, three surfaces away from the list it applied to, and no other surface had it at all.
 *
 * The list is height-capped with its own scroll at EVERY viewport (`staging-tray.css`), which is the
 * fix for the complaint in Appendix A1: the add buttons live below this region, so a long party or a
 * pile of goblins can never push "+ Add monsters" off the bottom of the panel again.
 */

export type StagingKind = "player-character" | "npc" | "monster";

export type StagingEntry = Readonly<{
  actorId: string;
  name: string;
  kind: StagingKind;
  /** True once its token has a position on the map — the tray keeps showing it, saying which it is. */
  placed: boolean;
  /** `visibility === "public"`. The per-entry half of the reveal decision. */
  revealed: boolean;
}>;

/** D28: specific kinds, never "actor" or "combatant". */
const KIND_WORD: Record<StagingKind, string> = { "player-character": "Character", npc: "NPC", monster: "Monster" };

export function StagingTray({ entries, revealNew, onRevealNewChange, onRevealEntryChange, onRemove, busy = false, emptyNote, placementHint = true }: Readonly<{
  entries: readonly StagingEntry[];
  /** Tray-level decision: do tokens added from here start shown to players? */
  revealNew: boolean;
  onRevealNewChange: (revealed: boolean) => void;
  onRevealEntryChange: (actorId: string, revealed: boolean) => void;
  /** Triad **Remove** — out of this list; the character or monster survives on the roster. */
  onRemove: (entry: StagingEntry) => void;
  busy?: boolean;
  emptyNote: string;
  /** The prep doors can say "drag them onto the map"; a door with no map beside it says nothing. */
  placementHint?: boolean;
}>) {
  const placed = entries.filter((entry) => entry.placed).length;
  return <section className="staging-tray" aria-label="Staging tray">
    <header className="staging-tray-head">
      <div className="staging-tray-title">
        <strong>Staging tray</strong>
        <span>{entries.length === 0 ? "Nothing staged yet" : `${entries.length} staged · ${placed} on the map`}</span>
      </div>
      <label className="staging-tray-reveal">
        <span>New tokens</span>
        <RevealSwitch revealed={revealNew} onChange={onRevealNewChange} disabled={busy} ariaLabel="Show new tokens to players" />
      </label>
    </header>
    {entries.length === 0
      ? <p className="staging-tray-empty">{emptyNote}</p>
      : <ul className="staging-tray-list scroll-y">
          {entries.map((entry) => <li key={entry.actorId} className={`staging-row${entry.placed ? " is-placed" : ""}`}>
            {/* THE ROW IS A NAME AND A MUTED SECOND LINE, like the live tracker's (ruling 47).
                "Placed" used to be a `Badge` — a bordered, magenta-rimmed box on every row, saying
                the same thing the row's leading tick already says (ruling 7's mark, drawn by
                `.staging-row.is-placed::before`). Two marks for one fact is the redundancy ruling 47
                removed from the tracker when the active row's `▶` caret went; this is the same
                removal on the same fact. The WORDS stay, in the line that already carries the kind. */}
            <span className="staging-row-name">
              <strong>{entry.name}</strong>
              <small>{KIND_WORD[entry.kind]} · {entry.placed ? "Placed" : "In the tray"}</small>
            </span>
            {/* RULING 58 — one reveal language everywhere, and this row was the exception. It drew the
                per-entry reveal as a raw `IconButton`: the same glyph and the same magenta, inside a
                29.6px box with a 2px rim and a plate fill that the primitive does not have, and with
                the magenta glow cast by that whole box rather than by the eye. Reveal is where a GM
                misreading the state leaks something to the table, so it is the primitive now — and
                the primitive keeps the name and the tooltip that an icon-only toggle owes
                (`aria-label` + `title` + the tooltip bubble, all from `RevealSwitch`). */}
            <RevealSwitch revealed={entry.revealed} disabled={busy} className="staging-row-reveal"
              ariaLabel={`Show ${entry.name} to players`}
              onChange={(revealed) => onRevealEntryChange(entry.actorId, revealed)} />
            <IconButton size="sm" className="staging-row-remove" label={`Remove ${entry.name} from this list`} disabled={busy} onClick={() => onRemove(entry)}><IconX /></IconButton>
          </li>)}
        </ul>}
    {placementHint && entries.length > 0 && placed < entries.length && <p className="staging-tray-hint">Drag them from the tray above the map to place them — or tap a tray token to drop it at the centre.</p>}
  </section>;
}
