import { useMemo, type ReactNode } from "react";
import {
  Combobox,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  Menu,
  FindField,
  Button,
  EmptyState,
  IconPlus,
  SideListGroup,
  SideListRow
} from "@vtt/ui";
import { countOf } from "@vtt/domain";
import { CodexIcon, pinSwatchVar } from "../icons";
import { LAYER_META, type AtlasLayer, type AtlasLayers } from "./layers";

/** The atlas's ways around and its lists, shared by the GM's and the players' atlas. */

type CrumbMap = Readonly<{ id: string; name: string }>;
type ListedPin = Readonly<{
  id: string;
  label: string | null;
  iconId: string;
  iconColor: string;
  tags: readonly string[];
  pageIds: readonly string[];
  subMapId: string | null;
  revealedToPlayers?: boolean;
  isParty?: boolean;
}>;

/** The way up: the open map's chain from its top-level map. */
export function AtlasCrumbs({
  chain,
  onEnter
}: Readonly<{ chain: readonly CrumbMap[]; onEnter: (mapId: string) => void }>) {
  return (
    <nav className="atlas-crumbs" aria-label="Map path">
      {chain.length === 0 && <span className="atlas-crumb is-current">Atlas</span>}
      {chain.map((map, index) => {
        const current = index === chain.length - 1;
        return (
          <span key={map.id} className="atlas-crumbstep">
            {index > 0 && <IconChevronRight className="atlas-crumbsep" />}
            {current ? (
              <span className="atlas-crumb is-current" aria-current="location">
                {map.name}
              </span>
            ) : (
              <button type="button" className="atlas-crumb" onClick={() => onEnter(map.id)}>
                {map.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** The same switches in a menu, for a phone's top bar. */
export function LayersMenu({
  layers,
  onToggle,
  gm
}: Readonly<{ layers: AtlasLayers; onToggle: (layer: AtlasLayer) => void; gm: boolean }>) {
  return (
    <Menu
      icon
      align="end"
      label="Layers"
      trigger={<CodexIcon iconId="compass" className="atlas-layer-icon" />}
      className="atlas-layersmenu"
    >
      {LAYER_META.filter((layer) => gm || !layer.gmOnly).map((layer) => (
        <button
          key={layer.id}
          type="button"
          role="menuitemcheckbox"
          aria-checked={layers[layer.id]}
          className="nh-menu-item atlas-layersmenu-item"
          onClick={() => onToggle(layer.id)}
        >
          <span className={`atlas-check${layers[layer.id] ? " is-on" : ""}`} aria-hidden="true" />
          {layer.label}
        </button>
      ))}
    </Menu>
  );
}

/** Filters this map's pins by text and tag; the values live in the address. */
export function PinFilter({
  pins,
  text,
  tag,
  dimmed,
  onChange
}: Readonly<{
  pins: readonly ListedPin[];
  text: string;
  tag: string | null;
  dimmed: ReadonlySet<string> | null;
  onChange: (next: Readonly<{ q?: string | null; tag?: string | null }>) => void;
}>) {
  const tags = useMemo(() => [...new Set(pins.flatMap((pin) => pin.tags))].sort(), [pins]);
  return (
    <div className="atlas-pinfilter">
      <FindField
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
        <span className="atlas-pinfilter-count" role="status">
          {pins.length - dimmed.size} of {countOf(pins.length, "pin")} match
        </span>
      )}
    </div>
  );
}

/** Every pin on the map as a table: its name, the pages it links and the map it opens. A row selects the pin. */
export function PinTable({
  pins,
  pageTitle,
  mapName,
  selectedPinId,
  dimmed,
  gm,
  onSelect,
  onAddPin
}: Readonly<{
  pins: readonly ListedPin[];
  pageTitle: (pageId: string) => string | null;
  mapName: (mapId: string) => string | null;
  selectedPinId: string | null;
  dimmed: ReadonlySet<string> | null;
  gm: boolean;
  onSelect: (pinId: string) => void;
  /** The GM's way to the first pin, offered with the empty state (theme rule 3). */
  onAddPin?: () => void;
}>) {
  if (pins.length === 0)
    return (
      <EmptyState
        className="atlas-empty"
        action={
          gm && onAddPin ? (
            <Button size="sm" onClick={onAddPin}>
              <IconPlus /> Add a pin
            </Button>
          ) : undefined
        }
      >
        No pins on this map yet.
      </EmptyState>
    );
  return (
    <table className="nh-table atlas-pintable">
      <thead>
        <tr>
          {gm && (
            <th scope="col" className="atlas-pintable-eye">
              <span className="nh-sr-only">Who sees it</span>
            </th>
          )}
          <th scope="col" className="atlas-pintable-pin">
            Pin
          </th>
          <th scope="col">Links</th>
          <th scope="col" className="atlas-pintable-opens">
            Opens
          </th>
        </tr>
      </thead>
      <tbody>
        {pins.map((pin) => {
          const links = pin.pageIds.map(pageTitle).filter((title): title is string => title !== null);
          const opens = pin.subMapId ? mapName(pin.subMapId) : null;
          const selected = pin.id === selectedPinId;
          return (
            <tr
              key={pin.id}
              className={`${selected ? "is-selected" : ""}${dimmed?.has(pin.id) ? " is-dimmed" : ""}`}
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(pin.id)}
            >
              {gm && (
                <td className="atlas-pintable-eye">
                  {pin.revealedToPlayers === false ? (
                    <span className="atlas-hiddenmark" role="img" aria-label="Hidden" title="Hidden">
                      <IconEyeOff />
                    </span>
                  ) : (
                    <span className="atlas-shownmark" role="img" aria-label="Everyone" title="Everyone">
                      <IconEye />
                    </span>
                  )}
                </td>
              )}
              <th scope="row">
                <button type="button" className="atlas-pintable-open" onClick={() => onSelect(pin.id)}>
                  <CodexIcon
                    iconId={pin.iconId}
                    className="atlas-pintable-icon"
                    style={{ color: pinSwatchVar(pin.iconColor) }}
                  />
                  <span className="atlas-ellipsis">{pin.label?.trim() || "Unlabelled pin"}</span>
                  {pin.isParty && <span className="atlas-partytag">Party</span>}
                </button>
              </th>
              <td className="atlas-ellipsis">{links.length > 0 ? links.join(", ") : "None"}</td>
              <td className="atlas-ellipsis">{opens ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

type TreeMap = Readonly<{ id: string; name: string; parentMapId: string | null; revealedToPlayers?: boolean }>;

/**
 * MAPS as a tree at the side (F3 atlas spec 2.1): every map nested under the map it sits in, each row the map icon, its
 * name and, for the open map, its pin count in VT323; the open map lit. Pressing a map opens it. A hidden map's name
 * reads violet for the GM.
 */
export function MapTree({
  maps,
  currentMapId,
  pinCount,
  gm,
  onEnter
}: Readonly<{
  maps: readonly TreeMap[];
  currentMapId: string | null;
  /** The open map's pins; the others' are not loaded, so they show none. */
  pinCount: number;
  gm: boolean;
  onEnter: (mapId: string) => void;
}>) {
  const ids = new Set(maps.map((map) => map.id));
  const kids = new Map<string | null, TreeMap[]>();
  for (const map of maps) {
    // A map whose parent is not in the list (a player cannot open it) sits at the top.
    const parent = map.parentMapId && ids.has(map.parentMapId) ? map.parentMapId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), map]);
  }
  const rows: ReactNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const map of [...(kids.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      rows.push(
        <SideListRow
          key={map.id}
          label={
            <span className={gm && map.revealedToPlayers === false ? "atlas-tree-hidden" : undefined}>{map.name}</span>
          }
          ariaLabel={map.name}
          leading={<CodexIcon iconId="compass" />}
          depth={depth}
          count={map.id === currentMapId ? pinCount : undefined}
          current={map.id === currentMapId}
          onSelect={() => onEnter(map.id)}
        />
      );
      walk(map.id, depth + 1);
    }
  };
  walk(null, 0);
  return <SideListGroup eyebrow="Maps">{rows}</SideListGroup>;
}

/** ON THE MAP: the layers as rows reading On or Off under the tree. */
export function LayerRows({
  layers,
  onToggle,
  gm
}: Readonly<{ layers: AtlasLayers; onToggle: (layer: AtlasLayer) => void; gm: boolean }>) {
  return (
    <SideListGroup eyebrow="On the map" className="atlas-layerrows">
      {LAYER_META.filter((layer) => gm || !layer.gmOnly).map((layer) => (
        <SideListRow
          key={layer.id}
          label={layer.label}
          ariaLabel={`${layer.label}: ${layers[layer.id] ? "on" : "off"}`}
          leading={layer.gmOnly ? <IconEyeOff /> : <CodexIcon iconId={layer.iconId} className="atlas-layer-icon" />}
          count={layers[layer.id] ? "On" : "Off"}
          current={layers[layer.id]}
          onSelect={() => onToggle(layer.id)}
        />
      ))}
    </SideListGroup>
  );
}

/** The maps in the tree's order (each under the one it sits in, by name), for a phone's row of chips. */
export function treeOrder<T extends TreeMap>(maps: readonly T[]): readonly T[] {
  const ids = new Set(maps.map((map) => map.id));
  const kids = new Map<string | null, T[]>();
  for (const map of maps) {
    const parent = map.parentMapId && ids.has(map.parentMapId) ? map.parentMapId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), map]);
  }
  const out: T[] = [];
  const walk = (parent: string | null) => {
    for (const map of [...(kids.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
      out.push(map);
      walk(map.id);
    }
  };
  walk(null);
  return out;
}
