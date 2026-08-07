import { type CSSProperties, type ReactNode } from "react";
import { entityColor, entityIconId, type EntityType } from "./entities";

/**
 * Codex icon system: hand-drawn fantasy-cartography glyphs on a 0 0 24 24 grid, filled with
 * currentColor so a marker's (or an entity type's) chosen color drives them. Silhouette style, in the
 * spirit of hand-labelled fantasy maps - castles with turrets, hachured peaks, tree clusters. One
 * registry serves both the map-marker picker and the typed-entity icons (see entityIconId).
 *
 * WEIGHT (ruling 43). Same pass as `@vtt/ui`'s chrome set - heavier drawing, not a heavier stroke,
 * because nothing here is stroked either. This set keeps its OWN register: it is a finer, more
 * detailed cartographer's hand and converting it to the chrome set's weight would make it the chrome
 * set. So the rule here is a FLOOR rather than a single line weight - no structural limb below ~2.4
 * units, where the old drawings ran as thin as 1.0. That floor is a legibility fix as much as a
 * weight one: entity glyphs render at ~10.9px, where 1 unit is 0.45px and a 1-unit limb is a grey
 * ghost. Masses (mountain, desert, cave, town, treasure) were already dense and barely move.
 */

export const CODEX_ICONS: Readonly<Record<string, ReactNode>> = {
  // Markers & pins
  pin: <path fillRule="evenodd" d="M12 1.4C7.6 1.4 4.2 4.8 4.2 9.2c0 5.4 7.8 13.4 7.8 13.4s7.8-8 7.8-13.4c0-4.4-3.4-7.8-7.8-7.8zm0 10.2A2.4 2.4 0 1 1 12 6.8a2.4 2.4 0 0 1 0 4.8z" />,
  star: <path d="M12 1.8 15 7.9 21.7 8.8 16.9 13.6 18 20.3 12 17.1 6 20.3 7.1 13.6 2.3 8.8 9 7.9z" />,
  flag: <><path d="M5.4 2h2.8v20H5.4z" /><path d="M8.2 2.8h11.2l-3.2 3.8 3.2 3.8H8.2z" /></>,
  quest: <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 4.6h3v7.2h-3zm0 8.6h3v3h-3z" />,
  danger: <path fillRule="evenodd" d="M12 2.4 22.8 20.8H1.2zm-1.5 6.4h3v6.4h-3zm0 7.8h3v3h-3z" />,
  skull: <path fillRule="evenodd" d="M12 1.6a8.4 8.4 0 0 0-5.2 14.8V20h10.4v-3.6A8.4 8.4 0 0 0 12 1.6zM8.8 9.6a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zm6.4 0a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8z" />,
  eye: <path fillRule="evenodd" d="M1.6 12s4.2-7 10.4-7S22.4 12 22.4 12s-4.2 7-10.4 7S1.6 12 1.6 12zm10.4-3.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />,
  compass: <><path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 3a7 7 0 1 1 0 14 7 7 0 0 1 0-14z" /><path d="m12 5.4 2.6 6.6-2.6 6.6-2.6-6.6z" /></>,

  // Settlements & structures
  village: <><path d="M1.6 21.4v-5.6l3.8-3 3.8 3v5.6z" /><path d="M10.6 21.4v-7.2l4.6-3.6 5.2 3.6v7.2z" /></>,
  town: <path d="M2.6 21.4V10.6l4.4-3.4 4.4 3.4v2.2h4V8.6l2.7-2 3.3 2v12.8z" />,
  city: <path d="M2.4 21.4V7.6h5.6v13.8zm7.8 0V3.4h4v18zm6.2 0v-8.6h5.2v8.6z" />,
  capital: <><path d="M2.6 21.4V8.6h5v12.8zm6.6 0v-8.4H15v8.4zm7.4 0v-9.6h4.8v9.6z" /><path d="M12 .8 13.3 3.4 16.2 3.8 14.1 5.9 14.6 8.8 12 7.4 9.4 8.8 9.9 5.9 7.8 3.8 10.7 3.4z" /></>,
  castle: <><path d="M2.3 21.4v-9.6h1.8V9.4h2.6v2.4h1.8V9.4h2.6v2.4h1.8V9.4h2.6v2.4h1.8V9.4h2.6v2.4h1.8v9.6h-7.9v-4.8h-3.6v4.8z" /><path d="M11 2.4h2.4v6.8H11z" /><path d="M13.4 2.6 17.6 3.9 13.4 5.4z" /></>,
  fort: <path d="M3.6 21.4V8.6h2.6V6.2h2.6v2.4h6.4V6.2h2.6v2.4h2.6v12.8h-5.4v-5.4h-6.4v5.4z" />,
  tower: <path fillRule="evenodd" d="M7.6 22.4V10.6H6.4L12 4l5.6 6.6h-1.2v11.8zm2.6-7.6v5.2h3.2v-5.2z" />,
  watchtower: <><path fillRule="evenodd" d="M8.4 22.4V9.6h7.2v12.8zm2.4-7.8v5.2h2.4v-5.2z" /><path d="M10.8 9.6V2.8h2.4v6.8z" /><path d="M13.2 3 17.4 4.3l-4.2 1.5z" /></>,
  ruin: <><path d="M3.4 21.4v-9.8h2.8v9.8zm4.6 0v-7.6h2.8v7.6zm4.6 0v-10.2h2.8v10.2zm4.6 0V16h2.8v5.4z" /><path d="M2.4 11.6h6.6v2.2H2.4zm9.2 1h6.6v2.2h-6.6z" /></>,
  temple: <><path d="M12 2.4 2.4 7.8v2.2h19.2V7.8z" /><path d="M4 10.6h2.8v7.6H4zm4.4 0h2.8v7.6H8.4zm4.4 0h2.8v7.6h-2.8zm4.4 0H20v7.6h-2.8z" /><path d="M2.4 18.8h19.2v2.8H2.4z" /></>,
  shrine: <><path d="M3.4 7.6h17.2v2.8H3.4z" /><path d="M5.6 4.8h12.8v2.2H5.6z" /><path d="M7 10.4h3v11.2H7zm7 0h3v11.2h-3z" /></>,
  lighthouse: <><path d="m8.6 22.4 1.1-13.4h4.6l1.1 13.4z" /><path d="M8.4 8.6h7.2v2.4H8.4z" /><path d="M9.3 8.6 12 3.6l2.7 5z" /><path d="M10 11.2h4v3.4h-4z" /></>,
  mine: <path fillRule="evenodd" d="M1.4 21.4 10 6.2l8.6 15.2zm7.2 0v-4.4a3.2 3.2 0 0 1 4.4 0v4.4z" />,

  // Wilds & terrain
  mountain: <path d="M0.8 20.6 7.4 7.8 11.1 15l3.4-5.9 8.7 11.5z" />,
  hills: <path d="M1.6 20.6a5.9 5.4 0 0 1 10-3.7 5.4 4.9 0 0 1 4.8-.2 5.4 5.4 0 0 1 5.9 3.9z" />,
  volcano: <path d="M1.4 21.4 7.7 10.6l1.4-.1L11 5.2l1.9 5.3 1.4.1 6.3 10.8h-4.4L12 17.8l-4.2 3.6z" />,
  forest: <><path d="M5.7 22.4v-3.4H3.2l2.2-2.9H4l2.9-3.8 2.9 3.8H8.6l2.2 2.9H8.1v3.4z" /><path d="M14.6 22.4v-3.8h-3.4l2.6-3.4h-1.6l3.7-4.8 3.7 4.8h-1.6l2.6 3.4h-3.4v3.8z" /></>,
  tree: <path d="M10.5 22.4v-3.6H5.6l3-3.8H7.2l3-4H8.6L12 5.6l3.4 5.4h-1.6l3 4h-1.4l3 3.8h-4.9v3.6z" />,
  swamp: <><path d="M1.6 16.8h20.8v2.2H1.6zm0 3.8h20.8v2.2H1.6z" /><path d="M4.8 16.8v-6.6h2.6v6.6zm4.6 0V8h2.6v8.8zm5.6 0V9.2h2.6v7.6z" /></>,
  water: <path d="M1.6 8c3.2-2.2 5.4 2.2 8.6 0s5.4-2.2 8.6 0v3.4c-3.2 2.2-5.4-2.2-8.6 0s-5.4 2.2-8.6 0zm0 6c3.2-2.2 5.4 2.2 8.6 0s5.4-2.2 8.6 0v3.4c-3.2 2.2-5.4-2.2-8.6 0s-5.4 2.2-8.6 0z" />,
  river: <path d="M3.4 2c2 3-2 4 0 7s2 5 0 8 0 5 0 5h4.2s-2-2 0-5-2-5 0-8 2-4 0-7z" />,
  island: <><path d="M1.6 20.4a10.4 4.4 0 0 1 20.8 0z" /><path d="M10.8 16.4V12L6.8 9.2l4.4 1V5l1.6 5.2 4.4-1-4 2.8v4.4z" /></>,
  desert: <path d="M1.6 17.6a6.2 3.7 0 0 1 8.4-1 5.2 3.7 0 0 1 6.2 0 5.2 3.2 0 0 1 6.2 1v4H1.6z" />,
  cave: <path d="M2.6 21.4a9.4 8.6 0 0 1 18.8 0z" />,

  // Sites & lore
  dungeon: <path fillRule="evenodd" d="M5.4 21.4V9a6.6 6.6 0 0 1 13.2 0v12.4H14v-8.2a2 2 0 0 0-4 0v8.2z" />,
  portal: <path fillRule="evenodd" d="M5.4 21.4V11a6.6 6.6 0 0 1 13.2 0v10.4h-3.2V11a3.4 3.4 0 0 0-6.8 0v10.4zM11.6 11.4a3 3 0 0 0 .2 6 2.1 2.1 0 0 1-.2-4.2 2.1 2.1 0 0 1 0-1.8z" />,
  henge: <><path d="M3.6 21.4V9.6h3.6v11.8zm6.6 0V8.4h3.6v13zm6.6 0V9.6h3.6v11.8z" /><path d="M2.6 8.4h9v2.8h-9zm9.8 0h9v2.8h-9z" /></>,
  obelisk: <path d="M9.9 22.4 10.5 6 12 2.6l1.5 3.4.6 16.4z" />,
  statue: <><path d="M8 22.4v-2.6h8v2.6z" /><path d="M9.6 19.8v-2.2h4.8v2.2z" /><path d="M12 3.4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" /><path d="M9.4 17.6 11.1 9h1.8l1.7 8.6z" /></>,
  /* The cross was a second contour in the same nonzero path as the headstone, wound the same way, so
     it had always painted stone-on-stone and never rendered. evenodd makes it the counter it was
     drawn to be - the one shape change in this pass, and it is a fix, not a redraw. */
  graveyard: <><path d="M2.8 21.4v-5.9a2.4 2.4 0 0 1 4.8 0v5.9z" /><path d="M16.6 21.4v-4.9a2 2 0 0 1 4 0v4.9z" /><path fillRule="evenodd" d="M9.6 21.4V14a3.4 3.4 0 0 1 6.8 0v7.4zm2.2-6.8h2.4v1.8h-2.4zm.5-2.1h1.4v3.4h-1.4z" /></>,
  /* The two hilt crosses were left as hairlines while the blades carried the weight, and at 17px the
     glyph collapsed to a bare V. They now match the blades exactly (3.1u), which is what made this
     the weakest read in the set rather than anything about the blades. */
  battle: <><path d="M5 2.8 2.8 5l9.2 9.2 2.2-2.2zM19 2.8 21.2 5 12 14.2l-2.2-2.2z" /><path d="M11.2 14.4 14.6 17.8l-2.2 2.2-3.4-3.4zm1.6 0-3.4 3.4 2.2 2.2 3.4-3.4z" /></>,
  camp: <path fillRule="evenodd" d="M12 3.2 1.2 20.8h21.6zm0 6.4-5 11.2h10z" />,
  campfire: <><path d="M12 2.8c2.2 3.2 3.5 4.5 3.5 7.6a3.5 3.5 0 0 1-7 0c0-1.2.6-2.3 1.9-3.5 0 2.2 1.6 2.2 1.6 0 0-1.2-1-2.3 0-4.1z" /><path d="m3 20.2 18-2.4v2.6L3 22.8zm0-2.6 18 2.4v2.6L3 20.2z" /></>,
  treasure: <path fillRule="evenodd" d="M2.6 5.6h18.8v5.4H2.6zm0 6.8h18.8v8H2.6zM10.6 10.2h2.8v4.6h-2.8z" />,
  scroll: <path d="M6 2.6h11.4a1 1 0 0 1 1 1v13.6a3.2 3.2 0 0 1-3.2 3.2H6a2.7 2.7 0 0 0 2.7-2.7V5.6A3 3 0 0 0 6 2.6z" />,

  // Roads & crossings
  bridge: <path d="M1.6 12.4a6.4 6.4 0 0 1 20.8 0v2.2h-2.8v-2.2a3.6 3.6 0 0 0-15.2 0v2.2H1.6zM1.6 16.4h20.8v2.8H1.6z" />,
  gate: <path fillRule="evenodd" d="M4.4 21.4V6.6H7V4.2h10v2.4h2.6v14.8H16v-8.2a4 4 0 0 0-8 0v8.2z" />,
  road: <path d="M10.6 2h3v3h6.6l-2.4 3.2 2.4 3.2h-8.6v11h-3V11.4H4.8l2.4-3.2L4.8 5h5.8z" />,
  anchor: <path d="M10.5 3.9a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-1.5 1.5h1.5v2.2h2.9v2.8h-2.9v6.6A6 6 0 0 0 17.6 12h2.8a8.8 8.8 0 0 1-17.6 0h2.8a6 6 0 0 0 4.9 5.3V10.4H7.6V7.6h2.9V5.4z" />,
  ship: <><path d="M3.4 14.6h17.2l-2.6 5.6H6z" /><path d="M10.7 2.6h2.6v11.2h-2.6z" /><path d="M13.3 3.4h5.8l-5.8 8.8z" /></>,

  // Entity glyphs (people, factions, items, beasts, faith, time)
  person: <><path d="M12 2.8a3.9 3.9 0 1 0 0 7.8 3.9 3.9 0 0 0 0-7.8z" /><path d="M4.4 21.4a7.6 7.6 0 0 1 15.2 0z" /></>,
  banner: <><path d="M5.2 2.4h3v20h-3z" /><path d="M8.2 3h11.2l-3.2 3.9 3.2 3.9H8.2z" /></>,
  sword: <><path d="M10.5 2 13.5 4.4v8.6h-3z" /><path d="M7.6 13h8.8v2.6H7.6z" /><path d="M10.6 15.6h2.8V19h-2.8z" /><path d="M12 22.8a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8z" /></>,
  dragon: <><path d="M1.6 21.4 4.8 16.9c-1.9-3.2.2-7.4 4.3-8.5l2.1-4.3 1.1 4.3 3.9-1.7-1.7 3.7 3.2 1.1-3.2 2.1c.9 4.4-2.4 7.5-6.9 7.5-1.1 0-2-.3-2-.3z" /><path d="M13.4 5.4 18.6 2.4l-1.5 5.1z" /><path d="M9.3 11.7a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z" /></>,
  paw: <><path d="M12 12.6c2.9 0 5.1 2.2 5.1 4.5S14.9 22.4 12 22.4s-5.1-3-5.1-5.3 2.2-4.5 5.1-4.5z" /><path d="M6.2 7.8a2 2.4 0 1 0 0 4.8 2 2.4 0 0 0 0-4.8zm11.6 0a2 2.4 0 1 0 0 4.8 2 2.4 0 0 0 0-4.8zM9.7 3.4a1.8 2.2 0 1 0 0 4.4 1.8 2.2 0 0 0 0-4.4zm4.6 0a1.8 2.2 0 1 0 0 4.4 1.8 2.2 0 0 0 0-4.4z" /></>,
  hourglass: <path d="M4.4 2h15.2v2.8h-2L12 10.6 6.4 4.8h-2zM6.4 19.6 12 13.8l5.6 5.8h2v2.8H4.4v-2.8z" />,
  sun: <path fillRule="evenodd" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM10.6 1h2.8v3.6h-2.8zm0 18.4h2.8V23h-2.8zM1 10.6h3.6v2.8H1zm18.4 0H23v2.8h-3.6zM4 3.4 6.7 6.1 4.7 8.1 2 5.4zm13.3 12.5L20 18.6l-2 2-2.7-2.7zM20 3.4 22 5.4l-2.7 2.7-2-2zM6.7 17.9l2 2L6 22.6l-2-2z" />,

  // Sidebar navigation (D1). Silhouette style like the rest, on the same 0 0 24 24 grid, so a nav item
  // and a marker glyph never read as two icon systems.
  home: <path d="M12 2 1.8 11.2l1.9 2.1 1.1-1V22h5.4v-6.4h3.6V22h5.4v-9.7l1.1 1 1.9-2.1z" />,
  graph: <><path d="M5.8 3.6a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zm12.4 0a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4zM12 13.8a3.2 3.2 0 1 1 0 6.4 3.2 3.2 0 0 1 0-6.4z" /><path d="m7.2 8.3 4.3 6.3-2.2 1.5-4.3-6.3zm9.6 0 2.2 1.5-4.3 6.3-2.2-1.5zM8.4 5.5h7.2v2.6H8.4z" /></>,
  /* The two ruled lines were their own <path> over a filled page in the same colour, so like the
     graveyard's cross they had never been visible. Folded into the page's own evenodd path, they
     are counters. */
  sessions: <><path fillRule="evenodd" d="M3.6 3.6h13.8v17.2H3.6zm3 3.6h7.2v2.4H6.6zm0 3.8h7.2v2.4H6.6z" /><path d="M18.2 6h2.8v16.4h-2.8z" /></>,
  book: <path fillRule="evenodd" d="M3 3.2h6.4a3.2 3.2 0 0 1 2.6 1.1 3.2 3.2 0 0 1 2.6-1.1H21v16.6h-6.4a1.6 1.6 0 0 0-1.4.9h-2.4a1.6 1.6 0 0 0-1.4-.9H3zm2.8 2.8v11h4a3.2 3.2 0 0 1 1 .2V7.6a1.8 1.8 0 0 0-1.2-1.6zm12.4 0h-3.8A1.8 1.8 0 0 0 13.2 7.6v9.6a3.2 3.2 0 0 1 1-.2h4z" />,
  calendar: <path fillRule="evenodd" d="M6.6 1.8h2.8v2.4h5.2V1.8h2.8v2.4h3.2v17.6H3.4V4.2h3.2zM6.2 9.6V19h11.6V9.6zm1.4 1.6h3.6v3.6H7.6zm5.2 0h3.6v3.6h-3.6z" />,
  archive: <path fillRule="evenodd" d="M2.6 3.6h18.8v4.8H2.6zm1.6 6h15.6v11.8H4.2zm4.6 2.6h6.4v2.6H8.8z" />,
  gear: <path fillRule="evenodd" d="m11.3 2.2-.4 2.6a8.7 8.7 0 0 0-2 1.1L5.2 3.9 3.2 7.4l2.1 1.7a8.7 8.7 0 0 0 0 2.3L3.2 13l2 3.5 2.5-.9a8.7 8.7 0 0 0 2 1.1l.4 2.6h3.7l.4-2.6a8.7 8.7 0 0 0 2-1.1l2.5.9 2-3.5-2.1-1.6a8.7 8.7 0 0 0 0-2.3l2.1-1.7-2-3.5-2.5.9a8.7 8.7 0 0 0-2-1.1L13.9 1zM12 8.3a3.7 3.7 0 1 1 0 7.5 3.7 3.7 0 0 1 0-7.5z" />,
  mask: <path fillRule="evenodd" d="M12 1.9c4.5 0 9 1.2 9 2.9 0 5.6-1.6 10.3-4.8 13.3A6.2 6.2 0 0 1 12 19.8a6.2 6.2 0 0 1-4.1-1.7C4.6 15.1 3 10.4 3 4.8 3 3.2 7.5 1.9 12 1.9zM8 8a1.8 2.1 0 1 0 0 4.3A1.8 2.1 0 0 0 8 8zm8.1 0a1.8 2.1 0 1 0 0 4.3 1.8 2.1 0 0 0 0-4.3zM9.2 14.9h5.6a2.9 2.9 0 0 1-5.6 0z" />,
  menu: <path d="M3 5h18v3H3zm0 5.5h18v3H3zm0 5.5h18v3H3z" />,
  /* The sidebar's Search entry and the phone top bar's search button both used to draw the EYE — the
     glyph this product uses for visibility, and the same one "Reveal audit" carries two groups below.
     The path is `@vtt/ui`'s own `IconSearch`, kept here because this registry is what CodexIcon reads. */
  search: <><path fillRule="evenodd" d="M10.3 2.6a7.7 7.7 0 1 0 0 15.4 7.7 7.7 0 0 0 0-15.4zm0 2.8a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8z" /><path d="M13.8 16 19.6 21.8 21.8 19.6 16 13.8z" /></>,

  // Utility (editor toolbar + notebook tree - not in the marker picker)
  image: <path fillRule="evenodd" d="M2.6 3.6h18.8v16.8H2.6zm2.8 2.8v10l4.2-4.2 3.4 3.4 2.3-2.3 3.3 3.3V6.4zM8 8.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z" />,
  "folder-plus": <path fillRule="evenodd" d="M3.4 4.4h5l2.4 2.4h9.8v13.8H3.4zm7.2 6.4h2.8v2.8h3v2.8h-3v2.8h-2.8v-2.8h-3v-2.8h3z" />,
  trash: <path fillRule="evenodd" d="M9.6 2.6h4.8V5H20v2.8H4V5h5.6zM6 8.6h12l-1 12.8H7zm3.9 2.8v7.2h1.9v-7.2zm3.2 0v7.2h1.9v-7.2z" />
};

/** Pin-picker groupings (a curated subset - the registry holds more, incl. entity glyphs). */
export const ICON_CATEGORIES: ReadonlyArray<{ label: string; ids: readonly string[] }> = [
  { label: "Settlements", ids: ["village", "town", "city", "capital", "castle", "fort", "tower", "watchtower"] },
  { label: "Structures", ids: ["temple", "shrine", "lighthouse", "gate", "bridge", "mine", "ruin", "obelisk"] },
  { label: "Wilds", ids: ["mountain", "hills", "volcano", "forest", "tree", "water", "river", "swamp", "island", "desert", "cave"] },
  { label: "Sites", ids: ["dungeon", "portal", "henge", "statue", "graveyard", "battle", "camp", "campfire", "treasure", "ship", "anchor", "road"] },
  { label: "Symbols", ids: ["pin", "flag", "star", "quest", "danger", "skull", "eye", "compass"] }
];

/**
 * D25: the pin palette the picker OFFERS is tokenized (`--pin-1 … --pin-8` in `design-tokens.css`), so
 * the light theme can darken them for contrast without eight hex values living in a component.
 *
 * Pin colour persistence stays **hex on the wire** — the server stores `#rrggbb` and no API changed — so
 * `MARKER_COLORS` remains the list of stored values and `pinSwatchVar` is how a swatch paints itself. An
 * already-stored hex outside this list still renders as itself; only the offered palette is tokenized.
 */
export const MARKER_COLORS: readonly string[] = ["#FF2E9A", "#2DE2FF", "#A45CFF", "#FF2D5E", "#FFB020", "#57E39A", "#E8ECF4", "#94A3B8"];
/** The token that paints a palette colour, or the raw stored value for a colour outside the palette. */
export function pinSwatchVar(color: string): string {
  const index = MARKER_COLORS.indexOf(color);
  return index === -1 ? color : `var(--pin-${index + 1})`;
}

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
      {/* §4 route 2: 32px paint + `.tap-target`, gapped by `--space-3` (6px overhang each side — the
          budget the design language's worked example uses for exactly this shape). */}
      <div className="codex-swatches" role="group" aria-label="Pin colour">
        {MARKER_COLORS.map((swatch, index) => (
          <button key={swatch} type="button" className={`codex-swatch tap-target${swatch === color ? " is-active" : ""}`} style={{ color: pinSwatchVar(swatch) }} aria-label={`Colour ${index + 1}`} aria-pressed={swatch === color} onClick={() => onColor(swatch)}>
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
