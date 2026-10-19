import { useState } from "react";
import { Input, Modal } from "@vtt/ui";
import type { TurnOption } from "../sheet/turn-options";
import "./pickers.css";

/**
 * The spells a feature casts at its user's pick (Divine Intervention: "any Cleric spell of level 5 or lower"), by
 * level with a level filter and a search. A pick goes on to the spell's own targeting; the server checks the use.
 */
export function SpellPickChooser({
  option,
  busy,
  onPick,
  onClose
}: Readonly<{
  option: TurnOption;
  busy: boolean;
  onPick: (pick: TurnOption) => void;
  onClose: () => void;
}>) {
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<number | null>(null);
  const picks = option.picks ?? [];
  const levels = [...new Set(picks.map((pick) => pick.level ?? 0))].sort((left, right) => left - right);
  const needle = query.trim().toLowerCase();
  const shown = picks.filter(
    (pick) => (level === null || (pick.level ?? 0) === level) && (!needle || pick.name.toLowerCase().includes(needle))
  );
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      accent="cyan"
      title={option.name}
      ariaLabel={`${option.name}: the spell it casts`}
    >
      <p className="spell-choice-ask">Choose the spell it casts now, with no spell slot and no Material components.</p>
      <div className="sheet-picker-controls">
        <Input
          type="search"
          className="sheet-picker-search"
          value={query}
          maxLength={60}
          placeholder="Search spells…"
          aria-label="Search spells"
          onChange={(event) => setQuery(event.target.value)}
        />
        {levels.length > 1 && (
          <div className="sheet-picker-filters" role="group" aria-label="Filter by spell level">
            {[null, ...levels].map((entry) => (
              <button
                key={entry ?? "all"}
                type="button"
                className={`sheet-picker-chip${entry === level ? " is-active" : ""}`}
                aria-pressed={entry === level}
                onClick={() => setLevel(entry)}
              >
                {entry === null ? "All" : entry === 0 ? "Cantrip" : `Level ${entry}`}
              </button>
            ))}
          </div>
        )}
      </div>
      {shown.length === 0 ? (
        <p className="spell-choice-empty">No spell matches that search.</p>
      ) : (
        <ul className="spell-choice-list">
          {shown.map((pick) => (
            <li key={pick.id}>
              <button
                type="button"
                className="spell-choice-row"
                disabled={busy || pick.reason !== null}
                title={pick.reason ?? undefined}
                onClick={() => onPick(pick)}
              >
                <span className="spell-choice-name">{pick.name}</span>
                <span className="spell-choice-detail">{pick.reason ?? pick.line}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
