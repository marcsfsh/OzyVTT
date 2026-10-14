import type { CodexPageSummary } from "./api";

/**
 * The party as the character pickers offer it: active first, archived last and marked. "Archived" is a
 * table flag (`Actor.archived`), not a Codex field, so pages and actors are joined by trimmed,
 * case-folded name. Monsters are ignored, and no match means active, so a Codex with no table state gets
 * the plain list in page order.
 */
export type CodexCharacterOption = Readonly<{ id: string; title: string; archived: boolean }>;

/** What a picker needs from a table actor. */
export type ArchivableActor = Readonly<{ name: string; archived?: boolean; kind?: string }>;

const key = (name: string) => name.trim().toLowerCase();

/** Every `character` page, active first, flagged if the table archived the actor of the same name. */
export function charactersFor(
  pages: readonly CodexPageSummary[],
  actors: readonly ArchivableActor[] = []
): readonly CodexCharacterOption[] {
  const archivedNames = new Set(
    actors.filter((actor) => actor.archived === true && actor.kind !== "monster").map((actor) => key(actor.name))
  );
  const all = pages
    .filter((page) => page.entityType === "character")
    .map((page) => ({ id: page.id, title: page.title, archived: archivedNames.has(key(page.title)) }));
  // A stable partition, not a sort, so nothing re-orders within the active half.
  return [...all.filter((option) => !option.archived), ...all.filter((option) => option.archived)];
}

/** Shared so `TagInput` labels and `Combobox` meta say the same word. */
export const ARCHIVED_META = "Archived";
export const archivedOptionLabel = (title: string, archived: boolean): string =>
  archived ? `${title} — ${ARCHIVED_META}` : title;
