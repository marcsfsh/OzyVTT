import { type CSSProperties, type ReactNode } from "react";
import { entityColor, entityIconId, type EntityType } from "./entities";

/**
 * Codex icon system: hand-drawn fantasy-cartography glyphs on a 0 0 24 24 grid, filled with
 * currentColor so a marker's (or an entity type's) chosen color drives them. Silhouette style, in the
 * spirit of hand-labelled fantasy maps - castles with turrets, hachured peaks, tree clusters. One
 * registry serves both the map-marker picker and the typed-entity icons (see entityIconId).
 */

export const CODEX_ICONS: Readonly<Record<string, ReactNode>> = {
  // Markers & pins
  pin: <path d="M12 2C8.1 2 5 5.1 5 9c0 5 7 13 7 13s7-8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />,
  star: <path d="m12 2 2.6 5.9 6.4.6-4.8 4.3 1.4 6.3L12 20l-5.6 3.1 1.4-6.3-4.8-4.3 6.4-.6z" />,
  flag: <><path d="M6 2h1.7v20H6z" /><path d="M7.7 3h11l-3 3.5 3 3.5h-11z" /></>,
  quest: <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v7h-2zm0 9h2v2h-2z" />,
  danger: <path fillRule="evenodd" d="M12 3 22 20H2zm-1 6h2v6h-2zm0 8h2v2h-2z" />,
  skull: <path fillRule="evenodd" d="M12 2a8 8 0 0 0-5 14v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3a8 8 0 0 0-5-14zM9 10a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 9 10zm6 0a1.6 1.6 0 1 1 0 3.2A1.6 1.6 0 0 1 15 10z" />,
  eye: <path fillRule="evenodd" d="M2 12s4-6.5 10-6.5S22 12 22 12s-4 6.5-10 6.5S2 12 2 12zm10-3.2a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z" />,
  compass: <><path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6z" /><path d="m12 6 2 6-2 6-2-6z" /></>,

  // Settlements & structures
  village: <><path d="M2 21v-5l3.4-2.6L9 16v5z" /><path d="M11 21v-6.5l4.2-3.2L20 14.5V21z" /></>,
  town: <path d="M3 21V11l4-3 4 3v2h4v-4l2.5-1.8L21 9v12z" />,
  city: <path d="M3 21V8h5v13zm7 0V4h4v17zm6 0v-8h5v8z" />,
  capital: <><path d="M3 21V9h4.5v12zm6 0V13h6v8zm7.5 0v-9H21v9z" /><path d="m12 2 1 2.3 2.5.2-1.9 1.7.6 2.5L12 7.1 9.7 8.7l.6-2.5L8.4 4.5l2.5-.2z" /></>,
  castle: <><path d="M3 21v-9h1.6v-2h2v2h1.8v-2h2v2h1.8v-2h2v2h1.8v-2h2v2H21v9h-6v-4.5h-4V21z" /><path d="M11.4 3.5h1.2V9h-1.2z" /><path d="M12.6 3.6 16.4 4.7l-3.8 1.1z" /></>,
  fort: <path d="M4 21V9h2V7h2v2h8V7h2v2h2v12h-5v-5h-6v5z" />,
  tower: <path fillRule="evenodd" d="M8 22V11H7l5-6 5 6h-1v11zm2.6-7.5v5h2.8v-5z" />,
  watchtower: <><path fillRule="evenodd" d="M9 22V10h6v12zm2 -8v5h2v-5z" /><path d="M11.4 10V4h1.2v6z" /><path d="M12.6 4 16 5l-3.4 1.2z" /></>,
  ruin: <><path d="M4 21v-9h2v9zm4 0v-7h2v7zm4 0v-9.5h2V21zm4 0v-5h2v5z" /><path d="M3 12h5v1.6H3zm8 1h6v1.6h-6z" /></>,
  temple: <><path d="M12 3 3 8v1.4h18V8z" /><path d="M5 11h2v7H5zm4 0h2v7H9zm4 0h2v7h-2zm4 0h2v7h-2z" /><path d="M3 19h18v2.4H3z" /></>,
  shrine: <><path d="M4 8h16v2H4z" /><path d="M6 6h12v1.6H6z" /><path d="M7.5 10h2.2v11H7.5zm6.8 0h2.2v11h-2.2z" /></>,
  lighthouse: <><path d="m9 22 1-13h4l1 13z" /><path d="M9 9h6v1.8H9z" /><path d="M9.7 9 12 4.5 14.3 9z" /><path d="M10.3 10.6h3.4v3h-3.4z" /></>,
  mine: <path fillRule="evenodd" d="M2 21 10 7l8 14zm7 0v-4a3 3 0 0 1 4 0v4z" />,

  // Wilds & terrain
  mountain: <path d="M1 20 7.5 8.5 11 15l3.2-5.5L23 20z" />,
  hills: <path d="M2 20a5.5 5 0 0 1 9.5-3.4 5 4.5 0 0 1 4.5-.2A5 5 0 0 1 22 20z" />,
  volcano: <path d="M2 21 8 11l1.2-.1L11 6l1.8 4.9 1.2.1L20 21h-4l-4-3-4 3z" />,
  forest: <><path d="M7 22v-3H4.2l2-2.6H4.8L7 12.6l2.2 2.8H8l2 2.6H7z" /><path d="M15.5 22v-4h-3.2l2.3-3H13l2.5-3.2L18 12h-1.6l2.3 3h-3.2v4z" /></>,
  tree: <path d="M11 22v-3H6.4l2.7-3.3H7.7L10.4 12H8.9L12 7.2l3.1 4.8h-1.5l2.7 3.7h-1.4L17.6 19H13v3z" />,
  swamp: <><path d="M2 17.5h20V19H2zm0 3h20V22H2z" /><path d="M5.2 17.5v-6h1.3v6zm3.2 0v-8h1.3v8zm6.1 0v-7h1.3v7z" /></>,
  water: <path d="M2 8.5c3-2 5 2 8 0s5-2 8 0V11c-3 2-5-2-8 0s-5 2-8 0zm0 5.5c3-2 5 2 8 0s5-2 8 0v2.5c-3 2-5-2-8 0s-5 2-8 0z" />,
  river: <path d="M4 2c2 3-2 4 0 7s2 5 0 8 0 5 0 5h3s-2-2 0-5-2-5 0-8 2-4 0-7z" />,
  island: <><path d="M2 20a10 4 0 0 1 20 0z" /><path d="M11 16v-4.5L8 9.5l3.2.6V6l.8 4 3.2-.6L12 12v4z" /></>,
  desert: <path d="M2 18a6 3.5 0 0 1 8-1 5 3.5 0 0 1 6 0 5 3 0 0 1 6 1v3.5H2z" />,
  cave: <path d="M3 21a9 8 0 0 1 18 0z" />,

  // Sites & lore
  dungeon: <path fillRule="evenodd" d="M6 21V9a6 6 0 0 1 12 0v12h-4v-8a2 2 0 0 0-4 0v8z" />,
  portal: <path fillRule="evenodd" d="M6 21V11a6 6 0 0 1 12 0v10h-2.4V11a3.6 3.6 0 0 0-7.2 0v10zm5.9-9.4a2.6 2.6 0 0 0 .1 5.2 1.9 1.9 0 0 1-.1-3.8 1.9 1.9 0 0 1 0-1.4z" />,
  henge: <><path d="M4 21V10h3v11zm6.5 0V9h3v12zm6.5 0V10h3v11z" /><path d="M3 9h8v2H3zm10 0h8v2h-8z" /></>,
  obelisk: <path d="M10.6 22 11 6l1-3 1 3 .4 16z" />,
  statue: <><path d="M8.5 22v-2h7v2z" /><path d="M10 20v-1.6h4V20z" /><path d="M12 4a2.1 2.1 0 1 1 0 4.2A2.1 2.1 0 0 1 12 4z" /><path d="M10.2 18.4 11.4 9.5h1.2l1.2 8.9z" /></>,
  graveyard: <><path d="M3.5 21v-5.5a2 2 0 0 1 4 0V21z" /><path d="M17 21v-4.5a1.6 1.6 0 0 1 3.2 0V21z" /><path d="M10 21v-7a3 3 0 0 1 6 0v7zm2-6.5h2v1.4h-2zm.4-1.8h1.2v3h-1.2z" /></>,
  battle: <><path d="M4.5 3.5 3 5l9 9 1.5-1.5zM19.5 3.5 21 5l-9 9-1.5-1.5z" /><path d="M11.5 14.5 14 17l-1 1-2.5-2.5zm1 0L10 17l1 1 2.5-2.5z" /></>,
  camp: <path fillRule="evenodd" d="M12 4 2 20h20zm0 6-4.5 10h9z" />,
  campfire: <><path d="M12 3.5c1.9 2.8 3 3.9 3 6.6a3 3 0 0 1-6 0c0-1 .5-2 1.6-3 0 1.9 1.4 1.9 1.4 0 0-1-.9-2 0-3.6z" /><path d="m3.5 20 17-2.2V19L3.5 21.5zm0-2 17 2.2v1.3L3.5 19z" /></>,
  treasure: <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3zm0 5h18v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm8-2h2v4h-2z" />,
  scroll: <path d="M6.5 3H17a1 1 0 0 1 1 1v13a3 3 0 0 1-3 3H6.5A2.5 2.5 0 0 0 9 17.5V6a3 3 0 0 0-2.5-3z" />,

  // Roads & crossings
  bridge: <path d="M2 12a6 6 0 0 1 20 0v2h-2v-2a4 4 0 0 0-16 0v2H2zM2 16h20v2H2z" />,
  gate: <path fillRule="evenodd" d="M5 21V7h2V5h10v2h2v14h-3v-8a4 4 0 0 0-8 0v8z" />,
  road: <path d="M11 2h2v3h6l-2 3 2 3h-8v11h-2V11H5l2-3-2-3h6z" />,
  anchor: <path d="M11 4a1 1 0 1 1 2 0 1 1 0 0 1-1 1v3h3v2h-3v6.9A6 6 0 0 0 18 12h2a8 8 0 0 1-16 0h2a6 6 0 0 0 5 4.9V10H8V8h3V5A1 1 0 0 1 11 4z" />,
  ship: <><path d="M4 15h16l-2.4 5H6.4z" /><path d="M11.2 3h1.2v11h-1.2z" /><path d="M13 4h5.2l-5.2 8z" /></>,

  // Entity glyphs (people, factions, items, beasts, faith, time)
  person: <><path d="M12 3.3a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z" /><path d="M5 20.6a7 7 0 0 1 14 0 1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" /></>,
  banner: <><path d="M6 2.4a1 1 0 0 1 2 0V22H6z" /><path d="M8 3.4h10.6l-3 3.3 3 3.3H8z" /></>,
  sword: <><path d="M11 2.2 13 4v9.2h-2z" /><path d="M8.2 13.2h7.6V15H8.2z" /><path d="M11 15h2v4h-2z" /><path d="M12 22.2a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z" /></>,
  dragon: <><path d="M2 21l3-4.2c-1.8-3 .2-6.9 4-7.9l2-4 1 4 3.6-1.6-1.6 3.4 3 1-3 2c.8 4.1-2.2 7-6.4 7-1 0-1.9-.3-1.9-.3z" /><path d="M13.6 5.6 18.2 3l-1.3 4.5z" /><path d="M9.4 12a1.05 1.05 0 1 0 0 2.1 1.05 1.05 0 0 0 0-2.1z" /></>,
  paw: <><path d="M12 13c2.6 0 4.6 2 4.6 4.1S14.6 22 12 22s-4.6-2.8-4.6-4.9S9.4 13 12 13z" /><path d="M6.6 8.2a1.7 2.1 0 1 0 0 4.2 1.7 2.1 0 0 0 0-4.2zm10.8 0a1.7 2.1 0 1 0 0 4.2 1.7 2.1 0 0 0 0-4.2zM9.8 4a1.5 1.9 0 1 0 0 3.8A1.5 1.9 0 0 0 9.8 4zm4.4 0a1.5 1.9 0 1 0 0 3.8A1.5 1.9 0 0 0 14.2 4z" /></>,
  hourglass: <path d="M5 2h14v1.9h-1.7L12 9.8 6.7 3.9H5zm1.7 20L12 14.2 17.3 20H19v2H5v-2z" />,
  sun: <path fillRule="evenodd" d="M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM11 1h2v3.4h-2zm0 18.6h2V23h-2zM1 11h3.4v2H1zm18.6 0H23v2h-3.4zM4.2 4.2l2.4 2.4L5.2 8 2.8 5.6zm13.2 13.2 2.4 2.4-1.4 1.4-2.4-2.4zM19.8 4.2 21.2 5.6l-2.4 2.4-1.4-1.4zM6.6 17.4 8 18.8l-2.4 2.4-1.4-1.4z" />,

  // Utility (editor toolbar + notebook tree - not in the marker picker)
  image: <path fillRule="evenodd" d="M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm2 2v7.6l3.6-3.6 3 3 2-2L20 15V6zM8.2 7.6a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z" />,
  "folder-plus": <path fillRule="evenodd" d="M4 5h4l2 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM11 11.5h2v2h2.5v3H13v2h-2v-2H8.5v-3H11z" />,
  trash: <path fillRule="evenodd" d="M10 3h4a1 1 0 0 1 1 1v1h5v2H4V5h5V4a1 1 0 0 1 1-1zM6.5 8h11l-.9 11.6a1.5 1.5 0 0 1-1.5 1.4H8.9a1.5 1.5 0 0 1-1.5-1.4zm3.5 3v7h1.4v-7zm3 0v7h1.4v-7z" />
};

/** Marker-picker groupings (a curated subset - the registry holds more, incl. entity glyphs). */
export const ICON_CATEGORIES: ReadonlyArray<{ label: string; ids: readonly string[] }> = [
  { label: "Settlements", ids: ["village", "town", "city", "capital", "castle", "fort", "tower", "watchtower"] },
  { label: "Structures", ids: ["temple", "shrine", "lighthouse", "gate", "bridge", "mine", "ruin", "obelisk"] },
  { label: "Wilds", ids: ["mountain", "hills", "volcano", "forest", "tree", "water", "river", "swamp", "island", "desert", "cave"] },
  { label: "Sites", ids: ["dungeon", "portal", "henge", "statue", "graveyard", "battle", "camp", "campfire", "treasure", "ship", "anchor", "road"] },
  { label: "Markers", ids: ["pin", "flag", "star", "quest", "danger", "skull", "eye", "compass"] }
];

/** Marker color palette (data values, echoing the design language's neon + support hues). */
export const MARKER_COLORS: readonly string[] = ["#FF2E9A", "#2DE2FF", "#A45CFF", "#FF2D5E", "#FFB020", "#57E39A", "#E8ECF4", "#94A3B8"];

export const DEFAULT_ICON = "pin";
export const DEFAULT_COLOR = MARKER_COLORS[0];

export function iconChildren(iconId: string): ReactNode {
  return CODEX_ICONS[iconId] ?? CODEX_ICONS[DEFAULT_ICON];
}

/** A recolorable glyph. Color comes from the CSS `color` of the wrapping element (currentColor). */
export function CodexIcon({ iconId, className, style }: Readonly<{ iconId: string; className?: string; style?: CSSProperties }>) {
  return <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{iconChildren(iconId)}</svg>;
}

/** The icon for a typed entity, drawn in that type's accent color - the emoji-free replacement everywhere. */
export function EntityIcon({ type, className }: Readonly<{ type: EntityType | undefined; className?: string }>) {
  return <CodexIcon iconId={entityIconId(type)} className={`codex-ent-icon${className ? ` ${className}` : ""}`} style={{ color: entityColor(type) }} />;
}

export function IconPicker({ iconId, color, onIcon, onColor }: Readonly<{ iconId: string; color: string; onIcon: (id: string) => void; onColor: (color: string) => void }>) {
  return (
    <div className="codex-iconpicker">
      <div className="codex-swatches" role="group" aria-label="Marker color">
        {MARKER_COLORS.map((swatch) => (
          <button key={swatch} type="button" className={`codex-swatch${swatch === color ? " is-active" : ""}`} style={{ color: swatch }} aria-label={`Color ${swatch}`} aria-pressed={swatch === color} onClick={() => onColor(swatch)}>
            <span className="codex-swatch-dot" />
          </button>
        ))}
      </div>
      {ICON_CATEGORIES.map((category) => (
        <div key={category.label} className="codex-icon-group">
          <div className="codex-icon-group-label">{category.label}</div>
          <div className="codex-icon-grid">
            {category.ids.map((id) => (
              <button key={id} type="button" className={`codex-icon-btn${id === iconId ? " is-active" : ""}`} style={{ color }} aria-label={id} aria-pressed={id === iconId} onClick={() => onIcon(id)}>
                <CodexIcon iconId={id} className="codex-icon-svg" />
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
