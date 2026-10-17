import { useState } from "react";
import type { ContentSpellSummary, SpellChoices } from "@vtt/domain";
import { Button, Input, Modal } from "@vtt/ui";
import "./pickers.css";

/** A spell's name and level, from the SRD reference (its id when the reference hasn't loaded). */
export type Named = Readonly<{ id: string; name: string; level: number }>;
export const namedFrom = (index: ReadonlyMap<string, ContentSpellSummary>) => (id: string) => {
  const spell = index.get(id);
  return { id, name: spell?.name ?? id, level: spell?.level ?? 0 };
};

/** A searchable list of spells by level, each one tap. */
export function SpellList({
  spells,
  detail,
  onPick
}: Readonly<{ spells: readonly Named[]; detail?: (spell: Named) => string; onPick: (spell: Named) => void }>) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = spells
    .filter((spell) => spell.name.toLowerCase().includes(needle))
    .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
  return (
    <>
      {spells.length > 8 && (
        <Input
          type="search"
          className="spell-choice-search"
          value={query}
          maxLength={60}
          placeholder="Search spells"
          aria-label="Search spells"
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      {shown.length === 0 ? (
        <p className="spell-choice-empty">{spells.length === 0 ? "None to choose from." : "No spell matches."}</p>
      ) : (
        <ul className="spell-choice-list">
          {shown.map((spell) => (
            <li key={spell.id}>
              <button type="button" className="spell-choice-row" onClick={() => onPick(spell)}>
                <span className="spell-choice-name">{spell.name}</span>
                <span className="spell-choice-detail">{detail ? detail(spell) : `Level ${spell.level}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * After a Long Rest (or for the GM, any time outside a fight): put another spell on the prepared list in place of one
 * the class chose. A Cleric, Druid, Paladin or Ranger picks from its class's list for which it has slots, a Wizard
 * from the spellbook. The server checks both and rebuilds the sheet.
 */
export function SpellSwapModal({
  swaps,
  spellIndex,
  preparedIds,
  busy,
  onSwap,
  onClose
}: Readonly<{
  swaps: SpellChoices["swaps"];
  spellIndex: ReadonlyMap<string, ContentSpellSummary>;
  preparedIds: ReadonlySet<string>;
  busy: boolean;
  onSwap: (spellId: string, replaces: string) => void;
  onClose: () => void;
}>) {
  const named = namedFrom(spellIndex);
  const offered = swaps.filter((swap) => swap.spellIds.length > 0 && swap.replaces.length > 0);
  const [classId, setClassId] = useState(offered[0]?.classId ?? "");
  const swap = offered.find((entry) => entry.classId === classId) ?? offered[0];
  const [incoming, setIncoming] = useState<Named | null>(null);
  // Unprepared spells first: replacing one keeps everything prepared that is.
  const outgoing = (swap?.replaces ?? [])
    .map(named)
    .sort(
      (left, right) =>
        Number(preparedIds.has(left.id)) - Number(preparedIds.has(right.id)) || left.name.localeCompare(right.name)
    );
  const [replaced, setReplaced] = useState<string | null>(null);
  const out = replaced ?? outgoing[0]?.id ?? null;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      accent="violet"
      title={incoming ? `Prepare ${incoming.name}` : "Swap in a spell"}
      ariaLabel={incoming ? `Prepare ${incoming.name} in place of another spell` : "Choose a spell to prepare"}
      footer={
        incoming ? (
          <>
            <Button variant="ghost" onClick={() => setIncoming(null)}>
              Back
            </Button>
            <Button disabled={busy || out === null} onClick={() => out && onSwap(incoming.id, out)}>
              Swap
            </Button>
          </>
        ) : undefined
      }
    >
      {!swap ? (
        <p className="spell-choice-empty">There is no spell to swap in right now.</p>
      ) : incoming ? (
        <>
          <p className="spell-choice-ask">In place of:</p>
          <div className="heal-picker-targets" role="group" aria-label="The spell it replaces">
            {outgoing.map((spell) => (
              <button
                key={spell.id}
                type="button"
                className={`sheet-picker-chip${spell.id === out ? " is-active" : ""}`}
                aria-pressed={spell.id === out}
                onClick={() => setReplaced(spell.id)}
              >
                {spell.name}
                {preparedIds.has(spell.id) ? "" : " · not prepared"}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {offered.length > 1 && (
            <div className="heal-picker-targets" role="group" aria-label="Which class prepares it">
              {offered.map((entry) => (
                <button
                  key={entry.classId}
                  type="button"
                  className={`sheet-picker-chip${entry.classId === swap.classId ? " is-active" : ""}`}
                  aria-pressed={entry.classId === swap.classId}
                  onClick={() => {
                    setClassId(entry.classId);
                    setReplaced(null);
                  }}
                >
                  {entry.className}
                </button>
              ))}
            </div>
          )}
          <p className="spell-choice-ask">
            {swap.classId === "wizard" ? "From your spellbook:" : `${swap.className} spells you have slots for:`}
          </p>
          <SpellList spells={swap.spellIds.map(named)} onPick={setIncoming} />
        </>
      )}
    </Modal>
  );
}
