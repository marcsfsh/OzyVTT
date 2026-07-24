import { type ReactNode } from "react";

/**
 * Curated map-marker icons: simple, recolorable SVG glyphs on a 0 0 24 24 grid (fill: currentColor, so
 * the marker's chosen color drives them). This is the icon SYSTEM + a starter set grouped by theme;
 * the full themed library (game-icons.net, ~4000 CC-BY glyphs via a lazy sprite sheet) drops in behind
 * the same CodexIcon/registry shape without touching callers.
 */

export const CODEX_ICONS: Readonly<Record<string, ReactNode>> = {
  pin: <path d="M12 2C8.1 2 5 5.1 5 9c0 5 7 13 7 13s7-8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />,
  town: <path d="M3 21V11l5-4 5 4v10zm11 0V13l3.5-2.5L21 13v8z" />,
  city: <path d="M3 21V8h6v13zm8 0V4h4v17zm6 0v-9h4v9z" />,
  castle: <path d="M3 21v-8h2v-3h3v3h2v-3h4v3h2v-3h3v3h2v8h-6v-4h-4v4z" />,
  tower: <path d="M8 21V6h2V3h4v3h2v15z" />,
  keep: <path d="M4 21V9l4-2 4 2 4-2 4 2v12h-6v-5h-4v5z" />,
  temple: <path d="M12 3 3 8h18zM5 10h2v8H5zm4 0h2v8H9zm4 0h2v8h-2zm4 0h2v8h-2zM3 19h18v2H3z" />,
  shop: <path d="M4 4h16l1 5H3zm1 7h14v9H5zm4 9v-5h6v5z" />,
  tavern: <path d="M5 4h11v3h2a3 3 0 0 1 0 6h-2v7H5zm11 5v2h2a1 1 0 0 0 0-2z" />,
  mountain: <path d="M2 20 9 7l4 6 2-3 5 10z" />,
  forest: <path d="M12 2 6 12h3l-3 5h5v3h2v-3h5l-3-5h3z" />,
  water: <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />,
  cave: <path d="M3 21a9 9 0 0 1 18 0z" />,
  camp: <path d="M12 4 2 20h20zm0 6-4 10h8z" fillRule="evenodd" />,
  dungeon: <path d="M6 21V9a6 6 0 0 1 12 0v12h-4v-8a2 2 0 0 0-4 0v8z" />,
  ruin: <path d="M4 20V9h2v11zm5 0V7h2v13zm5 0v-7h2v7zm5 0v-4h2v4z" />,
  bridge: <path d="M2 12a6 6 0 0 1 20 0v2h-2v-2a4 4 0 0 0-16 0v2H2zM2 16h20v2H2z" />,
  anchor: <path d="M11 4a1 1 0 1 1 2 0 1 1 0 0 1-1 1v3h3v2h-3v6.9A6 6 0 0 0 18 12h2a8 8 0 0 1-16 0h2a6 6 0 0 0 5 4.9V10H8V8h3V5A1 1 0 0 1 11 4z" />,
  treasure: <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3H3zm0 5h18v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zm8-2h2v4h-2z" />,
  star: <path d="m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />,
  road: <path d="M11 2h2v3h6l-2 3 2 3h-8v11h-2V11H5l2-3-2-3h6z" />,
  danger: <path d="M12 3 22 20H2zm-1 6h2v6h-2zm0 8h2v2h-2z" fillRule="evenodd" />,
  quest: <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 5h2v7h-2zm0 9h2v2h-2z" fillRule="evenodd" />,
  skull: <path d="M12 2a8 8 0 0 0-5 14v3a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-3a8 8 0 0 0-5-14zM9 10a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm6 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" fillRule="evenodd" />
};

export const ICON_CATEGORIES: ReadonlyArray<{ label: string; ids: readonly string[] }> = [
  { label: "Settlements", ids: ["town", "city", "castle", "tower", "keep", "temple", "shop", "tavern"] },
  { label: "Wilds", ids: ["mountain", "forest", "water", "cave", "camp"] },
  { label: "Sites", ids: ["dungeon", "ruin", "bridge", "anchor", "treasure", "star", "road"] },
  { label: "Markers", ids: ["pin", "danger", "quest", "skull"] }
];

/** Marker color palette (data values, echoing the design language's neon + support hues). */
export const MARKER_COLORS: readonly string[] = ["#FF2E9A", "#2DE2FF", "#A45CFF", "#FF2D5E", "#FFB020", "#57E39A", "#E8ECF4", "#94A3B8"];

export const DEFAULT_ICON = "pin";
export const DEFAULT_COLOR = MARKER_COLORS[0];

export function iconChildren(iconId: string): ReactNode {
  return CODEX_ICONS[iconId] ?? CODEX_ICONS[DEFAULT_ICON];
}

/** A recolorable marker glyph. Color comes from the CSS `color` of the wrapping element (currentColor). */
export function CodexIcon({ iconId, className }: Readonly<{ iconId: string; className?: string }>) {
  return <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{iconChildren(iconId)}</svg>;
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
