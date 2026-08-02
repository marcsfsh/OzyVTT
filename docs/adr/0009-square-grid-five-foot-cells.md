# ADR-0009 closing record: square grid, five-foot cells

## Status

Accepted by implementation — recorded 2026-08-01. **Closes** ADR-0009 ("Square grid /
five-foot cells for MVP; measurement conventions pending spike"), which had no file and stood
as *Proposed … pending spike* in `docs/adr/README.md`.

## What happened

Shipped, and load-bearing. Calibration is `{origin, cellSizePx, rotationRadians,
distancePerCell}`. The square-grid path derives `cellSizePx` from a 3×3 drag, sets `origin` to
the min corner, and **locks rotation to 0** (`apps/server/src/grid-calibration.ts`) — drag
imprecision is never read as a rotated grid. Non-square maps are handled by a distance scale
rather than a grid (`deriveMapDistanceScale`, `apps/server/src/map-measurement.ts`).

Measurement conventions were settled in code rather than in a spike: cones follow 5e RAW equal
length and width (`apps/client/src/scene/annotationGlyph.tsx`), and ephemeral annotations
expire on a fixed schedule with a re-broadcast at expiry (`apps/server/src/annotations.ts`).
The server owns snapping in every case — odd footprints centre on a cell, even footprints on a
grid intersection, gridless maps clamp without snapping (`apps/server/src/token-placement.ts`).

## Recorded outcome

**Square grid with five-foot cells, server-owned snapping, rotation locked to 0 on area
calibration.** `docs/ai-context/map-grid.md` is the live description; the spike is not pending
and should not be scheduled.

## What is still open

Nothing about the grid itself. Fog is a separate decision (ADR-0022) and is presentation only.
Difficult terrain and a server-authoritative movement preview are unimplemented and are tracked
on `docs/ai-ledger/current-state.md`, not here.
