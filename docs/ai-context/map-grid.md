# Maps & grid + scene/token rendering

**Read this when:** touching map upload, grid calibration, token placement/movement,
annotations/measurements, or the encounter canvas.

## Key files

- `apps/client/src/maps/MapManager.tsx` — GM-only map library: upload, **3×3 grid-drag
  calibration** UI, gridless/regional scale setup, crosshair + wheel-zoom preview.
- `apps/client/src/scene/EncounterMap.tsx` — interactive encounter canvas: token drag /
  keyboard move, annotation tools, pan/zoom camera, GM layer, token tray.
- `apps/client/src/scene/mapImage.tsx` — shared helpers: authorized image load,
  `imagePointFromClient` (screen↔image via `getScreenCTM`), `useMapCalibration`,
  **preview-only** snap math, `TokenGlyph`, `GridOverlay`.
- `apps/client/src/scene/annotationGlyph.tsx` — SVG glyphs (cone = 5e RAW equal length/width).
- `apps/server/src/grid-calibration.ts` — authoritative `SquareGridCalibration` +
  `imageToGrid`/`gridToImage`/`snapImagePoint`.
- `apps/server/src/grid-calibration-wizard.ts` — measure→refine→verify→complete state machine.
- `apps/server/src/token-placement.ts` — server token sizing + `snappedPosition`.
- `apps/server/src/annotations.ts`, `map-measurement.ts`, `grid-overlay.ts`, `map-http.ts`.
- `packages/domain/src/index.ts` — `EncounterToken`, `Annotation`, `CombatState`, contracts.

## Core model

A map has `kind` = battlemap / regional / world. **Printed square grid:** GM drags
diagonally across a 3×3 block; `squareCorner` forces an axis-aligned square; client POSTs
corners with `cellsAcross/Down = 3`, `distancePerCell = 5`; server `deriveSquareGridFromArea`
averages `width/3` + `height/3` for `cellSizePx`, sets `origin` = min-corner, and **locks
rotation to 0**. **Gridless / regional / world** use `deriveMapDistanceScale`: two points +
a known distance → `distancePerPixel`. Calibration =
`{origin, cellSizePx, rotationRadians, distancePerCell}`.

Tokens are server-sized to the grid (`sizePx = min(shortestSide, cellSizePx*0.82)`).
`token:move` sends a raw image point; the server bounds it and snaps to the nearest fitting
cell-center (gridless just clamps). The client renders a live snapped **preview** that
mirrors — but never replaces — the server result.

## Invariants / constraints

- **Server owns all snapping and geometry.** `token-placement.ts` + `annotations.ts` are the
  source of truth; client `snap*` in `mapImage.tsx` is preview-only and must stay a faithful
  mirror, never the persisted value.
- **All math is in image-pixel space.** Convert only via `imagePointFromClient`
  (`getScreenCTM`); never hand-roll `getBoundingClientRect` scaling (breaks under
  `preserveAspectRatio` / camera). Rotation only through `imageToGrid` / `gridToImage`.
- **Area calibration rotation stays 0** — never infer rotation from drag imprecision.
- **Viewer safety:** the shared screen gets only `public` actors and `public`, non-expired
  annotations; content is served `private, no-store`; `gm-only` / `gm-actor` never leak.
- Annotations require calibration (gridless throws on `requireCalibration`); respect domain
  bounds (position ≤1e6, size ≤4096, rotation ∈[-π,π], ≤300 annotations).

## Gotchas

- Wheel-zoom uses **manual non-passive** listeners (React `onWheel` is passive) in both
  `EncounterMap` and `MapManager`.
- Token move within `gridSizePx*0.45` of origin is treated as unchanged (anti-jitter);
  keyboard move steps by `gridSizePx` along the rotated axes.
- Measurements expire after ~5s, pings ~4s; the server re-broadcasts at `nextAnnotationExpiry`
  to keep the viewer synced — live drag previews may briefly drift from saved geometry.
- Touch: pointer events unify mouse/touch/pen with `setPointerCapture`, `touch-action:none`.
- Grid overlay throws past its line cap ("zoom in"); `gm-only` tokens reach the GM (hidden
  style) but never the viewer.

## Relevant ADRs

No dedicated maps/grid ADR. Governing: `0014` (device/touch/pinch), `0005` (`token:move` /
`annotation:*` commands, `expectedRevision`), `0004` (React/Vite/SVG), `0001` (server
authority over snapping), `0011` (claim-gated token moves). See
`docs/product/phase-0-renderer-spike.md`.
