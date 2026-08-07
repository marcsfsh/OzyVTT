/* The design system's own SVG glyphs. No emoji anywhere in a primitive: emoji
   render differently per platform, can't take a token color, and read as decoration
   rather than UI. These are 24×24, filled with `currentColor`, and always
   aria-hidden — the control around them carries the accessible name.

   This set is deliberately tiny (only what the primitives themselves need). The
   app's richer fantasy-cartography set lives in apps/client/src/codex/icons.tsx;
   @vtt/ui must not depend on the app, so the few UI-chrome glyphs live here.

   WEIGHT (ruling 43). "Heavier stroke, hard corners" could not be executed as asked, because
   nothing here is stroked — there is no stroke-width to raise. The ruling is a heavier
   DRAWING instead: same shapes, still filled, but limbs thickened, silhouette corners mitred
   to points and negative space tightened. The set's line weight is 2.8 units on the 24-box,
   up from ~2.0. It is one number on purpose: a glyph set with two stroke weights reads as two
   sets. Where a counter would close up before 2.8 (Drag's dots, Fog's bands, Measure's ticks)
   the gap wins and the note on that glyph says so — a mark that fuses at 17px has failed.

   The Glyph wrapper owns width/height/fill. Never put them on an individual icon: a stray
   class rule that beats the 1em presentation attribute has already blown this set up to
   1080px once, and per-icon overrides make the next such bug asymmetric across the set. */

import type { ReactNode } from "react";

function Glyph({ children, className }: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** Selection tick — the single "chosen" mark across the system. */
export function IconCheck({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M3.4 13.2 9.5 19.3 20.7 7.3 18.7 5.3 9.5 15.3 5.4 11.2z" /></Glyph>;
}

/** Disclosure caret. Points down at rest; callers rotate it when open. */
export function IconChevron({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M4.9 9.8 12 16.9 19.1 9.8 17.1 7.8 12 12.9 6.9 7.8z" /></Glyph>;
}

/* The two horizontal chevrons are drawn rather than left to a CSS rotation of the one above. A rotated
   glyph is a per-call-site decision — every consumer picks its own transform, its own origin and its own
   whether-to-animate — and the sideways caret is the most-copied mark in the app (pagination, back,
   carousels, master-detail). One shape, one name, no transform to get wrong. */

/** Back / previous. */
export function IconChevronLeft({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M14.2 4.9 7.1 12l7.1 7.1 2-2L11.1 12l5.1-5.1z" /></Glyph>;
}

/** Forward / next / "there is more this way". */
export function IconChevronRight({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M7.8 6.9 12.9 12l-5.1 5.1 2 2L16.9 12 9.8 4.9z" /></Glyph>;
}

/* The lens and its handle are two <path> elements rather than one `d`. A filled ring needs
   evenodd to keep its hole; a bar laid across that ring under the SAME fill rule would flip
   the overlap back to a hole. Two elements, two fill rules, no interaction. */
export function IconSearch({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M10.3 2.6a7.7 7.7 0 1 0 0 15.4 7.7 7.7 0 0 0 0-15.4zm0 2.8a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8z" />
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
      <path fillRule="evenodd" d="M2.6 2.6h18.8v18.8H2.6zM8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-4 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-4 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
    </Glyph>
  );
}

/** Pencil — "edit this section" in the review step. */
export function IconPencil({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      {/* Shaft and head keep the ~2-unit ferrule gap they always had. Widening the barrel to 6.5
          without re-opening that gap fuses the two into one wedge and the pencil stops being a
          pencil — the first thing this pass got wrong. */}
      <path d="M2.6 21.4 2.8 16.5 14.1 5.3 18.7 9.9 7.5 21.2z" />
      <path d="M15.5 3.9 17.3 2 22 6.7 20.1 8.5z" />
    </Glyph>
  );
}

/** Warning / blocked / incomplete / locked — the one caution mark in the system.
    Replaces the bare "⚠" (U+26A0) the guided-flow primitives used to render: Manrope
    has no glyph for it, so it fell back to a system face at ~10px, and iOS/Android
    give it *emoji* presentation — a yellow triangle, a hue this palette does not own.
    This takes `currentColor`, so it is always `--caution` (or whatever the caller sets). */
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

/* ---- Authoring glyphs (RowEditor, TagInput, and the homebrew/Codex editors).
   Added together because a repeating-row editor needs the whole set at once: add a
   row, drag it, copy it, throw it away. ---- */

/** Add — the one "make another of these" mark (RowEditor's Add, TagInput's commit). */
export function IconPlus({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M10.6 4.6h2.8v6h6v2.8h-6v6h-2.8v-6h-6v-2.8h6z" /></Glyph>;
}

/** Remove — destructive, so it is always paired with a word ("Remove action 2"). */
export function IconTrash({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M9.2 2.2h5.6v2.6h5.8v3h-1.7l-1 13.8H6.1L5.1 7.8H3.4v-3h5.8zM9.1 9.6l.5 9.4h1.9L11 9.6zm3.9 0-.5 9.4h1.9l.5-9.4z" />
    </Glyph>
  );
}

/** Drag grip — the pointer affordance for reorder. Never the ONLY way to reorder:
    the row's ⋯ menu carries Move up / Move down for keyboard and touch (mobile-ux). */
export function IconDrag({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      {/* The dots gain weight but NOT at the expense of the gaps between them: at 17px a gap
          under ~1.4px closes up and eight dots read as two dashed bars. Squares 2.2→2.9,
          gaps held at ~2.0, and the grip grows into the box instead. */}
      <path d="M8.3 3.2h2.9v2.9H8.3zm4.6 0h2.9v2.9h-2.9zM8.3 8.1h2.9V11H8.3zm4.6 0h2.9V11h-2.9zM8.3 13h2.9v2.9H8.3zm4.6 0h2.9v2.9h-2.9zM8.3 17.9h2.9v2.9H8.3zm4.6 0h2.9v2.9h-2.9z" />
    </Glyph>
  );
}

/** Duplicate — "start from a copy of this one" (the create modal's second route). */
export function IconCopy({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M7.6 2.2h13.2v13.2h-2.9V5.1H7.6zM3.2 6.4h13.2v15.4H3.2zm2.9 2.9v9.6h7.4V9.3z" />
    </Glyph>
  );
}

/** Visible to players. Pairs with a WORD — the palette reserves violet for GM-only,
    so visibility can never be carried by hue alone (design-language §2). */
export function IconEye({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M12 4.4c4.7 0 8.7 3 10.4 7.6-1.7 4.6-5.7 7.6-10.4 7.6S3.3 16.6 1.6 12C3.3 7.4 7.3 4.4 12 4.4zm0 2.8c-3.5 0-6.6 2-8 4.8 1.4 2.8 4.5 4.8 8 4.8s6.6-2 8-4.8c-1.4-2.8-4.5-4.8-8-4.8zm0 .8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" />
    </Glyph>
  );
}

/** GM-only / hidden from players. The slash is the state, not the colour.
    The slash is its OWN element laid over a whole lens, not a fourth contour inside the lens's
    evenodd path. Tried that: evenodd alternates, so the bar knocks out across the lid and the
    pupil but prints across the counter, and the slash renders as three woven fragments. SVG has
    no way to subtract one path from another without a mask, and a mask needs an id — which
    collides the moment two of this icon share a page. A whole lens plus a solid bar it is. */
export function IconEyeOff({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M12 4.4c4.7 0 8.7 3 10.4 7.6-1.7 4.6-5.7 7.6-10.4 7.6S3.3 16.6 1.6 12C3.3 7.4 7.3 4.4 12 4.4zm0 2.8c-3.5 0-6.6 2-8 4.8 1.4 2.8 4.5 4.8 8 4.8s6.6-2 8-4.8c-1.4-2.8-4.5-4.8-8-4.8zm0 .8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z" />
      <path d="M1.5 3.7 20.1 22.3 22.3 20.1 3.7 1.5z" />
    </Glyph>
  );
}

/* ---- Chrome glyphs a primitive must not render as text (design-language §0).
   `✕` and `▶` were literal characters in Modal, Drawer and the app's atlas: Manrope
   has no glyph for either at UI weight, so they fell back to a system face at the
   wrong size and got emoji presentation on iOS/Android. ---- */

/** Dismiss. Always paired with an accessible name on the control that holds it. */
export function IconX({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M5.1 7.1 16.9 18.9 18.9 16.9 7.1 5.1zM7.1 18.9 18.9 7.1 16.9 5.1 5.1 16.9z" /></Glyph>;
}

/** Go live / play. The one "start this" mark. A solid triangle has no limb to thicken, so its
    share of the weight pass is size and nothing else — it was already among the densest marks. */
export function IconPlay({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M7.8 4.7 19.6 12 7.8 19.3z" /></Glyph>;
}

/** Forward — "this takes you there". The set carried no arrow for a long time on the grounds that the
    → is all-or-none across its call sites and half-adopting it would mix a drawn arrow with a font
    fallback on one screen. It is drawn now because the sweep that replaces every text glyph is the work
    this belongs to: the landing hero, the roster's ⇒, the sheet and the action runner all take it at
    once. Rotate it for ← ↑ ↓ (the map library's four nudges) — it is centred on the 24-box for exactly
    that. */
export function IconArrow({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M3.6 10.6h13.6v2.8H3.6z" />
      <path d="M11.6 6.6 17 12l-5.4 5.4 2 2L21 12 13.6 4.6z" />
    </Glyph>
  );
}

/** Download / export — the replay's "keep a copy", and any save-to-disk action. */
export function IconDownload({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M10.6 3.2h2.8v10h-2.8z" />
      <path d="M6.2 11.2 12 17l5.8-5.8-2-2L12 13 8.2 9.2z" />
      <path d="M3.8 18.6h16.4v2.8H3.8z" />
    </Glyph>
  );
}

/* ---- Map-tool glyphs. The map toolbar rendered its tools as emoji (✏ 👁 🌫 🎨 📍 📏 ⛌ …), which is the
   failure this whole module exists to end: emoji cannot take a token colour, render as a different
   drawing on every platform, and read as decoration in a row of controls that are anything but. One
   drawn shape per tool, all on the same 24-box, all `currentColor` — so an active tool is the SAME
   glyph in the accent colour rather than a second picture. ---- */

/** Select / move — the toolbar's resting tool, and the one every other tool returns to. */
export function IconSelect({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M5.6 2.6v17l4-4 2.5 5.4 3-1.2-2.5-5.4h6z" /></Glyph>;
}

/** Ping — "look here", the transient beacon a GM drops on the map. Rings around a point, because that
    is what it draws. */
export function IconPing({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2zm0 2.8a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6zm0 2.2a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2z" />
    </Glyph>
  );
}

/** Measure — distance in squares or feet. A ruler, ticks and all, so it cannot be read as a plain bar.
    Still four ticks, as before — they widen (1.6→1.9) but stay 1.9 apart, because a 2.8-unit frame
    eats the tick budget and a gap under ~1.3px at 17px turns four ticks into one grey smear. */
export function IconMeasure({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M1.6 7h20.8v10H1.6zm2.4 2.8v4.4h16V9.8h-1.3v2.6h-1.9V9.8h-1.9v2.6h-1.9V9.8h-1.9v2.6H9.2V9.8H7.3v2.6H5.4V9.8z" />
    </Glyph>
  );
}

/** Draw — the shape tools (rectangle, circle, cone, line) under one mark. */
export function IconDraw({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M12 2.2 19 13.2H5zM3 14.6h7.8v7.8H3zM17.7 14.2a4.3 4.3 0 1 1 0 8.6 4.3 4.3 0 0 1 0-8.6z" />
    </Glyph>
  );
}

/** Fog of war — the covered map. Banded rather than a cloud: what it hides is a rectangle of ground.
    Already hard-cornered, so this one takes weight only: bands 2.3→3.0, gaps held at 2.3 so the
    three bands never fuse into a block (ruling 38 — fog must stay unmistakable, not a mass). */
export function IconFog({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M4 5.2h16v3H4zM7 10.5h13v3H7zM4 15.8h12v3H4z" /></Glyph>;
}

/** Colour — the drawing palette. Never the only way to say what a mark means (the palette is
    colour-vision-unfriendly by design, §2), so it labels a CHOICE of colour and nothing else. */
export function IconColor({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      {/* Barely moves, and that is right: the palette is already one of the densest marks in the
          set. It gets a slightly larger body — its wells stay put, so the ink around them grows —
          and nothing else. Mitring the thumb notch would fight the one organic shape here. */}
      <path fillRule="evenodd" d="M12 2.6c-5.7 0-10.4 3.3-10.4 7.6 0 5 5.2 8.6 10.4 8.6 1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.4-.4-.7-.4-1.1 0-1 .8-1.7 1.7-1.7h2c3.6 0 6-2.5 6-6.1 0-4.1-4.8-7.4-10.5-4.4zM7.4 12.2a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm3.2-4.4a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4zm4.8 0a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z" />
    </Glyph>
  );
}

/** Cleanup — sweep the map's own marks away (pings, measurements, drawings). Distinct from `IconTrash`
    on purpose: nothing a GM authored is destroyed, so it must not wear the destructive mark. */
export function IconCleanup({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M17.9 2.2 21.3 5.6 14.4 12.5 11 9.1zM10.1 10 14.9 14.8l-5.6 5.6a4.4 4.4 0 0 1-3.1 1.3H2.2l2.5-2.5a2.6 2.6 0 0 0 .4-3.1z" />
    </Glyph>
  );
}

/* ---- Content marks: a scene, and the thing that makes a monster unusual. Both were emoji (🎬, ⭐). ---- */

/** A scene — the prepared board a GM makes live. */
export function IconScene({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      {/* The other glyph that barely moves: it was already a hard-cornered band over a box. The
          slate deepens 3.4→4.2, the body's two rounded bottom corners go square, the gap closes
          1.4→1.1. No redraw — there is nothing here that a redraw would improve. */}
      <path d="M2.1 6.6 21.2 3.9l.6 4.2-19.1 2.7zM2.8 11.9h18.4v9.5H2.8z" />
    </Glyph>
  );
}

/** Legendary — the monster that breaks the turn order's rules. Always paired with a word; a lone star
    means "favourite" to most people and that is not what this says. */
export function IconStar({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M12 2.2 14.9 8l6.4 1-4.6 4.5 1.1 6.4L12 16.9l-5.8 3 1.1-6.4L2.7 9l6.4-1z" /></Glyph>;
}
