import type { CodexPageSummary } from "./api";

/**
 * `5a` / `5e.3` — the party, as two pickers offer it: **active characters first, archived ones last
 * and marked.**
 *
 * **The fork this file settles.** "Archived" is a TABLE concept, not a Codex one: `Actor.archived` is a
 * GM management flag on `GameState` (`packages/schemas/src/index.ts:538` — "hidden from players and
 * excluded from the encounter builder / party"), and a Codex `character` page has no archive field at
 * all (`grep archived apps/server/src/codex-store.ts` → nothing). So the two are joined the only way
 * they can be — **by name** — and that join lives here rather than being copied into two views that
 * would drift.
 *
 * The join is deliberately conservative:
 *   - it MATCHES on the trimmed, case-folded name, because "Ireena" and "ireena " are one person;
 *   - it IGNORES monsters, so a monster token that happens to share a name with an NPC's page cannot
 *     archive that page out from under the GM;
 *   - **no match means active.** A campaign with no table state at all (the Codex is usable on its own)
 *     gets exactly the list it had before, in exactly the order it had before.
 *
 * Order within each group is the caller's page order, untouched. That is what keeps this additive: the
 * common case — a party with nothing archived — is byte-identical to the list these pickers already
 * offered.
 */
export type CodexCharacterOption = Readonly<{ id: string; title: string; archived: boolean }>;

/** What a picker needs to know about a table actor. A superset of `{id, name}` is fine. */
export type ArchivableActor = Readonly<{ name: string; archived?: boolean; kind?: string }>;

const key = (name: string) => name.trim().toLowerCase();

/**
 * Every `character` page, active first, each carrying whether the table has archived the actor of the
 * same name. `actors` is optional so a caller with no table state still gets the plain list.
 */
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
  // A stable partition, not a sort: `Array.prototype.sort` is stable in every engine we target, but
  // saying "these, then those" is the rule, and a comparator would invite someone to add a tiebreak
  // that quietly re-orders the active half.
  return [...all.filter((option) => !option.archived), ...all.filter((option) => option.archived)];
}

/**
 * How an archived character READS in a chooser. One string, one place: `TagInput` can only take a
 * label (`optionLabel`) while `Combobox` renders a muted `meta` suffix, so the two surfaces would
 * otherwise say "Archived" in two different words.
 */
export const ARCHIVED_META = "Archived";
export const archivedOptionLabel = (title: string, archived: boolean): string =>
  archived ? `${title} — ${ARCHIVED_META}` : title;
