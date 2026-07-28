/**
 * Spell-list membership, resolved as an OVERLAY over the generated spell bundle.
 *
 * `bundles/spells.v1.json` is written by `scripts/build-bundle.ts` from the vendored open5e
 * fixtures, so a homebrew tag hand-edited into it is destroyed by the next rebuild - and
 * editorialising a CC-BY vendored artifact is wrong on principle, not just fragile. A
 * `SpellListReference` therefore never edits a spell; it DECLARES membership, and this module folds
 * that declaration into each spell's `classes` array once, where the SRD and homebrew catalogs are
 * merged.
 *
 * Everything downstream is unchanged by construction: `resolveCatalogChoice` already resolves
 * `<listId>-spells` by filtering `classes.includes(listId)`, and `ContentSpellcasting.spellListId`
 * is already an open slug. Neither the resolver nor the ETL learns that overlays exist.
 *
 * THE MEMBERSHIP RULE, in order:
 *
 *   members(listId) = { spells already tagged `listId` in their own `classes` }
 *                   ∪ members(each id in `basedOn`)          // recursive, cycle-guarded
 *                   ∪ `add`                                   // intersected with real spell ids
 *                   \  `remove`                               // last, and absolute
 *
 * Two consequences worth stating out loud:
 *
 * 1. A wholly-homebrew list needs no `add` entries - homebrew spells tagging the list id in their
 *    own `classes` are members already. `add` exists so an SRD spell can join a homebrew list.
 * 2. `remove` scopes THIS list only. The overlay appends tags and never strips them, so
 *    `remove: ["fireball"]` on a list keeps Fireball off that list; it cannot un-tag Fireball from
 *    the SRD Wizard list, because a spell's own `classes` is the bundle's data and stays authoritative.
 *
 * EMPTINESS IS THE FAILURE THAT MATTERS. `resolveCatalogChoice` refuses to return an empty option
 * list, and the server turns that into a hard `character.create` rejection - so a caster class
 * pointed at a list with no members is not a bad picker, it is an uncreatable character. That is the
 * right fail-loud behaviour, which is exactly why it has to be caught at PUBLISH time instead:
 * `spellListMemberIds` and `SpellListResolution.emptyListIds` are the probes for it.
 */
import type { SpellListReference } from "./character-content.js";

/**
 * The minimum a spell has to look like for membership. Structural on purpose, so the same resolver
 * serves the server-side `SpellReference` record and the projected wire summary without either
 * package depending on the other.
 */
export type SpellListSpell = Readonly<{ id: string; classes: readonly string[] }>;

/** What a batch resolve found - the diagnostics a publish gate needs, computed once. */
export type SpellListResolution = Readonly<{
  /** Declared list id -> its resolved member spell ids. Only ids that exist in `spells` appear. */
  memberIds: ReadonlyMap<string, ReadonlySet<string>>;
  /** Lists that resolved to ZERO spells: publishing a caster pointed at one makes it uncreatable. */
  emptyListIds: readonly string[];
  /** Lists whose `basedOn` forms a loop. Their `basedOn` is ignored entirely; the rest still resolves. */
  cyclicListIds: readonly string[];
  /** `basedOn` ids that are neither another declared list nor a tag any spell carries - a typo, silently contributing nothing. */
  unknownBasedOn: readonly string[];
  /** Declared list ids that are ALSO an existing spell tag ("wizard"): the overlay merges into that list instead of creating one. */
  shadowedListIds: readonly string[];
}>;

/** Spell ids tagged with `listId` in their own `classes` - the bundle's own membership, before any overlay. */
function taggedWith(spells: readonly SpellListSpell[], listId: string): Set<string> {
  const out = new Set<string>();
  for (const spell of spells) if (spell.classes.includes(listId)) out.add(spell.id);
  return out;
}

/**
 * List ids that sit on a `basedOn` cycle (direct or transitive). Found up front so the membership
 * pass below can be a plain memoised recursion over a graph that is known to be acyclic - a cyclic
 * list keeps its own tagged spells and its `add`, and simply ignores `basedOn`.
 */
function cyclicIds(listsById: ReadonlyMap<string, SpellListReference>): Set<string> {
  const cyclic = new Set<string>();
  const settled = new Set<string>();
  const walk = (id: string, path: Set<string>): void => {
    if (settled.has(id)) return;
    if (path.has(id)) {
      // Only the loop itself is cyclic - a list that merely POINTS AT one keeps its own `basedOn`.
      const walked = [...path];
      for (const onLoop of walked.slice(walked.indexOf(id))) cyclic.add(onLoop);
      return;
    }
    const list = listsById.get(id);
    if (!list) { settled.add(id); return; }
    path.add(id);
    for (const base of list.basedOn) walk(base, path);
    path.delete(id);
    if (!cyclic.has(id)) settled.add(id);
  };
  for (const id of listsById.keys()) walk(id, new Set());
  return cyclic;
}

/**
 * Every spell id on `listId` after the overlay - exactly the set `resolveCatalogChoice` will see for
 * `"<listId>-spells"`. Works for a declared overlay list AND for a bare tag ("wizard"), so a publish
 * gate can ask the same question of any `spellcasting.spellListId` without caring which it is.
 *
 * An EMPTY result is the check worth making: it is a hard `character.create` rejection downstream.
 */
export function spellListMemberIds(
  listId: string, lists: readonly SpellListReference[], spells: readonly SpellListSpell[]
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
      for (const base of list.basedOn) for (const id of membersOf(base, listsById, spells, cyclic, memo)) members.add(id);
    }
    const known = new Set(spells.map((spell) => spell.id));
    for (const id of list.add) if (known.has(id)) members.add(id);
    for (const id of list.remove) members.delete(id);
  }
  return members;
}

/** Resolve every declared list at once and report what a GM needs to know before publishing. */
export function resolveSpellLists(
  lists: readonly SpellListReference[], spells: readonly SpellListSpell[]
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
    // The id was already a live spell tag, so this overlay EXTENDS that list rather than making a new
    // one - the shadowing hazard a namespaced (`hb-`) id is meant to prevent.
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
 * Fold declared list membership into each spell's `classes` - THE merge-point call. Returns a new
 * array (the bundle loaders cache their parsed result by identity, so a caller must never mutate one)
 * and leaves the input untouched. With no lists it returns the input array as-is, so the
 * no-homebrew path costs exactly what it did before.
 *
 * Call this with ONE AUDIENCE'S lists only. A GM-only list must not stamp its id into a
 * player-visible spell's `classes`, or the list's existence and its id leak through the public
 * spell catalog.
 */
export function applySpellListOverlay<T extends SpellListSpell>(
  spells: readonly T[], lists: readonly SpellListReference[]
): readonly T[] {
  if (lists.length === 0) return spells;
  const { memberIds } = resolveSpellLists(lists, spells);
  return spells.map((spell) => {
    // Sorted so the projected `classes` order is deterministic regardless of authoring order.
    const extra = [...memberIds].filter(([id, ids]) => ids.has(spell.id) && !spell.classes.includes(id)).map(([id]) => id).sort();
    return extra.length === 0 ? spell : { ...spell, classes: [...spell.classes, ...extra] };
  });
}
