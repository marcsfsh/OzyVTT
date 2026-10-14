/** Immutable dot-path read/write over the authored record body. A numeric segment addresses
    an array index (`"grants.0.values"`). Writes copy only the containers on the path, so every
    object between the root and the edited leaf gets a new identity and nothing else does. */

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

/** Returns a copy of `source` with `path` set to `value`. Missing containers are created as an
    array when the next segment is numeric, otherwise as an object. */
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

    const object =
      node && typeof node === "object" && !Array.isArray(node) ? { ...(node as Record<string, unknown>) } : {};
    object[key] = last ? value : write(object[key], depth + 1);
    return object;
  };

  return write(source, 0) as T;
}

/** `setAt` for several paths in one draft identity, so one edit triggers one autosave. */
export function setAll<T>(source: T, entries: ReadonlyArray<readonly [string, unknown]>): T {
  return entries.reduce<T>((draft, [path, value]) => setAt(draft, path, value), source);
}
