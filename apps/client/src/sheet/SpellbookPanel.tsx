import { useState } from "react";
import type { ContentSpellSummary, SpellChoices } from "@vtt/domain";
import { Button, IconChevronLeft } from "@vtt/ui";
import { titleCase } from "../encounter/format";
import { namedFrom, SpellList, type Named } from "../encounter/SpellChoiceModals";

/** A Spell Scroll in the pack whose spell could go in the spellbook. */
export type CopyableScroll = Readonly<{ itemId: string; spellId: string }>;

/** SRD "Copying a Spell into the Book": 2 hours and 50 GP for each level of the spell. */
export const copyCost = (level: number) => `${2 * level} hours and ${50 * level} GP`;

type Pick = Readonly<{ spell: Named; from: "level" | "scroll" | "book"; itemId?: string }>;

/**
 * Adding to a Wizard's spellbook, as a panel the sheet places by width (under the list on a phone, in the right column
 * on a laptop). `add` takes one of the spells the Wizard's levels give, free; `copy` copies one from a Spell Scroll in
 * the pack (an Intelligence (Arcana) check, and the scroll is used up) or, for the GM, from another spellbook. Each
 * pick names its real cost before the one primary that copies it.
 */
export function SpellbookPanel({
  mode,
  name,
  spellbook,
  scrolls,
  gm,
  spellIndex,
  busy,
  onAdd,
  onClose
}: Readonly<{
  mode: "add" | "copy";
  /** The character's name, for the copy's check. */
  name: string;
  spellbook: NonNullable<SpellChoices["spellbook"]>;
  scrolls: readonly CopyableScroll[];
  gm: boolean;
  spellIndex: ReadonlyMap<string, ContentSpellSummary>;
  busy: boolean;
  onAdd: (spellId: string, from: "level" | "scroll" | "book", itemId?: string) => void;
  onClose: () => void;
}>) {
  const named = namedFrom(spellIndex);
  const [picked, setPicked] = useState<Pick | null>(null);
  const addable = spellbook.addable.map(named);
  const title = mode === "add" ? "Add to the spellbook" : "Copy into the spellbook";
  const school = (id: string) => {
    const word = spellIndex.get(id)?.school;
    return word ? titleCase(word) : null;
  };
  return (
    <section
      className="cs-card cs-book"
      aria-label={picked ? `${mode === "add" ? "Add" : "Copy"} ${picked.spell.name}` : title}
    >
      <div className="cs-cast-head">
        <button
          type="button"
          className="cs-back interactive"
          aria-label={picked ? "Back to the spells" : "Close"}
          onClick={() => (picked ? setPicked(null) : onClose())}
        >
          <IconChevronLeft />
        </button>
        <span className="cs-cast-title">
          <span className="cs-eyebrow">{title}</span>
          {picked && (
            <strong className="cs-cast-name">
              {picked.spell.name} · Level {picked.spell.level}
              {school(picked.spell.id) ? ` · ${school(picked.spell.id)}` : ""}
            </strong>
          )}
        </span>
      </div>
      {picked ? (
        <>
          <p className="cs-sub">
            {picked.from === "level"
              ? `${picked.spell.name} goes in the spellbook as one of the spells the Wizard levels give. It costs nothing.`
              : picked.from === "scroll"
                ? `From the Spell Scroll in the pack. Copying takes ${copyCost(picked.spell.level)}. ${name} makes a DC ${10 + picked.spell.level} Intelligence (Arcana) check, and the scroll is used up whether it succeeds or not.`
                : `From another spellbook. Copying takes ${copyCost(picked.spell.level)}.`}
          </p>
          <div className="cs-chiprow">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => onAdd(picked.spell.id, picked.from, picked.itemId)}
            >
              {mode === "add" ? `Add ${picked.spell.name}` : `Copy ${picked.spell.name}`}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Not now
            </Button>
          </div>
        </>
      ) : mode === "add" ? (
        <>
          <p className="cs-sub">
            {spellbook.freeLeft} more from the Wizard levels, up to level {spellbook.maxLevel}.
          </p>
          <SpellList spells={addable} onPick={(spell) => setPicked({ spell, from: "level" })} />
        </>
      ) : (
        <>
          <span className="cs-eyebrow">From a Spell Scroll in the pack</span>
          {scrolls.length === 0 ? (
            <p className="cs-sub">No scroll in the pack holds a Wizard spell to copy.</p>
          ) : (
            <SpellList
              spells={scrolls.map((scroll) => named(scroll.spellId))}
              detail={(spell) => `Level ${spell.level} · ${copyCost(spell.level)}`}
              onPick={(spell) =>
                setPicked({
                  spell,
                  from: "scroll",
                  itemId: scrolls.find((scroll) => scroll.spellId === spell.id)!.itemId
                })
              }
            />
          )}
          {gm && (
            <>
              <span className="cs-eyebrow">From another spellbook</span>
              <SpellList
                spells={addable}
                detail={(spell) => `Level ${spell.level} · ${copyCost(spell.level)}`}
                onPick={(spell) => setPicked({ spell, from: "book" })}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
