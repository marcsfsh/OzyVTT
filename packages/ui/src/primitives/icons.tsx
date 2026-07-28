/* The design system's own SVG glyphs. No emoji anywhere in a primitive: emoji
   render differently per platform, can't take a token color, and read as decoration
   rather than UI. These are 24×24, filled with `currentColor`, and always
   aria-hidden — the control around them carries the accessible name.

   This set is deliberately tiny (only what the primitives themselves need). The
   app's richer fantasy-cartography set lives in apps/client/src/codex/icons.tsx;
   @vtt/ui must not depend on the app, so the few UI-chrome glyphs live here. */

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
  return <Glyph className={className}><path d="M9.6 16.2 5.4 12l-1.4 1.4 5.6 5.6L20.4 7.8 19 6.4z" /></Glyph>;
}

/** Disclosure caret. Points down at rest; callers rotate it when open. */
export function IconChevron({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M12 15.4 5.6 9l1.4-1.4 5 5 5-5L18.4 9z" /></Glyph>;
}

export function IconSearch({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25 1.42-1.42-4.25-4.24A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11z" />
    </Glyph>
  );
}

/** Shuffle / generate — the name generator's action. */
export function IconShuffle({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M17 4.2 21.8 8 17 11.8V9h-2.1c-1 0-1.6.4-2.4 1.5l-.9 1.3-1.3-1.7.7-1c1.2-1.7 2.4-2.4 3.9-2.4H17zM2.2 7h3.3c1.4 0 2.6.6 3.6 1.9l5 6.6c.7.9 1.2 1.2 2 1.2H17v-2.7L21.8 18 17 21.8V19h-.9c-1.5 0-2.7-.7-3.7-2l-5-6.6c-.7-.9-1.2-1.2-1.9-1.2H2.2zm0 10h3.3c.8 0 1.4-.3 2.1-1.2l.6-.8 1.3 1.7-.5.7C8 18.9 6.9 19.5 5.5 19.5H2.2z" />
    </Glyph>
  );
}

/** A die — the "roll it for me" action. */
export function IconDie({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm3.2 3.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm7.6 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm-3.8 3.8a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm-3.8 3.8a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6zm7.6 0a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z" />
    </Glyph>
  );
}

/** Pencil — "edit this section" in the review step. */
export function IconPencil({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M3 17.3 14.1 6.2l3.7 3.7L6.7 21H3zM15.5 4.8l1.7-1.7a1.2 1.2 0 0 1 1.7 0l2 2a1.2 1.2 0 0 1 0 1.7l-1.7 1.7z" />
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
      <path fillRule="evenodd" d="M12 2.6c.6 0 1.2.32 1.53.87l9 15.4A1.75 1.75 0 0 1 21 21.5H3a1.75 1.75 0 0 1-1.53-2.63l9-15.4A1.76 1.76 0 0 1 12 2.6zm-1.1 5.6v6h2.2v-6zm0 7.6v2.2h2.2v-2.2z" />
    </Glyph>
  );
}

/** Info / neutral highlight — low urgency, never an alarm. */
export function IconInfo({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.1 4.4v2.2h2.2V6.4zm0 3.9v7.3h2.2v-7.3z" />
    </Glyph>
  );
}

/* ---- Authoring glyphs (RowEditor, TagInput, and the homebrew/Codex editors).
   Added together because a repeating-row editor needs the whole set at once: add a
   row, drag it, copy it, throw it away. `IconArrow` is deliberately NOT here — the
   forward → is all-or-none across seven existing call sites and is its own pass. ---- */

/** Add — the one "make another of these" mark (RowEditor's Add, TagInput's commit). */
export function IconPlus({ className }: Readonly<{ className?: string }>) {
  return <Glyph className={className}><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" /></Glyph>;
}

/** Remove — destructive, so it is always paired with a word ("Remove action 2"). */
export function IconTrash({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M9.5 2.5h5a1 1 0 0 1 1 1V5H20v2h-1.1l-.86 12.07A2 2 0 0 1 16.05 21H7.95a2 2 0 0 1-2-1.93L5.1 7H4V5h4.5V3.5a1 1 0 0 1 1-1zm1 2.5h3V5h-3zM9.2 9l.5 9.5h1.6L10.8 9zm4 0-.5 9.5h1.6L14.8 9z" />
    </Glyph>
  );
}

/** Drag grip — the pointer affordance for reorder. Never the ONLY way to reorder:
    the row's ⋯ menu carries Move up / Move down for keyboard and touch (mobile-ux). */
export function IconDrag({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path d="M9 4.5h2.2v2.2H9zm3.8 0H15v2.2h-2.2zM9 8.9h2.2v2.2H9zm3.8 0H15v2.2h-2.2zM9 13.3h2.2v2.2H9zm3.8 0H15v2.2h-2.2zM9 17.7h2.2v2.2H9zm3.8 0H15v2.2h-2.2z" />
    </Glyph>
  );
}

/** Duplicate — "start from a copy of this one" (the create modal's second route). */
export function IconCopy({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M8 2h9a2 2 0 0 1 2 2v11h-2V4H8zM5 6h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v12h8V8z" />
    </Glyph>
  );
}

/** Visible to players. Pairs with a WORD — the palette reserves violet for GM-only,
    so visibility can never be carried by hue alone (design-language §2). */
export function IconEye({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M12 4.8c4.5 0 8.3 2.9 9.9 7.2-1.6 4.3-5.4 7.2-9.9 7.2S3.7 16.3 2.1 12C3.7 7.7 7.5 4.8 12 4.8zm0 2c-3.4 0-6.4 2-7.8 5.2 1.4 3.2 4.4 5.2 7.8 5.2s6.4-2 7.8-5.2C18.4 8.8 15.4 6.8 12 6.8zm0 1.7a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z" />
    </Glyph>
  );
}

/** GM-only / hidden from players. The slash is the state, not the colour. */
export function IconEyeOff({ className }: Readonly<{ className?: string }>) {
  return (
    <Glyph className={className}>
      <path fillRule="evenodd" d="M3.5 2.1 21.9 20.5l-1.4 1.4-3.2-3.2a11 11 0 0 1-5.3 1.3c-4.5 0-8.3-2.9-9.9-7.2A11.6 11.6 0 0 1 5.4 7.5L2.1 4.2zm3.3 6.8A9.6 9.6 0 0 0 4.2 12c1.4 3.2 4.4 5.2 7.8 5.2 1.2 0 2.4-.26 3.44-.74l-1.7-1.7a3.5 3.5 0 0 1-4.74-4.74zM12 4.8c4.5 0 8.3 2.9 9.9 7.2a11.7 11.7 0 0 1-2.53 3.86l-1.43-1.43A9.7 9.7 0 0 0 19.8 12C18.4 8.8 15.4 6.8 12 6.8c-.5 0-1 .04-1.48.13L8.85 5.25A11.3 11.3 0 0 1 12 4.8z" />
    </Glyph>
  );
}
