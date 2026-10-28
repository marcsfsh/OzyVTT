import { Button, IconButton, IconX, RevealSwitch } from "@vtt/ui";
import "./staging-tray.css";

/**
 * Everyone in a scene, listed under "In this scene": everything the GM adds lands here first, labelled and not yet
 * on the map (the active party is listed automatically). Place arms the map, and the tray over the map drags.
 * One visibility choice at the top ("New tokens · Shown to players / GM only") sets what the next
 * add starts as; each row's eye overrides it per entry. The list caps its height and scrolls
 * (`staging-tray.css`), so the Add buttons below are never pushed off the panel.
 */

export type StagingKind = "player-character" | "npc" | "monster";

export type StagingEntry = Readonly<{
  actorId: string;
  name: string;
  kind: StagingKind;
  /** True once its token has a position on the map; the tray keeps showing it. */
  placed: boolean;
  /** `visibility === "public"`: the per-entry half of the reveal choice. */
  revealed: boolean;
}>;

/** Specific kinds, never "actor" or "combatant". */
const KIND_WORD: Record<StagingKind, string> = { "player-character": "Character", npc: "NPC", monster: "Monster" };

export function StagingTray({
  entries,
  revealNew,
  onRevealNewChange,
  onRevealEntryChange,
  onRemove,
  busy = false,
  emptyNote,
  placementHint = true,
  onPlace
}: Readonly<{
  entries: readonly StagingEntry[];
  /** Tray-level decision: do tokens added from here start shown to players? */
  revealNew: boolean;
  onRevealNewChange: (revealed: boolean) => void;
  onRevealEntryChange: (actorId: string, revealed: boolean) => void;
  /** Remove: out of this list; the character or monster stays on the roster. */
  onRemove: (entry: StagingEntry) => void;
  busy?: boolean;
  emptyNote: string;
  /** The prep doors can say "drag them onto the map"; a door with no map beside it says nothing. */
  placementHint?: boolean;
  /** The button half of placing: arms the map, so the next spot pressed on it is where this one goes. */
  onPlace?: (entry: StagingEntry) => void;
}>) {
  const placed = entries.filter((entry) => entry.placed).length;
  return (
    <section className="staging-tray" aria-label="In this encounter">
      <header className="staging-tray-head">
        <div className="staging-tray-title">
          <strong>In this encounter</strong>
          <span>{entries.length === 0 ? "Nothing staged yet" : `${entries.length} staged · ${placed} on the map`}</span>
        </div>
        <label className="staging-tray-reveal">
          <span>New tokens</span>
          <RevealSwitch
            revealed={revealNew}
            onChange={onRevealNewChange}
            disabled={busy}
            ariaLabel="Show new tokens to players"
          />
        </label>
      </header>
      {entries.length === 0 ? (
        <p className="staging-tray-empty">{emptyNote}</p>
      ) : (
        <ul className="staging-tray-list scroll-y">
          {entries.map((entry) => (
            <li key={entry.actorId} className={`staging-row${entry.placed ? " is-placed" : ""}`}>
              {/* A name and a muted second line (kind, and "Placed"); the leading tick drawn by
                `.staging-row.is-placed::before` also marks placement. */}
              <span className="staging-row-name">
                <strong>{entry.name}</strong>
                <small>
                  {KIND_WORD[entry.kind]} · {entry.placed ? "Placed" : "In the tray"}
                </small>
              </span>
              {/* `RevealSwitch`, the one reveal control, so the state cannot be misread; it supplies the
                accessible name and tooltip. */}
              {onPlace && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="staging-row-place"
                  disabled={busy}
                  aria-label={`${entry.placed ? "Move" : "Place"} ${entry.name} on the map`}
                  onClick={() => onPlace(entry)}
                >
                  {entry.placed ? "Move" : "Place"}
                </Button>
              )}
              <RevealSwitch
                revealed={entry.revealed}
                disabled={busy}
                className="staging-row-reveal"
                ariaLabel={`Show ${entry.name} to players`}
                onChange={(revealed) => onRevealEntryChange(entry.actorId, revealed)}
              />
              <IconButton
                size="sm"
                className="staging-row-remove"
                label={`Remove ${entry.name} from this list`}
                disabled={busy}
                onClick={() => onRemove(entry)}
              >
                <IconX />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {placementHint && entries.length > 0 && placed < entries.length && (
        <p className="staging-tray-hint">
          {onPlace
            ? "Press Place, then the spot on the map. A long press on the map offers what can go there."
            : "Drag a token from the tray above the map to place it, or tap it to drop it at the centre."}
        </p>
      )}
    </section>
  );
}
