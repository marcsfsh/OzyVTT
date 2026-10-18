import { useMemo } from "react";

type TreeMap = Readonly<{ id: string; name: string; parentMapId: string | null }>;
type FilterPin = Readonly<{ id: string; label: string | null; tags: readonly string[] }>;

/** The atlas is a forest: its roots, the chain from the open map's root down to it, and its children. */
export function useMapTree<M extends TreeMap>(maps: readonly M[], currentMapId: string | null) {
  return useMemo(() => {
    const byId = new Map(maps.map((map) => [map.id, map]));
    const chain: M[] = [];
    // The guard stops a parent cycle, which the server refuses but an old backup might hold.
    for (
      let cursor = currentMapId ? byId.get(currentMapId) : undefined;
      cursor && !chain.includes(cursor);
      cursor = cursor.parentMapId ? byId.get(cursor.parentMapId) : undefined
    )
      chain.unshift(cursor);
    return {
      roots: maps.filter((map) => map.parentMapId === null),
      chain,
      children: currentMapId ? maps.filter((map) => map.parentMapId === currentMapId) : []
    };
  }, [maps, currentMapId]);
}

/** The map the atlas opens on when the address names none: where the party is, else the first top-level map. */
export function defaultMapId(maps: readonly TreeMap[], partyMapId: string | null = null): string | null {
  if (partyMapId && maps.some((map) => map.id === partyMapId)) return partyMapId;
  return maps.find((map) => map.parentMapId === null)?.id ?? maps[0]?.id ?? null;
}

/** Pins that miss the filter dim and stay on the map; null while nothing filters. */
export function useDimmedPins(
  pins: readonly FilterPin[],
  text: string,
  tag: string | null
): ReadonlySet<string> | null {
  return useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (!needle && !tag) return null;
    const matches = (pin: FilterPin) =>
      (!needle || (pin.label ?? "").toLowerCase().includes(needle) || pin.tags.some((each) => each.includes(needle))) &&
      (!tag || pin.tags.includes(tag));
    return new Set(pins.filter((pin) => !matches(pin)).map((pin) => pin.id));
  }, [pins, text, tag]);
}

/** What a map is, in words: "Regional map · inside The Sundered Coast". */
export function mapKindLine(kind: string, parentName: string | null): string {
  const kindWord = kind === "world" ? "World map" : kind === "battlemap" ? "Battle map" : "Regional map";
  return parentName ? `${kindWord} · inside ${parentName}` : kindWord;
}
