# Mobile / responsive UX

**Read this when:** doing any UI work. Phone and laptop have **full functional parity** —
there is no reduced mobile mode, and a mouse-only control is a bug.

## Key files

- Responsive rules live in the stylesheet next to the surface they govern
  (`apps/client/src/**/*.css`) and in the shared tokens (`packages/ui/src/styles/`). There is
  no central responsive stylesheet, and adding one is not the fix.
- Gesture logic: `apps/client/src/scene/EncounterMap.tsx` (the encounter pointer gesture state
  machine: pan / token / measure via `setPointerCapture`) and
  `apps/client/src/codex/MapSurface.tsx` (the Codex atlas pan/zoom surface, same
  `imagePointFromClient` convention).
- Decision record: `docs/adr/0014-device-support.md`.

## Responsive conventions

- **Breakpoints are a shared ladder, not per-file taste.** The ladder is defined once in
  `design-language.md`. A new number in a new stylesheet makes two components change shape at
  widths a few dozen pixels apart for no reason — reuse a rung or change the ladder
  deliberately. The viewer is the deliberate exception: it reflows on **orientation**
  (`@media (max-aspect-ratio: 4/3)` moves the initiative rail from a side column to a bottom
  strip), because a TV is a landscape device and width tells you nothing about it.
- **Fluid sizing** via `clamp()` for type/spacing/canvas height; narrow layouts collapse
  grids to `1fr`. `body { min-width: 320px }` is the supported floor.
- `prefers-reduced-motion: reduce` disables ping/pulse animations.
- The shipping map surface is SVG, and it stays crisp with
  `vector-effect: non-scaling-stroke` rather than a device-pixel-ratio setting.

## Constraints

- ADR-014 (with ADR-001) mandates **full phone+laptop functional parity** — no separate
  mobile build; one responsive React/Vite client, every action hitting the same server
  command handlers regardless of device.
- **Touch drag for tokens and grid calibration must work via Pointer Events** from the
  start — not an afterthought.
- **Any new draggable/zoomable surface MUST set `touch-action: none`** so native
  scroll/zoom doesn't fight the gesture handlers. Grep the property to find the existing
  ones rather than trusting a list here.

## Gotchas

- `viewer.css` is shared by the standalone viewer **and** the GM in-tab preview — the
  viewer entry's page reset stays isolated in `viewer-page.css` (imported only by
  `viewer-main.tsx`); the SPA's own lock lives in `apps/client/src/styles.css` (`body`
  lock + the `<main>` grid frame). Keep the two resets separate.
- Keyboard safety under the locked shell: a `focusin` helper in `apps/client/src/main.tsx`
  nudges the focused field into view within its own scrolling region, and regions carry
  `scroll-padding` + safe-area bottoms (`.pane-stage`; the wizard layer's own padding).
  Verified in emulation only — the physical-device pass is still GAP-001.
- Token name labels are hidden `@media (max-width:560px)`.
- The map toolbar (`apps/client/src/scene/MapToolbar.tsx`) collapses at that same 560 rung, but in
  **JS** (`matchMedia`), not CSS — the phone form is a different tree (one `Tools` button opening a
  vertical rail), not the wide bar restyled. Change the rung in both places or neither.
- Its group labels (Draw / Fog / View) are visible text at every width **on purpose**: a phone has
  no hover, so a control whose name lives only in a `title` has no name. Tooltips are supplementary.
- No `browserslist` / Vite `build.target` is pinned (baseline = Vite 6 modern-ESM default);
  a degraded-browser fallback UI and a physical iOS/Android acceptance pass **do not exist
  yet** (BUILD_PLAN GAP-001) — don't claim device coverage you haven't run.
- "Enlarge map" is an in-tab overlay, separate from the OS Fullscreen API (both exist).

## Relevant ADRs

`0014` (device support — primary), `0001` (browser app + parity), `0004` (React/Vite),
`0005`/`0011`/`0012` (session/claim/dice authority stays device-independent).
