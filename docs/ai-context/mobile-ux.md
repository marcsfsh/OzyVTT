# Mobile / responsive UX

**Read this when:** doing any UI work. Phone and laptop have **full functional parity** —
there is no reduced mobile mode, and a mouse-only control is a bug.

## Key files

- `apps/client/src/styles.css` — global reset, fluid type, main layout.
- `apps/client/src/scene/encounter-map.css` — token tray, map stage, zoom dock.
- `apps/client/src/encounter/encounter-panel.css` — initiative/turn controls.
- `apps/client/src/maps/map-manager.css` — upload / grid calibration.
- `apps/client/src/viewer/viewer.css` (+ `viewer-controls.css`, `viewer-preview.css`,
  `viewer-page.css`), `scene/annotation.css`.
- Gesture logic: `scene/RendererProof.tsx` (Pixi pointer drag + wheel zoom + two-finger
  pinch) and `scene/EncounterMap.tsx` (pointer gesture state machine: pan / token / measure
  via `setPointerCapture`).
- Decision record: `docs/adr/0014-device-support.md`.

## Responsive conventions

- **Breakpoints:** width `max-width: 760px` and `560px` (styles.css), `650px`+`560px`
  (encounter-map), `850px`+`560px` (map-manager); `min-width: 980px` promotes the table to
  two columns. The **viewer reflows on orientation** instead:
  `@media (max-aspect-ratio: 4/3)` moves the initiative rail from a side column to a bottom
  strip.
- **Fluid sizing** via `clamp()` for type/spacing/canvas height; narrow layouts collapse
  grids to `1fr`. `body { min-width: 320px }` is the supported floor.
- `prefers-reduced-motion: reduce` disables ping/pulse animations.
- High-DPI: `autoDensity` + `resolution: min(devicePixelRatio, 2)`; SVG uses
  `vector-effect: non-scaling-stroke`.

## Constraints

- ADR-014 (with ADR-001) mandates **full phone+laptop functional parity** — no separate
  mobile build; one responsive React/Vite client, every action hitting the same server
  command handlers regardless of device.
- **Touch drag for tokens and grid calibration must work via Pointer Events** from the
  start — not an afterthought.
- **Any new draggable/zoomable surface MUST set `touch-action: none`** so native
  scroll/zoom doesn't fight the gesture handlers (already set on `.proof-canvas`,
  `.encounter-map-stage`, `.viewer-stage`, `.tray-token`, `.map-preview.movable`, etc.).

## Gotchas

- `viewer.css` is shared by the standalone viewer **and** the GM in-tab preview — the page
  reset (`overflow:hidden`) is deliberately isolated in `viewer-page.css` (imported only by
  `viewer-main.tsx`). Don't merge it in.
- Token name labels are hidden `@media (max-width:560px)`.
- No `browserslist` / Vite `build.target` is pinned (baseline = Vite 6 modern-ESM default);
  a degraded-browser fallback UI and a physical iOS/Android acceptance pass **do not exist
  yet** (BUILD_PLAN GAP-001) — don't claim device coverage you haven't run.
- "Enlarge map" is an in-tab overlay, separate from the OS Fullscreen API (both exist).

## Relevant ADRs

`0014` (device support — primary), `0001` (browser app + parity), `0004` (React/Vite),
`0005`/`0011`/`0012` (session/claim/dice authority stays device-independent).
