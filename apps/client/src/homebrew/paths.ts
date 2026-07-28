/**
 * Immutable dot-path read/write over the authored record body.
 *
 * The renderer addresses fields by path (`"range.distance"`, `"spellcasting.progression"`)
 * because a `FieldDef` is DATA — it cannot close over a setter. Every write copies only
 * the containers on the path, so React sees a new identity for the draft and for every
 * object between the root and the edited leaf, and nothing else.
 *
 * A numeric segment addresses an array index (`"grants.0.values"`). Arrays are copied
 * with `slice()`, objects with a spread, so a `rows` editor holding onto a row object
 * never sees it mutated under it.
 */

const segments = (path: string): readonly string[] => path.split(".");

const isIndex = (segment: string): boolean => /^[0-9]+$/.test(segment);

export function getAt(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of segments(path)) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor)) {
      if (!isIndex(segment)) return undefined;
      cursor = cursor[Number(segment)];
    } else if (typeof cursor === "object") {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/**
 * Returns a copy of `source` with `path` set to `value`. Missing containers are
 * created — an object, unless the NEXT segment is numeric, in which case an array,
 * so `setAt(draft, "grants.0.kind", …)` on an absent `grants` mints `[{ kind }]`
 * rather than `{ "0": { kind } }`.
 */
export function setAt<T>(source: T, path: string, value: unknown): T {
  const keys = segments(path);

  const write = (node: unknown, depth: number): unknown => {
    const key = keys[depth];
    const last = depth === keys.length - 1;

    if (isIndex(key)) {
      const index = Number(key);
      const array = Array.isArray(node) ? node.slice() : [];
      array[index] = last ? value : write(array[index], depth + 1);
      return array;
    }

    const object = node && typeof node === "object" && !Array.isArray(node) ? { ...(node as Record<string, unknown>) } : {};
    object[key] = last ? value : write(object[key], depth + 1);
    return object;
  };

  return write(source, 0) as T;
}

/** `setAt` for several paths at once, so one edit that touches two fields is ONE
    draft identity and therefore one autosave, not two racing ones. */
export function setAll<T>(source: T, entries: ReadonlyArray<readonly [string, unknown]>): T {
  return entries.reduce<T>((draft, [path, value]) => setAt(draft, path, value), source);
}
