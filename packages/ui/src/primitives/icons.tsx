/* The design system's own SVG glyphs: 24×24, `currentColor`, always aria-hidden (the surrounding control
   carries the accessible name). Never emoji, which render per platform and can't take a token colour.
   Only what the primitives need; the app's richer set lives in apps/client/src/codex/icons.tsx.
   One line weight across the set (2.8 units on the 24-box); where a gap would close up at small sizes the gap
   wins. The Glyph wrapper owns width/height/fill; never set them per icon (a stray class rule once blew the
   set up to 1080px). */

import type { ReactNode } from "react";

function Glyph({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/** Selection tick — the single "chosen" mark across the system. */
export function IconCheck({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M3.4 13.2 9.5 19.3 20.7 7.3 18.7 5.3 9.5 15.3 5.4 11.2z" />
    </Glyph>
  );
}

/** Disclosure caret. Points down at rest; callers rotate it when open. */
export function IconChevron({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M4.9 9.8 12 16.9 19.1 9.8 17.1 7.8 12 12.9 6.9 7.8z" />
    </Glyph>
  );
}

/* The horizontal chevrons are drawn rather than rotated, so no call site picks its own transform. */

/** Back / previous. */
export function IconChevronLeft({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M14.2 4.9 7.1 12l7.1 7.1 2-2L11.1 12l5.1-5.1z" />
    </Glyph>
  );
}

/** Forward / next / "there is more this way". */
export function IconChevronRight({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M7.8 6.9 12.9 12l-5.1 5.1 2 2L16.9 12 9.8 4.9z" />
    </Glyph>
  );
}

/* Lens and handle are separate paths: the ring needs evenodd for its hole, and a bar under the same fill rule
   would punch a hole where they overlap. */
export function IconSearch({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path
        fillRule="evenodd"
        d="M10.3 2.6a7.7 7.7 0 1 0 0 15.4 7.7 7.7 0 0 0 0-15.4zm0 2.8a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8z"
      />
      <path d="M13.8 16 19.6 21.8 21.8 19.6 16 13.8z" />
    </Glyph>
  );
}

/** Shuffle / generate — the name generator's action. */
export function IconShuffle({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M2 8.8H6l8.3 9.8h2.3v-2.8h-1.1L7.2 6H2z" />
      <path d="M16.4 13.4 21.8 17.2 16.4 21z" />
      <path d="M2 18h5.2l8.3-9.8h1.1V5.4h-2.3L6 15.2H2z" />
      <path d="M16.4 3 21.8 6.8 16.4 10.6z" />
    </Glyph>
  );
}

/** A die — the "roll it for me" action. */
export function IconDie({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path
        fillRule="evenodd"
        d="M2.6 2.6h18.8v18.8H2.6zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-4 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-4 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
      />
    </Glyph>
  );
}

/** Pencil — "edit this section" in the review step. */
export function IconPencil({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      {/* Keep the gap between shaft and ferrule, or the two fuse into one wedge. */}
      <path d="M2.6 21.4 2.8 16.5 14.1 5.3 18.7 9.9 7.5 21.2z" />
      <path d="M15.5 3.9 17.3 2 22 6.7 20.1 8.5z" />
    </Glyph>
  );
}

/** Warning / blocked / incomplete / locked: the one caution mark. Replaces "⚠", which Manrope lacks and phones
    render as emoji. Takes `currentColor`, so it is `--caution` unless the caller says otherwise. */
export function IconWarning({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M12 2.1 22.9 21.4H1.1zm-1.5 6.3h3v6.6h-3zm0 8h3v3h-3z" />
    </Glyph>
  );
}

/** Info / neutral highlight — low urgency, never an alarm. */
export function IconInfo({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.5 4.2h3v3h-3zm0 4.4h3v7.4h-3z" />
    </Glyph>
  );
}

/* ---- Authoring glyphs (RowEditor, TagInput, the homebrew/Codex editors) ---- */

/** Add: the one "make another of these" mark. */
export function IconPlus({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M10.6 4.6h2.8v6h6v2.8h-6v6h-2.8v-6h-6v-2.8h6z" />
    </Glyph>
  );
}

/** Remove: destructive, so always paired with a word ("Remove action 2"). */
export function IconTrash({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path
        fillRule="evenodd"
        d="M9.2 2.2h5.6v2.6h5.8v3h-1.7l-1 13.8H6.1L5.1 7.8H3.4v-3h5.8zM9.1 9.6l.5 9.4h1.9L11 9.6zm3.9 0-.5 9.4h1.9l.5-9.4z"
      />
    </Glyph>
  );
}

/** Drag grip for reorder. Never the only way to reorder: the row's ⋯ menu has Move up / Move down. */
export function IconDrag({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      {/* Gaps between dots stay ~2.0 so eight dots don't read as two dashed bars at small sizes. */}
      <path d="M8.3 3.2h2.9v2.9H8.3zm4.6 0h2.9v2.9h-2.9zM8.3 8.1h2.9V11H8.3zm4.6 0h2.9V11h-2.9zM8.3 13h2.9v2.9H8.3zm4.6 0h2.9v2.9h-2.9zM8.3 17.9h2.9v2.9H8.3zm4.6 0h2.9v2.9h-2.9z" />
    </Glyph>
  );
}

/** Visible to players. Pairs with a word; visibility is never carried by hue alone. */
export function IconEye({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path
        fillRule="evenodd"
        d="M12 4.4c4.7 0 8.7 3 10.4 7.6-1.7 4.6-5.7 7.6-10.4 7.6S3.3 16.6 1.6 12C3.3 7.4 7.3 4.4 12 4.4zm0 2.8c-3.5 0-6.6 2-8 4.8 1.4 2.8 4.5 4.8 8 4.8s6.6-2 8-4.8c-1.4-2.8-4.5-4.8-8-4.8zm0 .8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"
      />
    </Glyph>
  );
}

/** GM-only / hidden from players; the slash is the state. The slash is a separate element over a whole lens:
    evenodd would weave it through the lens contours, and a mask would need an id that collides when two
    icons share a page. */
export function IconEyeOff({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path
        fillRule="evenodd"
        d="M12 4.4c4.7 0 8.7 3 10.4 7.6-1.7 4.6-5.7 7.6-10.4 7.6S3.3 16.6 1.6 12C3.3 7.4 7.3 4.4 12 4.4zm0 2.8c-3.5 0-6.6 2-8 4.8 1.4 2.8 4.5 4.8 8 4.8s6.6-2 8-4.8c-1.4-2.8-4.5-4.8-8-4.8zm0 .8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"
      />
      <path d="M1.5 3.7 20.1 22.3 22.3 20.1 3.7 1.5z" />
    </Glyph>
  );
}

/* ---- Chrome glyphs a primitive must not render as text (`✕`, `▶`): Manrope lacks them, so they fall back to
   a system face or emoji. ---- */

/** Dismiss. Always paired with an accessible name on the control that holds it. */
export function IconX({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M5.1 7.1 16.9 18.9 18.9 16.9 7.1 5.1zM7.1 18.9 18.9 7.1 16.9 5.1 5.1 16.9z" />
    </Glyph>
  );
}

/** Go live / play: the one "start this" mark. */
export function IconPlay({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M7.8 4.7 19.6 12 7.8 19.3z" />
    </Glyph>
  );
}

/** Forward: "this takes you there". Centred on the 24-box so it can be rotated for ← ↑ ↓. */
export function IconArrow({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M3.6 10.6h13.6v2.8H3.6z" />
      <path d="M11.6 6.6 17 12l-5.4 5.4 2 2L21 12 13.6 4.6z" />
    </Glyph>
  );
}

/** Download / export: any save-to-disk action. */
export function IconDownload({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M10.6 3.2h2.8v10h-2.8z" />
      <path d="M6.2 11.2 12 17l5.8-5.8-2-2L12 13 8.2 9.2z" />
      <path d="M3.8 18.6h16.4v2.8H3.8z" />
    </Glyph>
  );
}

/* ---- Map-tool glyphs: one drawn shape per tool, all `currentColor`, so an active tool is the same glyph in
   the accent colour. ---- */

/** Select / move: the toolbar's resting tool. */
export function IconSelect({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M5.6 2.6v17l4-4 2.5 5.4 3-1.2-2.5-5.4h6z" />
    </Glyph>
  );
}

/** Ping: the transient "look here" beacon a GM drops on the map. */
export function IconPing({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path
        fillRule="evenodd"
        d="M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2zm0 2.8a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6zm0 2.2a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z"
      />
    </Glyph>
  );
}

/** Measure: a ruler with ticks, so it can't be read as a plain bar. Tick gaps are kept wide enough not to smear
    at small sizes. */
export function IconMeasure({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path
        fillRule="evenodd"
        d="M1.6 7h20.8v10H1.6zm2.4 2.8v4.4h16V9.8h-1.3v2.6h-1.9V9.8h-1.9v2.6h-1.9V9.8h-1.9v2.6H9.2V9.8H7.3v2.6H5.4V9.8z"
      />
    </Glyph>
  );
}

/** Draw: the shape tools (rectangle, circle, cone, line) under one mark. */
export function IconDraw({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M12 2.2 19 13.2H5zM3 14.6h7.8v7.8H3zM17.7 14.2a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6z" />
    </Glyph>
  );
}

/** Fog of war: bands rather than a cloud, since it hides a rectangle of ground. Gaps keep the bands from fusing. */
export function IconFog({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M4 5.2h16v3H4zM7 10.5h13v3H7zM4 15.8h12v3H4z" />
    </Glyph>
  );
}

/** Colour: labels a choice of colour only, never what a mark means. */
export function IconColor({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path
        fillRule="evenodd"
        d="M12 2.6c-5.7 0-10.4 3.3-10.4 7.6 0 5 5.2 8.6 10.4 8.6 1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.4-.7-.4-1.1 0-1 .8-1.7 1.7-1.7h2c3.6 0 6-2.5 6-6.1 0-4.1-4.8-7.4-10.5-4.4zM7.4 12.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm3.2-4.4a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm4.8 0a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z"
      />
    </Glyph>
  );
}

/** Cleanup: clears the map's own marks (pings, measurements, drawings). Not `IconTrash`, because nothing a GM
    authored is destroyed. */
export function IconCleanup({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M17.9 2.2 21.3 5.6 14.4 12.5 11 9.1zM10.1 10 14.9 14.8l-5.6 5.6a4.4 4.4 0 0 1-3.1 1.3H2.2l2.5-2.5a2.6 2.6 0 0 0 .4-3.1z" />
    </Glyph>
  );
}

/* ---- Content marks ---- */

/** A scene: the prepared board a GM makes live. */
export function IconScene({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M2.1 6.6 21.2 3.9l.6 4.2-19.1 2.7zM2.8 11.9h18.4v9.5H2.8z" />
    </Glyph>
  );
}

/** Duplicate: "start from a copy of this one". */
export function IconCopy({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M7.6 2.2h13.2v13.2h-2.9V5.1H7.6zM3.2 6.4h13.2v15.4H3.2zm2.9 2.9v9.6h7.4V9.3z" />
    </Glyph>
  );
}

/** Legendary: a monster that breaks the turn order's rules. Always paired with a word (a lone star reads as
    "favourite"). */
export function IconStar({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M12 2.2 14.9 8l6.4 1-4.6 4.5 1.1 6.4L12 16.9l-5.8 3 1.1-6.4L2.7 9l6.4-1z" />
    </Glyph>
  );
}
