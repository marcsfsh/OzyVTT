import type {
  ContentBackgroundSummary,
  ContentClassSummary,
  ContentCompendium,
  ContentEquipmentSummary,
  ContentFeatSummary,
  ContentSpeciesSummary,
  ContentSpellSummary,
  ContentSubclassSummary
} from "@vtt/domain";
import { BackgroundDetail, ClassDetail, FeatDetail, SpeciesDetail, SubclassDetail } from "../builder/StepDetail";
import { SpellCardContent } from "../encounter/spells";
import { StatBlock, type StatBlockRecord } from "../encounter/StatBlock";
import { ItemCard } from "../sheet/ItemCard";
import type { Draft } from "../homebrew/schema";
import {
  backgroundSummaryOf,
  classSummaryOf,
  equipmentSummaryOf,
  featSummaryOf,
  speciesSummaryOf,
  spellSummaryOf,
  subclassSummaryOf
} from "../homebrew/summaries";
import { titleize } from "../builder/build-payload";
import { listName, type Kind, type Names, NO_NAMES } from "./kinds";

/** A record the caller has no name for: an SRD id reads as its words, and a homebrew id is never spelled out. */
const recordWord = (id: string) => (id.startsWith("hb-") ? "A homebrew feat" : titleize(id));

/**
 * A record as the people who use it meet it: a spell as the sheet's spell card, an item as the sheet's item card, a
 * class, species, background, subclass or feat as the character builder's detail, and a monster as the stat block the
 * GM reads in the bestiary. The Card tab, the pinned preview, the phone's preview and the players' Compendium all
 * draw this one component, so what the GM checks is what people get.
 */
export type Card =
  | Readonly<{ kind: "spell"; row: ContentSpellSummary }>
  | Readonly<{ kind: "equipment"; row: ContentEquipmentSummary }>
  | Readonly<{ kind: "class"; row: ContentClassSummary }>
  | Readonly<{ kind: "subclass"; row: ContentSubclassSummary }>
  | Readonly<{ kind: "species"; row: ContentSpeciesSummary }>
  | Readonly<{ kind: "background"; row: ContentBackgroundSummary }>
  | Readonly<{ kind: "feat"; row: ContentFeatSummary }>
  | Readonly<{ kind: "monster"; body: StatBlockRecord }>
  | Readonly<{
      kind: "spell-list";
      name: string;
      description: string | null;
      spells: ReadonlyArray<Readonly<{ id: string; name: string; level: number }>>;
    }>;

/** A record body (a draft being written, or an SRD record's authorable body) as its card. */
export function cardOfBody(
  kind: Kind,
  body: Draft,
  id: string,
  spells: ReadonlyArray<Readonly<{ id: string; name: string; level: number; classes: readonly string[] }>> = []
): Card {
  switch (kind) {
    case "spell":
      return { kind, row: spellSummaryOf(body, id) };
    case "equipment":
      return { kind, row: equipmentSummaryOf(body, id) };
    case "class":
      return { kind, row: classSummaryOf(body, id) };
    case "subclass":
      return { kind, row: subclassSummaryOf(body, id) };
    case "species":
      return { kind, row: speciesSummaryOf(body, id) };
    case "background":
      return { kind, row: backgroundSummaryOf(body, id) };
    case "feat":
      return { kind, row: featSummaryOf(body, id) };
    case "monster":
      return { kind, body };
    case "spell-list": {
      // The spells that name the list, and the ones it adds, as the builder's spell step draws from it.
      const added = new Set(Array.isArray(body.add) ? (body.add as string[]) : []);
      const removed = new Set(Array.isArray(body.remove) ? (body.remove as string[]) : []);
      const bases = new Set(Array.isArray(body.basedOn) ? (body.basedOn as string[]) : []);
      const members = spells
        .filter(
          (spell) =>
            !removed.has(spell.id) &&
            (added.has(spell.id) || spell.classes.includes(id) || spell.classes.some((list) => bases.has(list)))
        )
        .sort((left, right) => left.level - right.level || left.name.localeCompare(right.name));
      return {
        kind,
        name: typeof body.name === "string" && body.name.trim() ? body.name : "Untitled spell list",
        description: typeof body.description === "string" && body.description.trim() ? body.description : null,
        spells: members
      };
    }
  }
}

/** The one row a reader's Compendium holds for a record, as its card. */
export function cardOfEntry(entry: ContentCompendium): Card | null {
  switch (entry.kind) {
    case "spell":
      return entry.rows[0] ? { kind: "spell", row: entry.rows[0] } : null;
    case "equipment":
      return entry.rows[0] ? { kind: "equipment", row: entry.rows[0] } : null;
    case "class":
      return entry.rows[0] ? { kind: "class", row: entry.rows[0] } : null;
    case "subclass":
      return entry.rows[0] ? { kind: "subclass", row: entry.rows[0] } : null;
    case "species":
      return entry.rows[0] ? { kind: "species", row: entry.rows[0] } : null;
    case "background":
      return entry.rows[0] ? { kind: "background", row: entry.rows[0] } : null;
    case "feat":
      return entry.rows[0] ? { kind: "feat", row: entry.rows[0] } : null;
  }
}

export function cardName(card: Card): string {
  if (card.kind === "monster") return typeof card.body.name === "string" ? card.body.name : "Untitled monster";
  if (card.kind === "spell-list") return card.name;
  return card.row.name;
}

export function CompendiumCard({ card, names = NO_NAMES }: Readonly<{ card: Card; names?: Names }>) {
  const heading = (name: string) => <h3 className="cp-card-name">{name}</h3>;
  switch (card.kind) {
    case "monster":
      return <StatBlock monster={card.body} className="cp-card cp-card--statblock" />;
    case "equipment":
      return (
        <div className="cp-card cp-card--item">
          <ItemCard item={card.row} name={card.row.name} />
        </div>
      );
    case "spell":
      return (
        <article className="cp-card" aria-label={`${card.row.name} spell card`}>
          {heading(card.row.name)}
          <SpellCardContent spell={card.row} listName={(id) => listName(names, id)} />
        </article>
      );
    case "class":
      return (
        <article className="cp-card" aria-label={card.row.name}>
          {heading(card.row.name)}
          <ClassDetail record={card.row} table />
        </article>
      );
    case "subclass":
      return (
        <article className="cp-card" aria-label={card.row.name}>
          {heading(card.row.name)}
          <SubclassDetail record={card.row} className={names.record(card.row.classId) ?? undefined} />
        </article>
      );
    case "species":
      return (
        <article className="cp-card" aria-label={card.row.name}>
          {heading(card.row.name)}
          <SpeciesDetail record={card.row} />
        </article>
      );
    case "background":
      return (
        <article className="cp-card" aria-label={card.row.name}>
          {heading(card.row.name)}
          <BackgroundDetail record={card.row} featName={(id) => names.record(id) ?? recordWord(id)} />
        </article>
      );
    case "feat":
      return (
        <article className="cp-card" aria-label={card.row.name}>
          {heading(card.row.name)}
          <FeatDetail record={card.row} />
        </article>
      );
    case "spell-list":
      return (
        <article className="cp-card" aria-label={card.name}>
          {heading(card.name)}
          {card.description && <p className="cb-detail-text">{card.description}</p>}
          {card.spells.length === 0 ? (
            <p className="cp-hint">No spells are on this list yet.</p>
          ) : (
            <ul className="cp-card-list">
              {card.spells.map((spell) => (
                <li key={spell.id}>
                  <span>{spell.name}</span>
                  <span className="cp-hint tabular">{spell.level === 0 ? "Cantrip" : `Level ${spell.level}`}</span>
                </li>
              ))}
            </ul>
          )}
        </article>
      );
  }
}
