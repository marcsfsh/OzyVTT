import { useMemo, type ReactNode } from "react";
import { Combobox, IconChevronRight, IconEyeOff, Input, Menu, VisibilityBadge } from "@vtt/ui";
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
type ListedMap = Readonly<{ id: string; name: string; kind: string; revealedToPlayers?: boolean }>;

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

/** The layer switches as chips, for a laptop's map toolbar. */
export function LayerChips({
  layers,
  onToggle,
  gm
}: Readonly<{ layers: AtlasLayers; onToggle: (layer: AtlasLayer) => void; gm: boolean }>) {
  return (
    <div className="atlas-layers" role="group" aria-label="Layers">
      {LAYER_META.filter((layer) => gm || !layer.gmOnly).map((layer) => (
        <button
          key={layer.id}
          type="button"
          className={`atlas-layer${layer.gmOnly ? " is-gm" : ""}`}
          aria-pressed={layers[layer.id]}
          onClick={() => onToggle(layer.id)}
        >
          {layer.gmOnly ? (
            <IconEyeOff className="atlas-layer-icon" />
          ) : (
            <CodexIcon iconId={layer.iconId} className="atlas-layer-icon" />
          )}
          {layer.label}
        </button>
      ))}
    </div>
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
  onSelect
}: Readonly<{
  pins: readonly ListedPin[];
  pageTitle: (pageId: string) => string | null;
  mapName: (mapId: string) => string | null;
  selectedPinId: string | null;
  dimmed: ReadonlySet<string> | null;
  gm: boolean;
  onSelect: (pinId: string) => void;
}>) {
  if (pins.length === 0) return <p className="atlas-empty">No pins on this map yet.</p>;
  return (
    <table className="nh-table atlas-pintable">
      <thead>
        <tr>
          {gm && (
            <th scope="col" className="atlas-pintable-eye">
              <span className="nh-sr-only">Who sees it</span>
            </th>
          )}
          <th scope="col">Pin</th>
          <th scope="col">Links</th>
          <th scope="col">Opens</th>
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
                  <VisibilityBadge revealed={pin.revealedToPlayers !== false} />
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

/** The maps nested in this one, then the other top-level maps, so every map stays reachable. */
export function MapsInside({
  children,
  roots,
  currentRootId,
  gm,
  onEnter,
  footer
}: Readonly<{
  children: readonly ListedMap[];
  roots: readonly ListedMap[];
  currentRootId: string | null;
  gm: boolean;
  onEnter: (mapId: string) => void;
  footer?: ReactNode;
}>) {
  const otherRoots = roots.filter((root) => root.id !== currentRootId);
  const row = (map: ListedMap) => (
    <li key={map.id}>
      <button type="button" className="atlas-maprow" onClick={() => onEnter(map.id)}>
        <CodexIcon
          iconId={map.kind === "world" ? "compass" : map.kind === "battlemap" ? "battle" : "city"}
          className="atlas-maprow-icon"
        />
        <span className="atlas-ellipsis atlas-maprow-name">{map.name}</span>
        {gm && map.revealedToPlayers === false && (
          <span className="atlas-hiddenmark" role="img" aria-label="Hidden" title="Hidden">
            <IconEyeOff />
          </span>
        )}
        <IconChevronRight className="atlas-maprow-chevron" />
      </button>
    </li>
  );
  return (
    <div className="atlas-mapsinside">
      {children.length === 0 ? (
        <p className="atlas-empty">No maps inside this one.</p>
      ) : (
        <ul className="atlas-maplist" aria-label="Maps inside this one">
          {children.map(row)}
        </ul>
      )}
      {footer}
      {otherRoots.length > 0 && (
        <>
          <h4 className="atlas-eyebrow">Other top-level maps</h4>
          <ul className="atlas-maplist" aria-label="Other top-level maps">
            {otherRoots.map(row)}
          </ul>
        </>
      )}
    </div>
  );
}
