import { useMemo, type ReactNode } from "react";
import { Combobox, Input } from "@vtt/ui";
import { countOf } from "@vtt/domain";

/**
 * The atlas's ways around, shared by the GM and player atlases: the root maps, the path down to the open
 * map, the maps inside it, and the pin filter. Each takes the role's own map and pin shapes.
 */
type TreeMap = Readonly<{ id: string; name: string; parentMapId: string | null }>;
type FilterPin = Readonly<{ id: string; label: string | null; tags: readonly string[] }>;

/** The atlas is a forest: its roots, the chain from the open map's root down to it, and its children. */
export function useMapTree<M extends TreeMap>(maps: readonly M[], currentMapId: string | null) {
  return useMemo(() => {
    const byId = new Map(maps.map((map) => [map.id, map]));
    const breadcrumb: M[] = [];
    // The guard stops a parent cycle, which the server refuses but an old backup might hold.
    for (
      let cursor = currentMapId ? byId.get(currentMapId) : undefined;
      cursor && !breadcrumb.includes(cursor);
      cursor = cursor.parentMapId ? byId.get(cursor.parentMapId) : undefined
    )
      breadcrumb.unshift(cursor);
    return {
      rootMaps: maps.filter((map) => map.parentMapId === null),
      breadcrumb,
      childMaps: currentMapId ? maps.filter((map) => map.parentMapId === currentMapId) : []
    };
  }, [maps, currentMapId]);
}

/** Without this row a second root map is unreachable once you leave it. Renders nothing for one root. */
export function AtlasRoots<M extends TreeMap>({
  roots,
  currentRootId,
  onEnter,
  mark
}: Readonly<{
  roots: readonly M[];
  currentRootId: string | null;
  onEnter: (mapId: string) => void;
  /** The GM's "players can't see this map" mark. */
  mark?: (map: M) => ReactNode;
}>) {
  if (roots.length <= 1) return null;
  return (
    <nav className="codex-atlas-descend" aria-label="Top-level maps">
      <span className="codex-descend-label">Top level</span>
      {roots.map((root) => (
        <button
          key={root.id}
          type="button"
          className={`codex-descend-chip${root.id === currentRootId ? " is-current" : ""}`}
          aria-current={root.id === currentRootId ? "true" : undefined}
          onClick={() => onEnter(root.id)}
        >
          {root.name}
          {mark?.(root)}
        </button>
      ))}
    </nav>
  );
}

/** The way up. */
export function AtlasBreadcrumb({
  chain,
  currentMapId,
  onEnter
}: Readonly<{ chain: readonly TreeMap[]; currentMapId: string | null; onEnter: (mapId: string) => void }>) {
  return (
    <nav className="codex-breadcrumb" aria-label="Map path">
      {chain.length === 0 && <span className="codex-crumb is-current">Atlas</span>}
      {chain.map((map, index) => (
        <span key={map.id}>
          {index > 0 && (
            <span className="codex-crumb-sep" aria-hidden="true">
              ›
            </span>
          )}
          <button
            type="button"
            className={`codex-crumb${map.id === currentMapId ? " is-current" : ""}`}
            onClick={() => onEnter(map.id)}
          >
            {map.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

/** The way down: maps nested directly under this one. Renders nothing when there are none. */
export function AtlasChildren<M extends TreeMap>({
  maps,
  onEnter,
  mark
}: Readonly<{ maps: readonly M[]; onEnter: (mapId: string) => void; mark?: (map: M) => ReactNode }>) {
  if (maps.length === 0) return null;
  return (
    <nav className="codex-atlas-descend" aria-label="Maps within this one">
      <span className="codex-descend-label">Drill into</span>
      {maps.map((child) => (
        <button key={child.id} type="button" className="codex-descend-chip" onClick={() => onEnter(child.id)}>
          <span className="codex-descend-arrow" aria-hidden="true" />
          {child.name}
          {mark?.(child)}
        </button>
      ))}
    </nav>
  );
}

/** Pins that miss the filter dim rather than disappear; null while nothing filters. */
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

/** Filters this map's pins by text and tag; the values live in the address. */
export function PinFilter({
  pins,
  text,
  tag,
  dimmed,
  onChange
}: Readonly<{
  pins: readonly FilterPin[];
  text: string;
  tag: string | null;
  dimmed: ReadonlySet<string> | null;
  onChange: (next: Readonly<{ q?: string | null; tag?: string | null }>) => void;
}>) {
  const tags = useMemo(() => [...new Set(pins.flatMap((pin) => pin.tags))].sort(), [pins]);
  return (
    <div className="codex-atlas-filter">
      <Input
        aria-label="Filter pins"
        placeholder="Filter pins"
        value={text}
        onChange={(event) => onChange({ q: event.target.value || null })}
      />
      {tags.length > 0 && (
        <Combobox
          options={tags.map((each) => ({ id: each, label: `#${each}` }))}
          value={tag}
          onChange={(next) => onChange({ tag: next })}
          ariaLabel="Filter pins by tag"
          placeholder="Filter by tag"
        />
      )}
      {dimmed && (
        <span className="codex-atlas-filtercount" role="status">
          {pins.length - dimmed.size} of {countOf(pins.length, "pin")} match
        </span>
      )}
    </div>
  );
}
