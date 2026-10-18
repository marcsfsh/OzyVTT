import type { ContentCompendium, ContentCompendiumKind } from "@vtt/domain";
import type { HomebrewContentType } from "@vtt/api-contract";
import type { ContentView } from "./content-library.js";

/**
 * The Compendium a reader gets: one kind of the SRD and the homebrew that reader receives, as the catalog summaries
 * the builder and the gear picker already send. Built from the reader's own catalog (`ContentLibrary.forAudience`),
 * so a record the reader does not receive is not in it, by any count. No monsters: the bestiary is the GM's.
 */
export function compendiumOf(view: ContentView, kind: ContentCompendiumKind): ContentCompendium {
  const attribution = view.attribution;
  switch (kind) {
    case "class":
      return { kind, rows: view.classSummaries(), attribution };
    case "subclass":
      return { kind, rows: view.subclassSummaries(), attribution };
    case "species":
      return { kind, rows: view.speciesSummaries(), attribution };
    case "background":
      return { kind, rows: view.backgroundSummaries(), attribution };
    case "feat":
      return { kind, rows: view.featSummaries(), attribution };
    case "spell":
      return { kind, rows: view.spellSummaries(), attribution };
    case "equipment":
      return { kind, rows: view.equipmentSummaries(), attribution };
  }
}

const COMPENDIUM_KINDS: ReadonlySet<string> = new Set<ContentCompendiumKind>([
  "class",
  "subclass",
  "species",
  "background",
  "feat",
  "spell",
  "equipment"
]);

/**
 * The one Compendium row a reader gets for a record, or null when that reader does not receive it. `kind` is the
 * record's own kind; a monster or a spell list has no player card, so its entry is always null.
 */
export function compendiumEntryOf(view: ContentView, kind: HomebrewContentType, id: string): ContentCompendium | null {
  if (!COMPENDIUM_KINDS.has(kind)) return null;
  const whole = compendiumOf(view, kind as ContentCompendiumKind);
  const rows = (whole.rows as ReadonlyArray<{ id: string }>).filter((row) => row.id === id);
  return rows.length === 0 ? null : ({ ...whole, rows } as unknown as ContentCompendium);
}

/** The kind of an SRD or received record in a reader's catalog, or null when the catalog has no such id. */
export function kindInView(view: ContentView, id: string): HomebrewContentType | null {
  if (view.classRecord(id)) return "class";
  if (view.subclassRecord(id)) return "subclass";
  if (view.speciesRecord(id)) return "species";
  if (view.backgroundRecord(id)) return "background";
  if (view.featRecord(id)) return "feat";
  if (view.spellRecord(id)) return "spell";
  if (view.equipmentRecord(id)) return "equipment";
  if (view.monster(id)) return "monster";
  return null;
}
