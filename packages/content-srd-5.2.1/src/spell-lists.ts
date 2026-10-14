/**
 * Spell-list membership, resolved as an overlay over the generated spell bundle. A
 * `SpellListReference` never edits a spell (the bundle is regenerated from vendored data); it declares
 * membership, folded into each spell's `classes` where the SRD and homebrew catalogs merge.
 *
 *   members(listId) = { spells already tagged `listId` in their own `classes` }
 *                   ∪ members(each id in `basedOn`)          // recursive, cycle-guarded
 *                   ∪ `add`                                   // intersected with real spell ids
 *                   \  `remove`                               // last, and absolute
 *
 * `remove` scopes this list only; it cannot un-tag a spell's own `classes`. An empty list makes a
 * caster pointed at it uncreatable (`resolveCatalogChoice` refuses empty options), so publish gates
 * check `emptyListIds`.
 */
import type { SpellListReference } from "./character-content.js";

/** Structural, so the resolver serves both `SpellReference` and the projected wire summary. */
export type SpellListSpell = Readonly<{ id: string; classes: readonly string[] }>;

/** What a batch resolve found - the diagnostics a publish gate needs, computed once. */
export type SpellListResolution = Readonly<{
  /** Declared list id -> its resolved member spell ids. Only ids that exist in `spells` appear. */
  memberIds: ReadonlyMap<string, ReadonlySet<string>>;
  /** Lists that resolved to zero spells: publishing a caster pointed at one makes it uncreatable. */
  emptyListIds: readonly string[];
  /** Lists whose `basedOn` forms a loop. Their `basedOn` is ignored entirely; the rest still resolves. */
  cyclicListIds: readonly string[];
  /** `basedOn` ids that are neither another declared list nor a tag any spell carries - a typo, silently contributing nothing. */
  unknownBasedOn: readonly string[];
  /** Declared list ids that are also an existing spell tag ("wizard"): the overlay merges into that list instead of creating one. */
  shadowedListIds: readonly string[];
}>;

/** Spell ids tagged with `listId` in their own `classes` - the bundle's own membership, before any overlay. */
function taggedWith(spells: readonly SpellListSpell[], listId: string): Set<string> {
  const out = new Set<string>();
  for (const spell of spells) if (spell.classes.includes(listId)) out.add(spell.id);
  return out;
}

/**
 * List ids on a `basedOn` cycle (direct or transitive). A cyclic list keeps its tagged spells and
 * `add` but ignores `basedOn`.
 */
function cyclicIds(listsById: ReadonlyMap<string, SpellListReference>): Set<string> {
  const cyclic = new Set<string>();
  const settled = new Set<string>();
  const walk = (id: string, path: Set<string>): void => {
    if (settled.has(id)) return;
    if (path.has(id)) {
      // Only the loop itself is cyclic; a list that merely points at one keeps its own `basedOn`.
      const walked = [...path];
      for (const onLoop of walked.slice(walked.indexOf(id))) cyclic.add(onLoop);
      return;
    }
    const list = listsById.get(id);
    if (!list) {
      settled.add(id);
      return;
    }
    path.add(id);
    for (const base of list.basedOn) walk(base, path);
    path.delete(id);
    if (!cyclic.has(id)) settled.add(id);
  };
  for (const id of listsById.keys()) walk(id, new Set());
  return cyclic;
}

/**
 * Every spell id on `listId` after the overlay: the set `resolveCatalogChoice` sees for
 * `"<listId>-spells"`. Works for a declared overlay list and for a bare tag ("wizard").
 */
export function spellListMemberIds(
  listId: string,
  lists: readonly SpellListReference[],
  spells: readonly SpellListSpell[]
): ReadonlySet<string> {
  const listsById = new Map(lists.map((list) => [list.id, list]));
  return membersOf(listId, listsById, spells, cyclicIds(listsById), new Map());
}

function membersOf(
  listId: string,
  listsById: ReadonlyMap<string, SpellListReference>,
  spells: readonly SpellListSpell[],
  cyclic: ReadonlySet<string>,
  memo: Map<string, Set<string>>
): Set<string> {
  const cached = memo.get(listId);
  if (cached) return cached;
  const members = taggedWith(spells, listId);
  memo.set(listId, members); // before recursing: a cyclic edge then reads the partial set instead of looping
  const list = listsById.get(listId);
  if (list) {
    if (!cyclic.has(listId)) {
      for (const base of list.basedOn)
        for (const id of membersOf(base, listsById, spells, cyclic, memo)) members.add(id);
    }
    const known = new Set(spells.map((spell) => spell.id));
    for (const id of list.add) if (known.has(id)) members.add(id);
    for (const id of list.remove) members.delete(id);
  }
  return members;
}

/** Resolve every declared list at once and report what a GM needs to know before publishing. */
export function resolveSpellLists(
  lists: readonly SpellListReference[],
  spells: readonly SpellListSpell[]
): SpellListResolution {
  const listsById = new Map(lists.map((list) => [list.id, list]));
  const cyclic = cyclicIds(listsById);
  const memo = new Map<string, Set<string>>();
  const memberIds = new Map<string, ReadonlySet<string>>();
  for (const list of lists) memberIds.set(list.id, membersOf(list.id, listsById, spells, cyclic, memo));

  const unknownBasedOn = new Set<string>();
  const shadowedListIds: string[] = [];
  for (const list of lists) {
    for (const base of list.basedOn) {
      if (!listsById.has(base) && taggedWith(spells, base).size === 0) unknownBasedOn.add(base);
    }
    // The id is already a live spell tag, so this overlay extends that list instead of creating one.
    if (spells.some((spell) => spell.classes.includes(list.id))) shadowedListIds.push(list.id);
  }
  return {
    memberIds,
    emptyListIds: [...memberIds].filter(([, ids]) => ids.size === 0).map(([id]) => id),
    cyclicListIds: [...cyclic].filter((id) => listsById.has(id)),
    unknownBasedOn: [...unknownBasedOn],
    shadowedListIds
  };
}

/**
 * Fold declared list membership into each spell's `classes`. Returns a new array (loaders cache their
 * parsed result, so never mutate one); with no lists it returns the input as-is.
 *
 * Call with one audience's lists only: a GM-only list stamped into a player-visible spell's `classes`
 * leaks the list's existence through the public spell catalog.
 */
export function applySpellListOverlay<T extends SpellListSpell>(
  spells: readonly T[],
  lists: readonly SpellListReference[]
): readonly T[] {
  if (lists.length === 0) return spells;
  const { memberIds } = resolveSpellLists(lists, spells);
  return spells.map((spell) => {
    // Sorted so the projected `classes` order is deterministic regardless of authoring order.
    const extra = [...memberIds]
      .filter(([id, ids]) => ids.has(spell.id) && !spell.classes.includes(id))
      .map(([id]) => id)
      .sort();
    return extra.length === 0 ? spell : { ...spell, classes: [...spell.classes, ...extra] };
  });
}
